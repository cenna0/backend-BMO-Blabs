import { describe, expect, it, vi } from "vitest";

import { sha256Hex } from "../../src/p9/crypto.js";
import { PersonalizationService } from "../../src/p9/services/personalization.service.js";
import { ProfileService } from "../../src/p9/services/profile.service.js";
import { RecoveryService } from "../../src/p9/services/recovery.service.js";
import { AvatarService } from "../../src/p9/services/avatar.service.js";
import { AuthService } from "../../src/p9/services/auth.service.js";

const defaultPersonalization = {
  id: "settings-1",
  userId: "user-1",
  baseStyleTone: "default",
  warmth: "default",
  enthusiasm: "default",
  headerAndLists: "default",
  emoji: "default",
  fastAnswers: false,
  customInstructions: "",
};

describe("profile and personalization services", () => {
  it("updates only the authenticated owner's normalized profile and sanitizes conflicts", async () => {
    const update = vi.fn().mockResolvedValue({
      id: "user-1", email: "p@example.com", displayName: "Person", username: "person",
      avatarKey: null, createdAt: new Date("2026-08-11T00:00:00.000Z"),
    });
    const service = new ProfileService({ user: { update } } as any, "https://api.example.com");
    await expect(service.update("user-1", { username: " PERSON " })).resolves.toMatchObject({
      id: "user-1", username: "person", avatarUrl: null,
    });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "user-1" }, data: { username: "person" },
    }));

    update.mockRejectedValueOnce({ code: "P2002" });
    await expect(service.update("user-1", { username: "taken" })).rejects.toMatchObject({
      code: "CONFLICT", status: 409, publicMessage: "Username unavailable",
    });
  });

  it("safe-upserts defaults and patches only the authenticated owner's personalization", async () => {
    const upsert = vi.fn()
      .mockResolvedValueOnce(defaultPersonalization)
      .mockResolvedValueOnce({ ...defaultPersonalization, warmth: "warm" });
    const service = new PersonalizationService({ personalizationSettings: { upsert } } as any);
    await expect(service.get("user-1")).resolves.toEqual(expect.objectContaining({ warmth: "default" }));
    await expect(service.update("user-1", { warmth: "warm" })).resolves.toEqual(expect.objectContaining({ warmth: "warm" }));
    expect(upsert.mock.calls[1]?.[0]).toEqual(expect.objectContaining({
      where: { userId: "user-1" }, update: { warmth: "warm" },
      create: expect.objectContaining({ userId: "user-1", warmth: "warm" }),
    }));
  });
});

describe("self-service registration", () => {
  it("creates a normalized owner with PostgreSQL DATE input and no invitation or DOB disclosure", async () => {
    const invitation = {
      expireIfNeeded: vi.fn(),
      consumeForRegistration: vi.fn(),
    };
    const created: any[] = [];
    const db = {
      user: { create: vi.fn(async (input) => {
        created.push(input);
        return {
          id: "user-1", email: input.data.email, displayName: input.data.displayName ?? null,
          username: null, avatarKey: null, createdAt: new Date("2026-08-11T00:00:00.000Z"),
        };
      }) },
      auditEvent: { create: vi.fn().mockResolvedValue({}) },
    };
    const client = { $transaction: (work: any) => work(db) };
    const sessions = { issueSession: vi.fn().mockResolvedValue({ sessionId: "session-1" }) };
    const service = new AuthService({
      client: client as any,
      repositories: { auditEvent: { create: vi.fn() } } as any,
      invitations: invitation as any,
      sessions: sessions as any,
      publicBaseUrl: "https://api.example.com",
    });
    const result = await service.register({
      email: " Person@Example.COM ", password: "correct horse battery staple",
      displayName: "Person", dateOfBirth: "2004-05-19",
    });
    expect(invitation.expireIfNeeded).not.toHaveBeenCalled();
    expect(invitation.consumeForRegistration).not.toHaveBeenCalled();
    expect(created[0].data).toMatchObject({
      email: "person@example.com",
      dateOfBirth: new Date("2004-05-19T00:00:00.000Z"),
      passwordCredential: { create: { algorithm: "argon2id", passwordHash: expect.stringMatching(/^\$argon2id\$/) } },
    });
    expect(result.user).toEqual({
      id: "user-1", email: "person@example.com", displayName: "Person", username: null,
      avatarUrl: null, createdAt: "2026-08-11T00:00:00.000Z",
    });
    expect(JSON.stringify(result)).not.toContain("dateOfBirth");
  });

  it("retains optional invitation consumption for legacy clients", async () => {
    const invitation = {
      expireIfNeeded: vi.fn().mockResolvedValue(undefined),
      consumeForRegistration: vi.fn().mockResolvedValue({ id: "invite-1" }),
    };
    const db = {
      user: { create: vi.fn().mockResolvedValue({
        id: "user-1", email: "p@example.com", displayName: null, username: null,
        avatarKey: null, createdAt: new Date("2026-08-11T00:00:00.000Z"),
      }) },
      auditEvent: { create: vi.fn().mockResolvedValue({}) },
    };
    const service = new AuthService({
      client: { $transaction: (work: any) => work(db) } as any,
      repositories: { auditEvent: { create: vi.fn() } } as any,
      invitations: invitation as any,
      sessions: { issueSession: vi.fn().mockResolvedValue({ sessionId: "session-1" }) } as any,
    });
    await service.register({
      invitationToken: "legacy-token", email: "p@example.com",
      password: "correct horse battery staple", dateOfBirth: "2004-05-19",
    });
    expect(invitation.expireIfNeeded).toHaveBeenCalled();
    expect(invitation.consumeForRegistration).toHaveBeenCalledWith("legacy-token", "p@example.com", expect.anything());
  });
});

describe("avatar service cleanup", () => {
  it("removes the prior opaque file only after a successful owner metadata update", async () => {
    const storage = {
      store: vi.fn().mockResolvedValue({ key: "new-key", contentType: "image/webp", byteSize: 123 }),
      delete: vi.fn().mockResolvedValue(undefined),
    };
    const db = {
      $executeRaw: vi.fn(),
      user: {
        findUnique: vi.fn().mockResolvedValue({ id: "user-1", avatarKey: "old-key" }),
        update: vi.fn().mockResolvedValue({}),
      },
    };
    const client = { $transaction: (work: any) => work(db) };
    const service = new AvatarService(client as any, storage as any, "https://api.example.com");
    await expect(service.upload("user-1", Buffer.from("image"), "image/png")).resolves.toEqual({
      avatarUrl: "https://api.example.com/media/avatars/new-key.webp",
    });
    expect(db.user.update).toHaveBeenCalledWith({ where: { id: "user-1" }, data: {
      avatarKey: "new-key", avatarContentType: "image/webp", avatarByteSize: 123,
    } });
    expect(storage.delete).toHaveBeenCalledWith("old-key");
  });

  it("removes the newly written file and preserves the prior file when metadata update fails", async () => {
    const storage = {
      store: vi.fn().mockResolvedValue({ key: "new-key", contentType: "image/webp", byteSize: 123 }),
      delete: vi.fn().mockResolvedValue(undefined),
    };
    const db = {
      $executeRaw: vi.fn(),
      user: {
        findUnique: vi.fn().mockResolvedValue({ id: "user-1", avatarKey: "old-key" }),
        update: vi.fn().mockRejectedValue(new Error("database unavailable")),
      },
    };
    const client = { $transaction: (work: any) => work(db) };
    const service = new AvatarService(client as any, storage as any, "https://api.example.com");
    await expect(service.upload("user-1", Buffer.from("image"), "image/png")).rejects.toThrow("database unavailable");
    expect(storage.delete).toHaveBeenCalledTimes(1);
    expect(storage.delete).toHaveBeenCalledWith("new-key");
  });
});

describe("DOB recovery service", () => {
  function fixture(user: any, claimCounts: number[] = [1]) {
    const created: any[] = [];
    const passwordUpdates: any[] = [];
    const sessionRevocations: any[] = [];
    const refreshRevocations: any[] = [];
    const auditEvents: any[] = [];
    const transactionDb = {
      passwordRecovery: {
        findUnique: vi.fn().mockResolvedValue({
          id: "recovery-1", userId: "user-1", usedAt: null,
          expiresAt: new Date("2026-08-11T12:10:00.000Z"), attemptCount: 0, maxAttempts: 5,
        }),
        updateMany: vi.fn().mockImplementation(async () => ({ count: claimCounts.shift() ?? 0 })),
      },
      passwordCredential: { update: vi.fn(async (value) => { passwordUpdates.push(value); }) },
      session: { updateMany: vi.fn(async (value) => { sessionRevocations.push(value); return { count: 2 }; }) },
      refreshToken: { updateMany: vi.fn(async (value) => { refreshRevocations.push(value); return { count: 2 }; }) },
      auditEvent: { create: vi.fn(async (value) => { auditEvents.push(value); return {}; }) },
    };
    const repositories = {
      user: { findUnique: vi.fn().mockResolvedValue(user) },
      passwordRecovery: {
        create: vi.fn(async (value) => { created.push(value); return value; }),
        findUnique: vi.fn().mockResolvedValue(null),
      },
      auditEvent: { create: vi.fn(async (value) => { auditEvents.push(value); return {}; }) },
    };
    const client = { $transaction: (work: any) => work(transactionDb) };
    return {
      service: new RecoveryService(client as any, repositories as any, { ttlSeconds: 600, maxAttempts: 5 }),
      created, passwordUpdates, sessionRevocations, refreshRevocations, auditEvents,
    };
  }

  it("issues a 10-minute opaque token while storing only its SHA-256 verifier", async () => {
    const f = fixture({ id: "user-1", dateOfBirth: new Date("2004-05-19T00:00:00.000Z") });
    const result = await f.service.verify({ email: "P@Example.com", dateOfBirth: "2004-05-19" }, {
      now: new Date("2026-08-11T12:00:00.000Z"), ip: "203.0.113.4", userAgent: "test-agent",
    });
    expect(result.expiresAt).toEqual(new Date("2026-08-11T12:10:00.000Z"));
    expect(f.created[0].data.tokenVerifier).toBe(sha256Hex(result.recoveryToken));
    expect(JSON.stringify(f.created[0])).not.toContain(result.recoveryToken);
    expect(JSON.stringify(f.created[0])).not.toContain("2004-05-19");
    expect(f.auditEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({ data: expect.objectContaining({ eventType: "PASSWORD_RECOVERY_VERIFIED", userId: "user-1" }) }),
    ]));
    expect(JSON.stringify(f.auditEvents)).not.toContain(result.recoveryToken);
    expect(JSON.stringify(f.auditEvents)).not.toContain("2004-05-19");
  });

  it("uses an indistinguishable failure for unknown email and wrong DOB", async () => {
    const unknownFixture = fixture(null);
    const wrongFixture = fixture({ id: "user-1", dateOfBirth: new Date("2000-01-01T00:00:00.000Z") });
    const unknown = unknownFixture.service.verify({ email: "missing@example.com", dateOfBirth: "2004-05-19" });
    const wrong = wrongFixture.service.verify({
      email: "p@example.com", dateOfBirth: "2004-05-19",
    });
    const errors = await Promise.all([unknown.catch((error: any) => error), wrong.catch((error: any) => error)]);
    expect(errors.map((error: any) => ({ code: error.code, status: error.status, message: error.publicMessage }))).toEqual([
      { code: "RECOVERY_INVALID", status: 400, message: "Recovery verification failed" },
      { code: "RECOVERY_INVALID", status: 400, message: "Recovery verification failed" },
    ]);
    expect(unknownFixture.auditEvents[0]?.data).toMatchObject({ eventType: "PASSWORD_RECOVERY_VERIFICATION_FAILED", outcome: "denied" });
    expect(wrongFixture.auditEvents[0]?.data).toMatchObject({ eventType: "PASSWORD_RECOVERY_VERIFICATION_FAILED", outcome: "denied" });
  });

  it("allows exactly one concurrent verifier claim, replaces Argon2id, and revokes every session/token", async () => {
    const f = fixture(null, [1, 0]);
    const attempts = await Promise.allSettled([
      f.service.reset({ recoveryToken: "opaque-token", newPassword: "a-new-long-password" }, new Date("2026-08-11T12:00:00.000Z")),
      f.service.reset({ recoveryToken: "opaque-token", newPassword: "another-long-password" }, new Date("2026-08-11T12:00:00.000Z")),
    ]);
    expect(attempts.map((attempt) => attempt.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(attempts.find((attempt) => attempt.status === "rejected")).toMatchObject({
      reason: { code: "RECOVERY_INVALID" },
    });
    expect(f.passwordUpdates[0].data).toMatchObject({ algorithm: "argon2id" });
    expect(f.passwordUpdates[0].data.passwordHash).toMatch(/^\$argon2id\$/);
    expect(f.sessionRevocations[0].where).toEqual({ userId: "user-1", revokedAt: null });
    expect(f.refreshRevocations[0].where).toEqual({ session: { userId: "user-1" }, revokedAt: null });
    expect(f.auditEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({ data: expect.objectContaining({ eventType: "PASSWORD_RESET_SUCCEEDED", userId: "user-1" }) }),
    ]));
  });
});
