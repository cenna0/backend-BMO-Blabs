import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { parseP9Config } from "../../src/p9/config.js";
import { P9Error } from "../../src/p9/errors.js";
import { createAuthRouter } from "../../src/p9/http/auth.route.js";
import { p9ErrorHandler } from "../../src/p9/http/middleware.js";
import { createAvatarMediaRouter, createProfileRouter } from "../../src/p9/http/profile.route.js";
import { createPersonalizationRouter } from "../../src/p9/http/personalization.route.js";

const enabledConfig = parseP9Config({
  P9_ENABLED: "true",
  DATABASE_URL: "postgresql://bmo:password@127.0.0.1:5432/bmo",
  P9_JWT_SECRET: "j".repeat(32),
  P9_PAIRING_PEPPER: "p".repeat(32),
  PUBLIC_BASE_URL: "https://api.example.com",
  AVATAR_STORAGE_DIR: "/tmp/test-avatars",
});

function buildApp(overrides: Record<string, unknown> = {}) {
  const recovery = {
    verify: vi.fn().mockResolvedValue({
      recoveryToken: "opaque-recovery-token",
      expiresAt: new Date("2026-08-11T12:10:00.000Z"),
    }),
    reset: vi.fn().mockResolvedValue(undefined),
  };
  const auth = { register: vi.fn(), login: vi.fn() };
  const app = express();
  app.set("trust proxy", 1);
  app.use(express.json());
  app.use(createAuthRouter({
    config: { ...enabledConfig, ...overrides },
    auth,
    recovery,
    sessions: {} as any,
    users: {} as any,
    accessTokens: {} as any,
  } as any));
  app.use(p9ErrorHandler);
  return { app, recovery, auth };
}

describe("Phase 2B auth HTTP routes", () => {
  it("registers recovery verify/reset with canonical response shapes", async () => {
    const { app, recovery } = buildApp();
    const verified = await request(app).post("/auth/password/recovery/verify").send({
      email: "p@example.com", dateOfBirth: "2004-05-19",
    });
    expect(verified.status).toBe(200);
    expect(verified.body).toEqual({
      recoveryToken: "opaque-recovery-token",
      expiresAt: "2026-08-11T12:10:00.000Z",
    });
    expect(recovery.verify).toHaveBeenCalledWith(
      { email: "p@example.com", dateOfBirth: "2004-05-19" },
      expect.objectContaining({ ip: expect.any(String), requestId: expect.any(String) }),
    );
    expect((await request(app).post("/auth/password/recovery/reset").send({
      recoveryToken: "opaque", newPassword: "new-password-long-enough",
    })).status).toBe(204);
  });

  it("applies independent aggressive per-IP and normalized-email recovery limits", async () => {
    const byIp = buildApp({ recoveryIpLimit: 2, recoveryEmailLimit: 20 });
    byIp.recovery.verify.mockRejectedValue(new P9Error("RECOVERY_INVALID", 400, "Recovery verification failed"));
    const ipStatuses: number[] = [];
    for (let index = 0; index < 3; index += 1) {
      ipStatuses.push((await request(byIp.app)
        .post("/auth/password/recovery/verify")
        .set("X-Forwarded-For", "203.0.113.4")
        .send({ email: `person-${index}@example.com`, dateOfBirth: "2004-05-19" })).status);
    }
    expect(ipStatuses).toEqual([400, 400, 429]);

    const byEmail = buildApp({ recoveryIpLimit: 20, recoveryEmailLimit: 2 });
    byEmail.recovery.verify.mockRejectedValue(new P9Error("RECOVERY_INVALID", 400, "Recovery verification failed"));
    const emailStatuses: number[] = [];
    for (let index = 0; index < 3; index += 1) {
      emailStatuses.push((await request(byEmail.app)
        .post("/auth/password/recovery/verify")
        .set("X-Forwarded-For", `203.0.113.${index + 10}`)
        .send({ email: index % 2 ? " PERSON@example.com " : "person@EXAMPLE.com", dateOfBirth: "2004-05-19" })).status);
    }
    expect(emailStatuses).toEqual([400, 400, 429]);
  });
});

describe("Phase 2B authenticated profile/settings/media routes", () => {
  function buildAuthedApp(maxBytes = 5 * 1024 * 1024) {
    const accessTokens = { verify: vi.fn().mockResolvedValue({ sub: "user-1", sid: "session-1" }) };
    const sessions = { isActive: vi.fn().mockResolvedValue(true) };
    const profile = { update: vi.fn().mockResolvedValue({ id: "user-1", username: "person" }) };
    const avatar = { upload: vi.fn().mockResolvedValue({ avatarUrl: "https://api.example.com/media/avatars/key.webp" }) };
    const personalization = {
      get: vi.fn().mockResolvedValue({ baseStyleTone: "default", warmth: "default" }),
      update: vi.fn().mockResolvedValue({ baseStyleTone: "default", warmth: "warm" }),
    };
    const storage = { read: vi.fn().mockResolvedValue(Buffer.from("webp")) };
    const app = express();
    app.use(express.json());
    app.use(createProfileRouter(profile as any, avatar as any, accessTokens as any, sessions as any, maxBytes));
    app.use(createPersonalizationRouter(personalization as any, accessTokens as any, sessions as any));
    app.use(createAvatarMediaRouter(storage as any));
    app.use(p9ErrorHandler);
    return { app, profile, avatar, personalization, storage };
  }

  it("binds profile and personalization mutations to bearer ownership", async () => {
    const f = buildAuthedApp();
    expect((await request(f.app).patch("/me/profile").set("Authorization", "Bearer token").send({ username: "PERSON" })).status).toBe(200);
    expect(f.profile.update).toHaveBeenCalledWith("user-1", { username: "PERSON" }, expect.any(String));
    expect((await request(f.app).get("/settings/personalization").set("Authorization", "Bearer token")).status).toBe(200);
    expect(f.personalization.get).toHaveBeenCalledWith("user-1");
    expect((await request(f.app).patch("/settings/personalization").set("Authorization", "Bearer token").send({ warmth: "warm" })).status).toBe(200);
    expect(f.personalization.update).toHaveBeenCalledWith("user-1", { warmth: "warm" }, expect.any(String));
  });

  it("accepts only multipart field file and enforces upload size before the avatar service", async () => {
    const f = buildAuthedApp(10);
    const accepted = await request(f.app).post("/me/avatar").set("Authorization", "Bearer token")
      .attach("file", Buffer.from("image"), { filename: "../../attacker.png", contentType: "image/png" });
    expect(accepted.status).toBe(200);
    expect(f.avatar.upload).toHaveBeenCalledWith("user-1", Buffer.from("image"), "image/png", expect.any(String));
    expect((await request(f.app).post("/me/avatar").set("Authorization", "Bearer token")).status).toBe(400);
    expect((await request(f.app).post("/me/avatar").set("Authorization", "Bearer token")
      .attach("photo", Buffer.from("image"), { filename: "wrong.png", contentType: "image/png" })).status).toBe(400);
    expect((await request(f.app).post("/me/avatar").set("Authorization", "Bearer token")
      .attach("file", Buffer.alloc(11), { filename: "large.png", contentType: "image/png" })).status).toBe(400);
  });

  it("serves only exact opaque WebP paths with hardened immutable headers", async () => {
    const f = buildAuthedApp();
    const key = "4f37e5f8-a53a-4d18-8f9a-7b6e5cb8c003";
    const served = await request(f.app).get(`/media/avatars/${key}.webp`);
    expect(served.status).toBe(200);
    expect(served.headers["content-type"]).toMatch(/^image\/webp/);
    expect(served.headers["x-content-type-options"]).toBe("nosniff");
    expect(served.headers["cache-control"]).toContain("immutable");
    expect(f.storage.read).toHaveBeenCalledWith(key);
    expect((await request(f.app).get("/media/avatars/not-a-uuid.webp")).status).toBe(404);
    expect((await request(f.app).get(`/media/avatars/${key}.png`)).status).toBe(404);
  });
});
