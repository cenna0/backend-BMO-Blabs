import { describe, expect, it, vi } from "vitest";

import { hashPassword, sha256Hex } from "../../src/p9/crypto.js";
import { P9Repositories } from "../../src/p9/db/repositories.js";
import { AuthService } from "../../src/p9/services/auth.service.js";
import { AccessTokenService, SessionService } from "../../src/p9/services/session.service.js";

const userId = "00000000-0000-4000-8000-000000000010";

describe("account credential/session serialization", () => {
  it("refetches the password credential after taking the user lock, so a completed reset wins", async () => {
    const oldHash = await hashPassword("old-password-that-was-valid");
    const newHash = await hashPassword("new-password-after-the-reset");
    let currentHash = oldHash;
    const outsideUser = {
      id: userId,
      email: "person@example.com",
      displayName: null,
      username: null,
      avatarKey: null,
      createdAt: new Date("2026-08-11T00:00:00.000Z"),
      passwordCredential: { passwordHash: oldHash },
    };
    const transaction = {
      $executeRaw: vi.fn(async () => {
        // Deterministically model a reset that committed before this login obtained the lock.
        currentHash = newHash;
        return 1;
      }),
      user: {
        findUnique: vi.fn(async () => ({
          ...outsideUser,
          passwordCredential: { passwordHash: currentHash },
        })),
      },
      auditEvent: { create: vi.fn().mockResolvedValue({}) },
    };
    const client = { $transaction: vi.fn(async (work: any) => work(transaction)) };
    const repositories = {
      user: { findUnique: vi.fn().mockResolvedValue(outsideUser) },
      auditEvent: { create: vi.fn().mockResolvedValue({}) },
    };
    const sessions = { issueSession: vi.fn().mockResolvedValue({ sessionId: "session-1" }) };
    const auth = new AuthService({
      client: client as any,
      repositories: repositories as any,
      invitations: {} as any,
      sessions: sessions as any,
    });

    await expect(auth.login({
      email: "person@example.com",
      password: "old-password-that-was-valid",
    })).rejects.toMatchObject({ code: "AUTHENTICATION_FAILED" });

    expect(client.$transaction).toHaveBeenCalledTimes(1);
    expect(transaction.$executeRaw).toHaveBeenCalledTimes(1);
    expect(transaction.user.findUnique).toHaveBeenCalledAfter(transaction.$executeRaw);
    expect(sessions.issueSession).not.toHaveBeenCalled();
  });

  it("refetches a refresh token after locking its owner, so reset revocation prevents rotation", async () => {
    const now = new Date("2026-08-11T12:00:00.000Z");
    const active = {
      id: "refresh-1",
      sessionId: "session-1",
      familyId: "family-1",
      tokenHash: sha256Hex("refresh-token"),
      usedAt: null,
      revokedAt: null,
      expiresAt: new Date("2026-09-11T12:00:00.000Z"),
      session: {
        id: "session-1",
        userId,
        revokedAt: null,
        expiresAt: new Date("2026-09-11T12:00:00.000Z"),
      },
    };
    let resetCommitted = false;
    const findUnique = vi.fn(async () => resetCommitted
      ? { ...active, revokedAt: now, session: { ...active.session, revokedAt: now } }
      : active);
    const transaction = {
      $executeRaw: vi.fn(async () => {
        resetCommitted = true;
        return 1;
      }),
      refreshToken: {
        findUnique,
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        create: vi.fn().mockResolvedValue({}),
      },
      session: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        update: vi.fn().mockResolvedValue({}),
      },
      auditEvent: { create: vi.fn().mockResolvedValue({}) },
    };
    const client = { $transaction: vi.fn(async (work: any) => work(transaction)) };
    const sessions = new SessionService({
      client: client as any,
      repositories: new P9Repositories(transaction as any),
      accessTokens: new AccessTokenService({
        secret: new TextEncoder().encode("s".repeat(32)),
        issuer: "bmo-p9",
        audience: "bmo-mobile",
        lifetimeSeconds: 900,
      }),
      refreshTokenTtlSeconds: 2_592_000,
    });

    await expect(sessions.refresh("refresh-token", undefined, now)).rejects.toMatchObject({
      code: "AUTHENTICATION_FAILED",
    });

    expect(findUnique).toHaveBeenCalledTimes(2);
    expect(transaction.$executeRaw).toHaveBeenCalledTimes(1);
    expect(transaction.refreshToken.create).not.toHaveBeenCalled();
  });
});
