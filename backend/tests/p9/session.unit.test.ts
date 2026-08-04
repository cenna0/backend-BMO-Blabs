import { describe, expect, it } from "vitest";

import { SignJWT } from "jose";

import { AccessTokenService } from "../../src/p9/services/session.service.js";

const secret = new TextEncoder().encode("a".repeat(32));

describe("P9 access tokens", () => {
  const tokens = new AccessTokenService({
    secret,
    issuer: "bmo-p9",
    audience: "bmo-mobile",
    lifetimeSeconds: 900,
  });

  it("issues minimal signed identity/session claims with a 15-minute lifetime", async () => {
    const issued = await tokens.issue({ userId: "user-1", sessionId: "session-1" });
    const payload = await tokens.verify(issued.token);
    expect(payload).toMatchObject({ sub: "user-1", sid: "session-1", iss: "bmo-p9", aud: "bmo-mobile" });
    expect(payload.exp! - payload.iat!).toBe(900);
    expect(payload).not.toHaveProperty("password");
    expect(payload).not.toHaveProperty("settings");
    expect(issued.expiresAt).toBeInstanceOf(Date);
  });

  it("rejects malformed, wrong-audience, and expired tokens", async () => {
    await expect(tokens.verify("not-a-jwt")).rejects.toThrow();
    const wrongAudience = await new SignJWT({ sub: "user-1", sid: "session-1" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer("bmo-p9")
      .setAudience("other")
      .setExpirationTime("15m")
      .setIssuedAt()
      .sign(secret);
    await expect(tokens.verify(wrongAudience)).rejects.toThrow();
    const expired = await new SignJWT({ sub: "user-1", sid: "session-1" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer("bmo-p9")
      .setAudience("bmo-mobile")
      .setExpirationTime("0s")
      .setIssuedAt(1)
      .sign(secret);
    await expect(tokens.verify(expired)).rejects.toThrow();
  });

  it("rejects signed tokens without a valid issued-at claim", async () => {
    const missingIssuedAt = await new SignJWT({ sub: "user-1", sid: "session-1" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer("bmo-p9")
      .setAudience("bmo-mobile")
      .setExpirationTime("15m")
      .sign(secret);
    await expect(tokens.verify(missingIssuedAt)).rejects.toThrow();
  });
});
