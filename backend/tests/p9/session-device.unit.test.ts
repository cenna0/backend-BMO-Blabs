import { describe, expect, it, vi } from "vitest";

import { AccessTokenService, SessionService } from "../../src/p9/services/session.service.js";

function fixture(device: { id: string } | null) {
  const repositories = {
    device: { findFirst: vi.fn().mockResolvedValue(device) },
    session: { create: vi.fn().mockResolvedValue({ id: "session-1" }) },
    refreshToken: { create: vi.fn().mockResolvedValue({ id: "refresh-1" }) },
  };
  const accessTokens = new AccessTokenService({
    secret: new TextEncoder().encode("s".repeat(32)),
    issuer: "bmo-p9",
    audience: "bmo-mobile",
    lifetimeSeconds: 900,
  });
  return {
    repositories,
    sessions: new SessionService({
      client: {} as never,
      repositories: repositories as never,
      accessTokens,
      refreshTokenTtlSeconds: 2_592_000,
    }),
  };
}

describe("mobile session device identity", () => {
  it("stores clientDeviceId only after active ownership validation", async () => {
    const { repositories, sessions } = fixture({ id: "00000000-0000-4000-8000-000000000001" });

    await sessions.issueSession({
      userId: "00000000-0000-4000-8000-000000000010",
      clientDeviceId: "00000000-0000-4000-8000-000000000001",
    });

    expect(repositories.device.findFirst).toHaveBeenCalledWith({
      where: {
        id: "00000000-0000-4000-8000-000000000001",
        userId: "00000000-0000-4000-8000-000000000010",
        status: "ACTIVE",
      },
      select: { id: true },
    });
    expect(repositories.session.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ clientDeviceId: "00000000-0000-4000-8000-000000000001" }),
    }));
  });

  it("rejects an unowned clientDeviceId before issuing tokens", async () => {
    const { repositories, sessions } = fixture(null);

    await expect(sessions.issueSession({
      userId: "00000000-0000-4000-8000-000000000010",
      clientDeviceId: "00000000-0000-4000-8000-000000000002",
    })).rejects.toMatchObject({ code: "OWNERSHIP_DENIED", status: 404 });
    expect(repositories.session.create).not.toHaveBeenCalled();
    expect(repositories.refreshToken.create).not.toHaveBeenCalled();
  });

  it("keeps device binding optional for sessions issued before pairing", async () => {
    const { repositories, sessions } = fixture(null);

    await sessions.issueSession({ userId: "00000000-0000-4000-8000-000000000010" });

    expect(repositories.device.findFirst).not.toHaveBeenCalled();
    expect(repositories.session.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.not.objectContaining({ clientDeviceId: expect.anything() }),
    }));
  });
});
