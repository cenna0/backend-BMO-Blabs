import { describe, expect, it, vi } from "vitest";
import { AuthService } from "../../src/p9/services/auth.service.js";
import { GoogleAuthClient, type GoogleUserIdentity } from "../../src/p9/providers/google-auth.client.js";
import { P9Error } from "../../src/p9/errors.js";

function createMockDb() {
  const users: any[] = [];
  const identities: any[] = [];
  const auditEvents: any[] = [];

  const db = {
    $executeRaw: vi.fn(async () => 1),
    user: {
      findUnique: vi.fn(async ({ where }: { where: { email?: string; id?: string } }) => {
        if (where.email) {
          return users.find((u) => u.email === where.email) ?? null;
        }
        if (where.id) {
          return users.find((u) => u.id === where.id) ?? null;
        }
        return null;
      }),
      create: vi.fn(async ({ data }: { data: any }) => {
        const newUser = {
          id: `user-${users.length + 1}`,
          email: data.email,
          displayName: data.displayName ?? null,
          username: null,
          avatarKey: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        users.push(newUser);
        if (data.identities?.create) {
          identities.push({
            id: `ident-${identities.length + 1}`,
            userId: newUser.id,
            provider: data.identities.create.provider,
            providerSubject: data.identities.create.providerSubject,
            user: newUser,
          });
        }
        return newUser;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: any }) => {
        const user = users.find((u) => u.id === where.id);
        if (user) {
          Object.assign(user, data);
        }
        return user;
      }),
    },
    authIdentity: {
      findUnique: vi.fn(async ({ where }: { where: { provider_providerSubject?: { provider: string; providerSubject: string } } }) => {
        if (where.provider_providerSubject) {
          const { provider, providerSubject } = where.provider_providerSubject;
          const found = identities.find((i) => i.provider === provider && i.providerSubject === providerSubject);
          if (found) {
            return {
              ...found,
              user: users.find((u) => u.id === found.userId),
            };
          }
        }
        return null;
      }),
      create: vi.fn(async ({ data }: { data: any }) => {
        const newIdent = {
          id: `ident-${identities.length + 1}`,
          userId: data.userId,
          provider: data.provider,
          providerSubject: data.providerSubject,
        };
        identities.push(newIdent);
        return newIdent;
      }),
    },
    auditEvent: {
      create: vi.fn(async ({ data }: { data: any }) => {
        auditEvents.push(data);
        return data;
      }),
    },
  };

  const client = {
    $transaction: vi.fn(async (work: (tx: typeof db) => Promise<unknown>) => {
      return work(db);
    }),
  };

  return { db, client, users, identities, auditEvents };
}

describe("Google Social Authentication in AuthService", () => {
  it("registers a new user when Google ID is first seen", async () => {
    const { client, users, identities } = createMockDb();
    const mockGoogleAuth = {
      verifyToken: vi.fn(async (): Promise<GoogleUserIdentity> => ({
        sub: "google-sub-12345",
        email: "newuser@example.com",
        emailVerified: true,
        displayName: "New Google User",
        avatarUrl: null,
      })),
    } as unknown as GoogleAuthClient;

    const mockSessionService = {
      issueSession: vi.fn(async () => ({
        sessionId: "sess-1",
        accessToken: "access-token-1",
        refreshToken: "refresh-token-1",
        accessTokenExpiresAt: new Date(Date.now() + 900_000),
        refreshTokenExpiresAt: new Date(Date.now() + 86400_000),
      })),
    };

    const authService = new AuthService({
      client: client as any,
      repositories: {} as any,
      invitations: {} as any,
      sessions: mockSessionService as any,
      googleAuth: mockGoogleAuth,
    });

    const result = await authService.loginWithGoogle({
      idToken: "valid-google-id-token-xyz",
    });

    expect(result.user.email).toBe("newuser@example.com");
    expect(result.user.displayName).toBe("New Google User");
    expect(result.session.accessToken).toBe("access-token-1");
    expect(users).toHaveLength(1);
    expect(identities).toHaveLength(1);
    expect(identities[0].provider).toBe("google");
    expect(identities[0].providerSubject).toBe("google-sub-12345");
  });

  it("logs in an existing user with linked Google identity directly", async () => {
    const { client, users, identities } = createMockDb();
    const existingUser = {
      id: "user-existing",
      email: "existing@example.com",
      displayName: "Existing User",
      username: "existing",
      avatarKey: null,
      createdAt: new Date(),
    };
    users.push(existingUser);
    identities.push({
      id: "ident-1",
      userId: "user-existing",
      provider: "google",
      providerSubject: "google-sub-existing",
      user: existingUser,
    });

    const mockGoogleAuth = {
      verifyToken: vi.fn(async (): Promise<GoogleUserIdentity> => ({
        sub: "google-sub-existing",
        email: "existing@example.com",
        emailVerified: true,
        displayName: null,
        avatarUrl: null,
      })),
    } as unknown as GoogleAuthClient;

    const mockSessionService = {
      issueSession: vi.fn(async () => ({
        sessionId: "sess-2",
        accessToken: "access-token-2",
        refreshToken: "refresh-token-2",
        accessTokenExpiresAt: new Date(Date.now() + 900_000),
        refreshTokenExpiresAt: new Date(Date.now() + 86400_000),
      })),
    };

    const authService = new AuthService({
      client: client as any,
      repositories: {} as any,
      invitations: {} as any,
      sessions: mockSessionService as any,
      googleAuth: mockGoogleAuth,
    });

    const result = await authService.loginWithGoogle({
      idToken: "valid-existing-id-token",
    });

    expect(result.user.email).toBe("existing@example.com");
    expect(result.session.accessToken).toBe("access-token-2");
    expect(users).toHaveLength(1);
  });

  it("links Google identity to existing user with same email", async () => {
    const { client, users, identities } = createMockDb();
    const emailUser = {
      id: "user-email-match",
      email: "same.email@example.com",
      displayName: null,
      username: "emailuser",
      avatarKey: null,
      createdAt: new Date(),
    };
    users.push(emailUser);

    const mockGoogleAuth = {
      verifyToken: vi.fn(async (): Promise<GoogleUserIdentity> => ({
        sub: "google-sub-new-link",
        email: "same.email@example.com",
        emailVerified: true,
        displayName: "Linked Name",
        avatarUrl: null,
      })),
    } as unknown as GoogleAuthClient;

    const mockSessionService = {
      issueSession: vi.fn(async () => ({
        sessionId: "sess-3",
        accessToken: "access-token-3",
        refreshToken: "refresh-token-3",
        accessTokenExpiresAt: new Date(Date.now() + 900_000),
        refreshTokenExpiresAt: new Date(Date.now() + 86400_000),
      })),
    };

    const authService = new AuthService({
      client: client as any,
      repositories: {} as any,
      invitations: {} as any,
      sessions: mockSessionService as any,
      googleAuth: mockGoogleAuth,
    });

    const result = await authService.loginWithGoogle({
      idToken: "valid-token-for-linking",
    });

    expect(result.user.email).toBe("same.email@example.com");
    expect(result.user.displayName).toBe("Linked Name");
    expect(identities).toHaveLength(1);
    expect(identities[0].provider).toBe("google");
    expect(identities[0].providerSubject).toBe("google-sub-new-link");
  });

  it("rejects when token verification fails", async () => {
    const { client } = createMockDb();
    const mockGoogleAuth = {
      verifyToken: vi.fn(async () => {
        throw new P9Error("AUTHENTICATION_FAILED", 401, "Invalid Google ID token");
      }),
    } as unknown as GoogleAuthClient;

    const authService = new AuthService({
      client: client as any,
      repositories: {
        auditEvent: { create: vi.fn() },
      } as any,
      invitations: {} as any,
      sessions: {} as any,
      googleAuth: mockGoogleAuth,
    });

    await expect(authService.loginWithGoogle({
      idToken: "invalid-token-123",
    })).rejects.toThrow("Invalid Google ID token");
  });
});
