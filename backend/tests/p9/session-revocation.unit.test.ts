import { describe, expect, it, vi } from "vitest";

import { AccessTokenService, SessionService } from "../../src/p9/services/session.service.js";

const userId = "00000000-0000-4000-8000-000000000010";
const now = new Date("2026-08-11T12:00:30.000Z");

function fixture(currentCount = 1) {
  const transaction = {
    $executeRaw: vi.fn().mockResolvedValue(1),
    $queryRaw: vi.fn().mockResolvedValue([{ now }]),
    session: { updateMany: vi.fn().mockResolvedValue({ count: currentCount }) },
    refreshToken: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    auditEvent: { create: vi.fn().mockResolvedValue({}) },
  };
  const client = {
    $transaction: vi.fn(async (work: (database: typeof transaction) => Promise<unknown>) => work(transaction)),
  };
  const outside = {
    session: { updateMany: vi.fn(() => { throw new Error("outside transaction"); }) },
    refreshToken: { updateMany: vi.fn(() => { throw new Error("outside transaction"); }) },
    auditEvent: { create: vi.fn(() => { throw new Error("outside transaction"); }) },
  };
  const service = new SessionService({
    client: client as any,
    repositories: outside as any,
    accessTokens: new AccessTokenService({
      secret: new TextEncoder().encode("s".repeat(32)),
      issuer: "bmo-p9",
      audience: "bmo-mobile",
      lifetimeSeconds: 900,
    }),
    refreshTokenTtlSeconds: 2_592_000,
  });
  return { client, outside, service, transaction };
}

describe("session revocation serialization", () => {
  it("revokes the current session and writes its audit under one user lock and database clock", async () => {
    const f = fixture();

    await f.service.revokeCurrent(userId, "session-1", "logout", "request-current");

    expect(f.client.$transaction).toHaveBeenCalledOnce();
    expect(f.transaction.$executeRaw).toHaveBeenCalledOnce();
    expect(f.transaction.$queryRaw).toHaveBeenCalledOnce();
    expect(f.transaction.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      f.transaction.$queryRaw.mock.invocationCallOrder[0]!,
    );
    expect(f.transaction.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      f.transaction.session.updateMany.mock.invocationCallOrder[0]!,
    );
    expect(f.transaction.session.updateMany).toHaveBeenCalledWith({
      where: { id: "session-1", userId, revokedAt: null },
      data: { revokedAt: now, revokedReason: "logout" },
    });
    expect(f.transaction.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { sessionId: "session-1", revokedAt: null },
      data: { revokedAt: now },
    });
    expect(f.transaction.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eventType: "SESSION_REVOKED",
        requestId: "request-current",
      }),
    });
    expect(f.outside.session.updateMany).not.toHaveBeenCalled();
  });

  it("revokes all sessions and writes its audit atomically after taking the user lock", async () => {
    const f = fixture();

    await f.service.revokeAll(userId, "logout_all", "request-all");

    expect(f.client.$transaction).toHaveBeenCalledOnce();
    expect(f.transaction.$executeRaw).toHaveBeenCalledOnce();
    expect(f.transaction.$queryRaw).toHaveBeenCalledOnce();
    expect(f.transaction.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      f.transaction.session.updateMany.mock.invocationCallOrder[0]!,
    );
    expect(f.transaction.session.updateMany).toHaveBeenCalledWith({
      where: { userId, revokedAt: null },
      data: { revokedAt: now, revokedReason: "logout_all" },
    });
    expect(f.transaction.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { session: { userId }, revokedAt: null },
      data: { revokedAt: now },
    });
    expect(f.transaction.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eventType: "ALL_SESSIONS_REVOKED",
        requestId: "request-all",
      }),
    });
    expect(f.outside.refreshToken.updateMany).not.toHaveBeenCalled();
  });
});
