import { describe, expect, it, vi } from "vitest";

import { P9Repositories } from "../../src/p9/db/repositories.js";
import { AccessTokenService, SessionService } from "../../src/p9/services/session.service.js";

function fixture(device: { id: string } | null) {
  const transaction = {
    $executeRaw: vi.fn().mockResolvedValue(1),
    device: { findFirst: vi.fn().mockResolvedValue(device) },
    session: { create: vi.fn().mockResolvedValue({ id: "session-1" }) },
    refreshToken: { create: vi.fn().mockResolvedValue({ id: "refresh-1" }) },
  };
  const client = {
    $transaction: vi.fn(async (work: (database: typeof transaction) => Promise<unknown>) => work(transaction)),
  };
  const repositories = new P9Repositories(transaction as never);
  const accessTokens = new AccessTokenService({
    secret: new TextEncoder().encode("s".repeat(32)),
    issuer: "bmo-p9",
    audience: "bmo-mobile",
    lifetimeSeconds: 900,
  });
  return {
    repositories,
    transaction,
    client,
    sessions: new SessionService({
      client: client as never,
      repositories,
      accessTokens,
      refreshTokenTtlSeconds: 2_592_000,
    }),
  };
}

describe("mobile session device identity", () => {
  it("stores clientDeviceId only after active ownership validation", async () => {
    const { client, transaction, sessions } = fixture({ id: "00000000-0000-4000-8000-000000000001" });

    await sessions.issueSession({
      userId: "00000000-0000-4000-8000-000000000010",
      clientDeviceId: "00000000-0000-4000-8000-000000000001",
    });

    expect(client.$transaction).toHaveBeenCalledTimes(1);
    expect(transaction.$executeRaw).toHaveBeenCalledTimes(1);
    expect(transaction.device.findFirst).toHaveBeenCalledWith({
      where: {
        id: "00000000-0000-4000-8000-000000000001",
        userId: "00000000-0000-4000-8000-000000000010",
        status: "ACTIVE",
      },
      select: { id: true },
    });
    expect(transaction.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      transaction.device.findFirst.mock.invocationCallOrder[0]!,
    );
    expect(transaction.session.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ clientDeviceId: "00000000-0000-4000-8000-000000000001" }),
    }));
  });

  it("rejects an unowned clientDeviceId before issuing tokens", async () => {
    const { transaction, sessions } = fixture(null);

    await expect(sessions.issueSession({
      userId: "00000000-0000-4000-8000-000000000010",
      clientDeviceId: "00000000-0000-4000-8000-000000000002",
    })).rejects.toMatchObject({ code: "OWNERSHIP_DENIED", status: 404 });
    expect(transaction.$executeRaw).toHaveBeenCalledTimes(1);
    expect(transaction.session.create).not.toHaveBeenCalled();
    expect(transaction.refreshToken.create).not.toHaveBeenCalled();
  });

  it("keeps device binding optional for sessions issued before pairing", async () => {
    const { client, transaction, sessions } = fixture(null);

    await sessions.issueSession({ userId: "00000000-0000-4000-8000-000000000010" });

    expect(client.$transaction).toHaveBeenCalledTimes(1);
    expect(transaction.$executeRaw).toHaveBeenCalledTimes(1);
    expect(transaction.device.findFirst).not.toHaveBeenCalled();
    expect(transaction.session.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.not.objectContaining({ clientDeviceId: expect.anything() }),
    }));
  });

  it("uses supplied transaction repositories without nesting registration issuance", async () => {
    const { client, repositories, transaction, sessions } = fixture(null);

    await sessions.issueSession(
      { userId: "00000000-0000-4000-8000-000000000010" },
      repositories,
    );

    expect(client.$transaction).not.toHaveBeenCalled();
    expect(transaction.$executeRaw).toHaveBeenCalledTimes(1);
    expect(transaction.session.create).toHaveBeenCalledTimes(1);
    expect(transaction.refreshToken.create).toHaveBeenCalledTimes(1);
  });
});
