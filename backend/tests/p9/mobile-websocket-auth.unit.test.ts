import { describe, expect, it, vi } from "vitest";
import { errors } from "jose";

import { authenticateMobileAccessToken } from "../../src/p9/websocket/mobile-auth.js";

const userId = "00000000-0000-4000-8000-000000000010";
const sessionId = "00000000-0000-4000-8000-000000000020";

describe("mobile WebSocket authentication boundary", () => {
  it("derives identity and expiry only from a verified active session", async () => {
    const verify = vi.fn().mockResolvedValue({ sub: userId, sid: sessionId, exp: 2_000_000_000 });
    const isActive = vi.fn().mockResolvedValue(true);

    await expect(authenticateMobileAccessToken({ verify }, { isActive }, "secret")).resolves.toEqual({
      userId,
      sessionId,
      expiresAt: new Date(2_000_000_000_000),
    });
    expect(verify).toHaveBeenCalledWith("secret");
    expect(isActive).toHaveBeenCalledWith(userId, sessionId);
  });

  it("rejects revoked sessions and verification failures with the same null result", async () => {
    const verified = { verify: vi.fn().mockResolvedValue({ sub: userId, sid: sessionId, exp: 2_000_000_000 }) };
    await expect(authenticateMobileAccessToken(
      verified,
      { isActive: vi.fn().mockResolvedValue(false) },
      "revoked",
    )).resolves.toBeNull();
    await expect(authenticateMobileAccessToken(
      { verify: vi.fn().mockRejectedValue(new Error("bad token")) },
      { isActive: vi.fn() },
      "invalid",
    )).resolves.toBeNull();
  });

  it("distinguishes a cryptographically verified JWT expiry for close code 4410", async () => {
    await expect(authenticateMobileAccessToken(
      { verify: vi.fn().mockRejectedValue(new errors.JWTExpired("expired", {}, "exp", "check_failed")) },
      { isActive: vi.fn() },
      "expired",
    )).resolves.toEqual({ kind: "expired" });
  });
});
