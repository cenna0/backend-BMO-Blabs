import { z } from "zod";
import type { PrismaClient } from "../../generated/prisma/client.js";
import { hashPassword, sha256Hex, verifyPassword } from "../crypto.js";
import { withP9Transaction } from "../db/client.js";
import { P9Repositories } from "../db/repositories.js";
import { P9Error } from "../errors.js";
import { GoogleAuthClient } from "../providers/google-auth.client.js";
import { normalizeEmail, parseRegistration } from "../validation.js";
import { AuditService } from "./audit.service.js";
import { InvitationService } from "./invitation.service.js";
import { SessionService, type SessionTokens } from "./session.service.js";
import { publicUser, type PublicUserRecord } from "./user.service.js";

const loginSchema = z.object({
  email: z.string(),
  password: z.string().min(1).max(256),
  clientDeviceId: z.string().uuid().optional(),
}).strict();

const googleLoginSchema = z.object({
  idToken: z.string().min(10).optional(),
  accessToken: z.string().min(10).optional(),
  clientDeviceId: z.string().uuid().optional(),
}).strict().refine((data) => Boolean(data.idToken || data.accessToken), {
  message: "Either idToken or accessToken must be provided",
});

export interface AuthResult {
  user: ReturnType<typeof publicUser>;
  session: SessionTokens;
}

export interface AuthServiceOptions {
  client: PrismaClient;
  repositories: P9Repositories;
  invitations: InvitationService;
  sessions: SessionService;
  publicBaseUrl?: string;
  googleAuth?: GoogleAuthClient;
}

const dummyPasswordHash = hashPassword("p9-dummy-password-that-is-never-accepted");

export class AuthService {
  constructor(private readonly options: AuthServiceOptions) {}

  async register(input: unknown, requestId?: string): Promise<AuthResult> {
    let parsed: ReturnType<typeof parseRegistration>;
    try {
      parsed = parseRegistration(input);
    } catch {
      throw new P9Error("INVALID_INPUT", 400, "Invalid registration request");
    }

    const email = parsed.email;
    if (parsed.invitationToken) {
      await this.options.invitations.expireIfNeeded(parsed.invitationToken, new Date(), requestId);
    }

    const passwordHash = await hashPassword(parsed.password);

    try {
      return await withP9Transaction(this.options.client, async (transaction) => {
        const repositories = new P9Repositories(transaction);
        const invitation = parsed.invitationToken
          ? await this.options.invitations.consumeForRegistration(parsed.invitationToken, email, repositories)
          : null;

        const user = await repositories.user.create({
          data: {
            email,
            ...(parsed.displayName === undefined ? {} : { displayName: parsed.displayName }),
            dateOfBirth: parsed.dateOfBirth,
            passwordCredential: { create: { passwordHash, algorithm: "argon2id" } },
            identities: { create: { provider: "password", providerSubject: `local:${email}` } },
            userSettings: { create: { timezone: "Asia/Jakarta" } },
          },
        });

        const session = await this.options.sessions.issueSession(
          { userId: user.id, ...(requestId === undefined ? {} : { requestId }) },
          repositories,
        );

        await new AuditService(repositories).record({
          eventType: "REGISTRATION_SUCCEEDED",
          outcome: "success",
          actorType: "user",
          resourceType: "user",
          resourceId: user.id,
          userId: user.id,
          ...(requestId === undefined ? {} : { context: { requestId } }),
          metadata: { email, ...(invitation ? { resourceId: invitation.id } : {}) },
        });

        return { user: publicUser(user, this.options.publicBaseUrl), session };
      });
    } catch (error) {
      if (parsed.invitationToken) {
        await this.options.invitations.expireIfNeeded(parsed.invitationToken, new Date(), requestId).catch(() => undefined);
      }
      await new AuditService(this.options.repositories).record({
        eventType: "REGISTRATION_FAILED",
        outcome: "failure",
        actorType: "anonymous",
        resourceType: "registration",
        ...(requestId === undefined ? {} : { context: { requestId } }),
        metadata: { email },
      }).catch(() => undefined);
      if (error instanceof P9Error) throw error;
      if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
        throw new P9Error("CONFLICT", 409, "Account already exists");
      }
      throw new P9Error("AUTHENTICATION_FAILED", 401, "Authentication failed");
    }
  }

  async login(input: unknown, requestId?: string): Promise<AuthResult> {
    let parsed: z.infer<typeof loginSchema>;
    try {
      parsed = loginSchema.parse(input);
    } catch {
      throw new P9Error("AUTHENTICATION_FAILED", 401, "Authentication failed");
    }

    let email: string;
    try {
      email = normalizeEmail(parsed.email);
    } catch {
      await verifyPassword(await dummyPasswordHash, parsed.password);
      throw new P9Error("AUTHENTICATION_FAILED", 401, "Authentication failed");
    }

    const discoveredUser = await this.options.repositories.user.findUnique({
      where: { email },
      select: { id: true },
    });

    const result = await withP9Transaction(this.options.client, async (transaction) => {
      const repositories = new P9Repositories(transaction);
      await repositories.lockUser(discoveredUser?.id ?? `login-miss:${sha256Hex(email)}`);
      let user = await repositories.user.findUnique({
        where: { email },
        include: { passwordCredential: true },
      });

      if (user && user.id !== discoveredUser?.id) {
        await repositories.lockUser(user.id);
        user = await repositories.user.findUnique({
          where: { id: user.id },
          include: { passwordCredential: true },
        });
      }

      const passwordHash = user?.passwordCredential?.passwordHash ?? (await dummyPasswordHash);
      const valid = await verifyPassword(passwordHash, parsed.password);
      if (!user || !user.passwordCredential || !valid) return null;

      const session = await this.options.sessions.issueSession({
        userId: user.id,
        ...(parsed.clientDeviceId === undefined ? {} : { clientDeviceId: parsed.clientDeviceId }),
        ...(requestId === undefined ? {} : { requestId }),
      }, repositories);

      await new AuditService(repositories).record({
        eventType: "LOGIN_SUCCEEDED",
        outcome: "success",
        actorType: "user",
        resourceType: "session",
        resourceId: session.sessionId,
        userId: user.id,
        ...(requestId === undefined ? {} : { context: { requestId } }),
      });

      return { user: publicUser(user as PublicUserRecord, this.options.publicBaseUrl), session };
    });

    if (result) return result;

    await new AuditService(this.options.repositories).record({
      eventType: "LOGIN_FAILED",
      outcome: "failure",
      actorType: "anonymous",
      resourceType: "session",
      ...(requestId === undefined ? {} : { context: { requestId } }),
      metadata: { email },
    }).catch(() => undefined);
    throw new P9Error("AUTHENTICATION_FAILED", 401, "Authentication failed");
  }

  async loginWithGoogle(input: unknown, requestId?: string): Promise<AuthResult> {
    let parsed: z.infer<typeof googleLoginSchema>;
    try {
      parsed = googleLoginSchema.parse(input);
    } catch {
      throw new P9Error("INVALID_INPUT", 400, "Invalid Google authentication request");
    }

    const googleClient = this.options.googleAuth ?? new GoogleAuthClient();
    const identity = await googleClient.verifyToken({
      idToken: parsed.idToken ?? null,
      accessToken: parsed.accessToken ?? null,
    });

    const email = normalizeEmail(identity.email);
    const googleSub = identity.sub;

    try {
      return await withP9Transaction(this.options.client, async (transaction) => {
        const repositories = new P9Repositories(transaction);

        // 1. Check if identity already exists
        const existingIdentity = await repositories.authIdentity.findUnique({
          where: {
            provider_providerSubject: {
              provider: "google",
              providerSubject: googleSub,
            },
          },
          include: { user: true },
        });

        if (existingIdentity && existingIdentity.user) {
          await repositories.lockUser(existingIdentity.userId);
          const user = existingIdentity.user;
          const session = await this.options.sessions.issueSession({
            userId: user.id,
            ...(parsed.clientDeviceId === undefined ? {} : { clientDeviceId: parsed.clientDeviceId }),
            ...(requestId === undefined ? {} : { requestId }),
          }, repositories);

          await new AuditService(repositories).record({
            eventType: "LOGIN_SUCCEEDED",
            outcome: "success",
            actorType: "user",
            resourceType: "session",
            resourceId: session.sessionId,
            userId: user.id,
            ...(requestId === undefined ? {} : { context: { requestId } }),
            metadata: { provider: "google" },
          });

          return { user: publicUser(user as PublicUserRecord, this.options.publicBaseUrl), session };
        }

        // 2. Check if a user with this email already exists
        await repositories.lockUser(`google-auth:${sha256Hex(email)}`);
        const existingUser = await repositories.user.findUnique({
          where: { email },
        });

        if (existingUser) {
          await repositories.lockUser(existingUser.id);
          await repositories.authIdentity.create({
            data: {
              userId: existingUser.id,
              provider: "google",
              providerSubject: googleSub,
            },
          });

          let updatedUser = existingUser;
          if (!existingUser.displayName && identity.displayName) {
            updatedUser = await repositories.user.update({
              where: { id: existingUser.id },
              data: { displayName: identity.displayName },
            });
          }

          const session = await this.options.sessions.issueSession({
            userId: updatedUser.id,
            ...(parsed.clientDeviceId === undefined ? {} : { clientDeviceId: parsed.clientDeviceId }),
            ...(requestId === undefined ? {} : { requestId }),
          }, repositories);

          await new AuditService(repositories).record({
            eventType: "LOGIN_SUCCEEDED",
            outcome: "success",
            actorType: "user",
            resourceType: "session",
            resourceId: session.sessionId,
            userId: updatedUser.id,
            ...(requestId === undefined ? {} : { context: { requestId } }),
            metadata: { provider: "google", linked: true },
          });

          return { user: publicUser(updatedUser as PublicUserRecord, this.options.publicBaseUrl), session };
        }

        // 3. Register new user via Google
        const newUser = await repositories.user.create({
          data: {
            email,
            ...(identity.displayName ? { displayName: identity.displayName } : {}),
            identities: {
              create: {
                provider: "google",
                providerSubject: googleSub,
              },
            },
            userSettings: { create: { timezone: "Asia/Jakarta" } },
          },
        });

        const session = await this.options.sessions.issueSession({
          userId: newUser.id,
          ...(parsed.clientDeviceId === undefined ? {} : { clientDeviceId: parsed.clientDeviceId }),
          ...(requestId === undefined ? {} : { requestId }),
        }, repositories);

        await new AuditService(repositories).record({
          eventType: "REGISTRATION_SUCCEEDED",
          outcome: "success",
          actorType: "user",
          resourceType: "user",
          resourceId: newUser.id,
          userId: newUser.id,
          ...(requestId === undefined ? {} : { context: { requestId } }),
          metadata: { email, provider: "google" },
        });

        return { user: publicUser(newUser, this.options.publicBaseUrl), session };
      });
    } catch (error) {
      await new AuditService(this.options.repositories).record({
        eventType: "LOGIN_FAILED",
        outcome: "failure",
        actorType: "anonymous",
        resourceType: "session",
        ...(requestId === undefined ? {} : { context: { requestId } }),
        metadata: { email, provider: "google" },
      }).catch(() => undefined);
      if (error instanceof P9Error) throw error;
      throw new P9Error("AUTHENTICATION_FAILED", 401, "Google authentication failed");
    }
  }
}
