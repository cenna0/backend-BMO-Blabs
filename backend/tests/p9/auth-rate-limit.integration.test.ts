import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { createAuthRouter } from "../../src/p9/http/auth.route.js";

function createApp() {
  const login = vi.fn().mockResolvedValue({
    user: { id: "user-1", email: "person@example.com" },
    session: {
      sessionId: "session-1",
      accessToken: "access-token",
      refreshToken: "refresh-token",
      accessTokenExpiresAt: new Date("2026-08-11T10:00:00.000Z"),
      refreshTokenExpiresAt: new Date("2026-09-10T10:00:00.000Z"),
    },
  });
  const app = express();
  app.set("trust proxy", 1);
  app.use(express.json());
  app.use("/api/v1", createAuthRouter({
    config: { loginWindowMs: 60_000, loginLimit: 2 } as never,
    auth: { login, register: vi.fn() } as never,
    sessions: { refresh: vi.fn(), isActive: vi.fn() } as never,
    users: { getById: vi.fn() } as never,
    accessTokens: { verify: vi.fn() } as never,
  }));
  return { app, login };
}

function login(app: express.Express, forwardedFor: string) {
  return request(app)
    .post("/api/v1/auth/login")
    .set("X-Forwarded-For", forwardedFor)
    .send({ email: "person@example.com", password: "safe-test-password" });
}

describe("one-hop proxy-aware auth rate limiting", () => {
  it("uses the rightmost Caddy-supplied client address despite attacker-controlled earlier entries", async () => {
    const { app, login: loginHandler } = createApp();

    await login(app, "203.0.113.1, 198.51.100.10").expect(200);
    await login(app, "203.0.113.2, 198.51.100.10").expect(200);
    await login(app, "203.0.113.3, 198.51.100.10").expect(429, { error: "RATE_LIMITED" });
    expect(loginHandler).toHaveBeenCalledTimes(2);
  });

  it("assigns distinct rightmost client addresses to distinct buckets", async () => {
    const { app, login: loginHandler } = createApp();

    await login(app, "203.0.113.1, 198.51.100.20").expect(200);
    await login(app, "203.0.113.2, 198.51.100.20").expect(200);
    await login(app, "203.0.113.3, 198.51.100.20").expect(429);
    await login(app, "203.0.113.1, 198.51.100.21").expect(200);
    expect(loginHandler).toHaveBeenCalledTimes(3);
  });
});
