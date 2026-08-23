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
  const register = vi.fn().mockResolvedValue({
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
    auth: { login, register } as never,
    sessions: { refresh: vi.fn(), isActive: vi.fn() } as never,
    users: { getById: vi.fn() } as never,
    accessTokens: { verify: vi.fn() } as never,
  }));
  return { app, login, register };
}

function login(app: express.Express, forwardedFor: string, email = "person@example.com") {
  return request(app)
    .post("/api/v1/auth/login")
    .set("X-Forwarded-For", forwardedFor)
    .send({ email, password: "safe-test-password" });
}

function register(app: express.Express, forwardedFor: string, email = "person@example.com") {
  return request(app)
    .post("/api/v1/auth/register")
    .set("X-Forwarded-For", forwardedFor)
    .send({ email, password: "safe-test-password" });
}

describe("auth rate limiting", () => {
  it("allows repeated login requests through to the handler", async () => {
    const { app, login: loginHandler } = createApp();

    for (let attempt = 0; attempt < 6; attempt += 1) {
      await login(app, `203.0.113.${attempt + 1}, 198.51.100.10`).expect(200);
    }
    expect(loginHandler).toHaveBeenCalledTimes(6);
  });

  it("keeps registration rate limited by the effective client address", async () => {
    const { app, register: registerHandler } = createApp();

    await register(app, "203.0.113.1, 198.51.100.20").expect(201);
    await register(app, "203.0.113.2, 198.51.100.20").expect(201);
    await register(app, "203.0.113.3, 198.51.100.20").expect(429, { error: "RATE_LIMITED" });
    await register(app, "203.0.113.1, 198.51.100.21").expect(201);
    expect(registerHandler).toHaveBeenCalledTimes(3);
  });
});
