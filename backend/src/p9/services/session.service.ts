import { jwtVerify, SignJWT, type JWTPayload } from "jose";
import { randomUUID } from "node:crypto";

import type { PrismaClient } from "../../generated/prisma/client.js";
import { createOpaqueToken, sha256Hex } from "../crypto.js";
import { P9Error } from "../errors.js";
import { withP9Transaction } from "../db/client.js";
import { P9Repositories } from "../db/repositories.js";
import { AuditService } from "./audit.service.js";

export interface AccessTokenConfig {
  secret: Uint8Array;
  issuer: string;
  audience: string;
  lifetimeSeconds: number;
}

export interface AccessIdentity {
  userId: string;
  sessionId: string;
}

export interface IssuedAccessToken {
  token: string;
  expiresAt: Date;
}

export class AccessTokenService {
  constructor(private readonly config: AccessTokenConfig) {}

  async issue(identity: AccessIdentity, now = new Date()): Promise<IssuedAccessToken> {
    const issuedAt = Math.floor(now.getTime() / 1_000);
    const expiresAt = new Date((issuedAt + this.config.lifetimeSeconds) * 1_000);
    const token = await new SignJWT({ sid: identity.sessionId })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setSubject(identity.userId)
      .setIssuer(this.config.issuer)
      .setAudience(this.config.audience)
      .setIssuedAt(issuedAt)
      .setExpirationTime(issuedAt + this.config.lifetimeSeconds)
      .sign(this.config.secret);
    return { token, expiresAt };
  }

  async verify(token: string): Promise<JWTPayload & { sub: string; sid: string }> {
    const verified = await jwtVerify(token, this.config.secret, {
      algorithms: ["HS256"],
      issuer: this.config.issuer,
      audience: this.config.audience,
    });
    const issuedAt = verified.payload.iat;
    const expiresAt = verified.payload.exp;
    const nowSeconds = Math.floor(Date.now() / 1_000);
    if (
      typeof verified.payload.sub !== "string" ||
      typeof verified.payload.sid !== "string" ||
      typeof issuedAt !== "number" ||
      typeof expiresAt !== "number" ||
      !Number.isSafeInteger(issuedAt) ||
      !Number.isSafeInteger(expiresAt) ||
      issuedAt > nowSeconds + 60 ||
      expiresAt <= issuedAt
    ) {
      throw new P9Error("AUTHENTICATION_FAILED", 401, "Authentication failed");
    }
    return verified.payload as JWTPayload & { sub: string; sid: string };
  }
}

export interface SessionTokens {
  sessionId: string;
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: Date;
  refreshTokenExpiresAt: Date;
}

interface SessionServiceOptions {
  client: PrismaClient;
  repositories: P9Repositories;
  accessTokens: AccessTokenService;
  refreshTokenTtlSeconds: number;
}

export class SessionService {
  constructor(private readonly options: SessionServiceOptions) {}

  async issueSession(
    input: { userId: string; clientDeviceId?: string; requestId?: string },
    repositories = this.options.repositories,
    now = new Date(),
  ): Promise<SessionTokens> {
    const familyId = randomUUID();
    const refreshToken = createOpaqueToken();
    const refreshTokenExpiresAt = new Date(now.getTime() + this.options.refreshTokenTtlSeconds * 1_000);
    const session = await repositories.session.create({
      data: {
        userId: input.userId,
        familyId,
        expiresAt: refreshTokenExpiresAt,
        ...(input.clientDeviceId === undefined ? {} : { clientDeviceId: input.clientDeviceId }),
      },
    });
    await repositories.refreshToken.create({
      data: {
        sessionId: session.id,
        familyId,
        tokenHash: sha256Hex(refreshToken),
        expiresAt: refreshTokenExpiresAt,
      },
    });
    const access = await this.options.accessTokens.issue(
      { userId: input.userId, sessionId: session.id },
      now,
    );
    return {
      sessionId: session.id,
      accessToken: access.token,
      refreshToken,
      accessTokenExpiresAt: access.expiresAt,
      refreshTokenExpiresAt,
    };
  }

  async refresh(refreshToken: string, requestId?: string, now = new Date()): Promise<SessionTokens> {
    const tokenHash = sha256Hex(refreshToken);
    const result = await withP9Transaction(this.options.client, async (transaction) => {
      const repositories = new P9Repositories(transaction);
      const audit = new AuditService(repositories);
      const stored = await repositories.refreshToken.findUnique({
        where: { tokenHash },
        include: { session: true },
      });
      if (!stored) throw new P9Error("AUTHENTICATION_FAILED", 401, "Authentication failed");

      const invalid =
        stored.usedAt !== null ||
        stored.revokedAt !== null ||
        stored.expiresAt <= now ||
        stored.session.revokedAt !== null ||
        stored.session.expiresAt <= now;
      if (invalid) {
        await this.revokeFamily(repositories, stored.familyId, now, "refresh_replay_or_expired");
        await audit.record({
          eventType: stored.usedAt ? "REFRESH_REPLAY_DETECTED" : "SESSION_REFRESH_REJECTED",
          outcome: "denied",
          actorType: "system",
          resourceType: "session",
          resourceId: stored.sessionId,
          userId: stored.session.userId,
          ...(requestId === undefined ? {} : { context: { requestId } }),
        });
        return { kind: "rejected" as const };
      }

      const marked = await repositories.refreshToken.updateMany({
        where: { id: stored.id, usedAt: null, revokedAt: null },
        data: { usedAt: now },
      });
      if (marked.count !== 1) {
        await this.revokeFamily(repositories, stored.familyId, now, "refresh_replay");
        await audit.record({
          eventType: "REFRESH_REPLAY_DETECTED",
          outcome: "denied",
          actorType: "system",
          resourceType: "session",
          resourceId: stored.sessionId,
          userId: stored.session.userId,
          ...(requestId === undefined ? {} : { context: { requestId } }),
        });
        return { kind: "rejected" as const };
      }

      const nextRefreshToken = createOpaqueToken();
      await repositories.refreshToken.create({
        data: {
          sessionId: stored.sessionId,
          familyId: stored.familyId,
          tokenHash: sha256Hex(nextRefreshToken),
          expiresAt: stored.session.expiresAt,
        },
      });
      await repositories.session.update({ where: { id: stored.sessionId }, data: { lastUsedAt: now } });
      await audit.record({
        eventType: "SESSION_REFRESHED",
        outcome: "success",
        actorType: "user",
        resourceType: "session",
        resourceId: stored.sessionId,
        userId: stored.session.userId,
        ...(requestId === undefined ? {} : { context: { requestId } }),
      });
      const access = await this.options.accessTokens.issue(
        { userId: stored.session.userId, sessionId: stored.sessionId },
        now,
      );
      return {
        kind: "success" as const,
        tokens: {
          sessionId: stored.sessionId,
          accessToken: access.token,
          refreshToken: nextRefreshToken,
          accessTokenExpiresAt: access.expiresAt,
          refreshTokenExpiresAt: stored.session.expiresAt,
        },
      };
    });
    if (result.kind === "rejected") throw new P9Error("AUTHENTICATION_FAILED", 401, "Authentication failed");
    return result.tokens;
  }

  async revokeCurrent(userId: string, sessionId: string, reason: string, requestId?: string): Promise<void> {
    const now = new Date();
    const result = await this.options.repositories.session.updateMany({
      where: { id: sessionId, userId, revokedAt: null },
      data: { revokedAt: now, revokedReason: reason },
    });
    if (result.count === 1) {
      await this.options.repositories.refreshToken.updateMany({
        where: { sessionId, revokedAt: null },
        data: { revokedAt: now },
      });
      await new AuditService(this.options.repositories).record({
        eventType: "SESSION_REVOKED",
        outcome: "success",
        actorType: "user",
        resourceType: "session",
        resourceId: sessionId,
        userId,
        ...(requestId === undefined ? {} : { context: { requestId } }),
      });
    }
  }

  async revokeAll(userId: string, reason: string, requestId?: string): Promise<void> {
    const now = new Date();
    await this.options.repositories.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: now, revokedReason: reason },
    });
    await this.options.repositories.refreshToken.updateMany({
      where: { session: { userId }, revokedAt: null },
      data: { revokedAt: now },
    });
    await new AuditService(this.options.repositories).record({
      eventType: "ALL_SESSIONS_REVOKED",
      outcome: "success",
      actorType: "user",
      resourceType: "user",
      resourceId: userId,
      userId,
      ...(requestId === undefined ? {} : { context: { requestId } }),
    });
  }

  async isActive(userId: string, sessionId: string, now = new Date()): Promise<boolean> {
    const session = await this.options.repositories.session.findFirst({
      where: { id: sessionId, userId, revokedAt: null, expiresAt: { gt: now } },
      select: { id: true },
    });
    return session !== null;
  }

  private async revokeFamily(
    repositories: P9Repositories,
    familyId: string,
    now: Date,
    reason: string,
  ): Promise<void> {
    await repositories.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: now },
    });
    await repositories.session.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: now, revokedReason: reason },
    });
  }
}
