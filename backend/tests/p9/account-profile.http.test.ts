import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { parseP9Config } from "../../src/p9/config.js";
import { P9Error } from "../../src/p9/errors.js";
import { createAuthRouter } from "../../src/p9/http/auth.route.js";
import { BoundedAvatarUploadAdmission, type AvatarUploadAdmission } from "../../src/p9/http/avatar-upload-admission.js";
import { p9ErrorHandler } from "../../src/p9/http/middleware.js";
import { createAvatarMediaRouter, createProfileRouter } from "../../src/p9/http/profile.route.js";
import { createPersonalizationRouter } from "../../src/p9/http/personalization.route.js";
import { createP9Router } from "../../src/p9/http/router.js";

const enabledConfig = parseP9Config({
  P9_ENABLED: "true",
  DATABASE_URL: "postgresql://bmo:password@127.0.0.1:5432/bmo",
  P9_JWT_SECRET: "j".repeat(32),
  P9_PAIRING_PEPPER: "p".repeat(32),
  PUBLIC_BASE_URL: "https://api.example.com",
  AVATAR_STORAGE_DIR: "/tmp/test-avatars",
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

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
    expect((await request(app).post("/auth/password/recovery/reset").set("X-Request-Id", "reset-1").send({
      recoveryToken: "opaque", newPassword: "new-password-long-enough",
    })).status).toBe(204);
    expect(recovery.reset).toHaveBeenCalledWith(
      { recoveryToken: "opaque", newPassword: "new-password-long-enough" },
      { requestId: "reset-1" },
    );
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

    const limited = await request(byIp.app)
      .post("/auth/password/recovery/reset")
      .set("X-Forwarded-For", "203.0.113.4")
      .set("X-Request-Id", "recovery-limit-1")
      .send({ recoveryToken: "opaque", newPassword: "new-password-long-enough" });
    expect(limited.status).toBe(429);
    expect(limited.headers["x-request-id"]).toBe("recovery-limit-1");

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

describe("P9 request envelope", () => {
  function fullRouterApp() {
    const app = express();
    app.use("/api/v1", createP9Router({
      config: enabledConfig,
      auth: { register: vi.fn(), login: vi.fn() },
      recovery: {},
      sessions: {},
      users: {},
      devices: {},
      pairing: {},
      settings: {},
      profile: {},
      avatars: {},
      personalization: {},
      chat: {},
      accessTokens: {},
      repositories: {},
    } as any));
    return app;
  }

  it("creates request context before JSON parsing and sanitizes malformed JSON", async () => {
    const response = await request(fullRouterApp())
      .post("/api/v1/auth/login")
      .set("Content-Type", "application/json")
      .set("X-Request-Id", "bad-json-1")
      .send('{"email":');
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "INVALID_INPUT" });
    expect(response.headers["x-request-id"]).toBe("bad-json-1");
  });

  it("sanitizes oversized JSON as 413 and retains the request ID", async () => {
    const response = await request(fullRouterApp())
      .post("/api/v1/auth/login")
      .set("Content-Type", "application/json")
      .set("X-Request-Id", "large-json-1")
      .send(JSON.stringify({ email: `${"a".repeat(33 * 1024)}@example.com` }));
    expect(response.status).toBe(413);
    expect(response.body).toEqual({ error: "PAYLOAD_TOO_LARGE" });
    expect(response.headers["x-request-id"]).toBe("large-json-1");
  });
});

describe("Phase 2B authenticated profile/settings/media routes", () => {
  function buildAuthedApp(
    maxBytes = 5 * 1024 * 1024,
    uploadRate = { userLimit: 10, ipLimit: 20 },
    admission?: AvatarUploadAdmission,
  ) {
    const accessTokens = { verify: vi.fn(async (token: string) => ({
      sub: token.startsWith("user-") ? token : "user-1",
      sid: "session-1",
    })) };
    const sessions = { isActive: vi.fn().mockResolvedValue(true) };
    const profile = { update: vi.fn().mockResolvedValue({ id: "user-1", username: "person" }) };
    const avatar = { upload: vi.fn().mockResolvedValue({ avatarUrl: "https://api.example.com/media/avatars/key.webp" }) };
    const personalization = {
      get: vi.fn().mockResolvedValue({
        baseStyleTone: "default", warmth: "default", enthusiasm: "default",
        headerAndLists: "default", emoji: "default", fastAnswers: false, customInstructions: "",
      }),
      update: vi.fn().mockResolvedValue({
        baseStyleTone: "default", warmth: "warm", enthusiasm: "default",
        headerAndLists: "default", emoji: "default", fastAnswers: false, customInstructions: "",
      }),
    };
    const storage = { read: vi.fn().mockResolvedValue(Buffer.from("webp")) };
    const app = express();
    app.use(express.json());
    app.set("trust proxy", 1);
    app.use(createProfileRouter(
      profile as any,
      avatar as any,
      accessTokens as any,
      sessions as any,
      maxBytes,
      {
        windowMs: 15 * 60 * 1_000,
        userLimit: uploadRate.userLimit,
        ipLimit: uploadRate.ipLimit,
        ...(admission ? { admission } : {}),
      },
    ));
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

  it("returns the exact bare seven-field personalization contract", async () => {
    const f = buildAuthedApp();
    const expected = {
      baseStyleTone: "default", warmth: "default", enthusiasm: "default",
      headerAndLists: "default", emoji: "default", fastAnswers: false, customInstructions: "",
    };
    const fetched = await request(f.app).get("/settings/personalization").set("Authorization", "Bearer token");
    expect(fetched.body).toEqual(expected);
    expect(Object.keys(fetched.body)).toHaveLength(7);

    const updated = await request(f.app).patch("/settings/personalization")
      .set("Authorization", "Bearer token").send({ warmth: "warm" });
    expect(updated.body).toEqual({ ...expected, warmth: "warm" });
    expect(Object.keys(updated.body)).toHaveLength(7);
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

  it("applies an independent authenticated-user avatar limit across changing client IPs", async () => {
    const f = buildAuthedApp(100, { userLimit: 2, ipLimit: 20 });
    const upload = (ip: string) => request(f.app).post("/me/avatar")
      .set("Authorization", "Bearer user-one")
      .set("X-Forwarded-For", ip)
      .attach("file", Buffer.from("image"), { filename: "avatar.png", contentType: "image/png" });

    expect((await upload("203.0.113.8")).status).toBe(200);
    expect((await upload("203.0.113.9")).status).toBe(200);
    const limited = await upload("203.0.113.10");
    expect(limited.status).toBe(429);
    expect(limited.body).toEqual({ error: "RATE_LIMITED" });
    expect(limited.headers["x-request-id"]).toEqual(expect.any(String));
  });

  it("applies an independent proxy-aware IP avatar limit across changing users", async () => {
    const f = buildAuthedApp(100, { userLimit: 20, ipLimit: 2 });
    const upload = (token: string) => request(f.app).post("/me/avatar")
      .set("Authorization", `Bearer ${token}`)
      .set("X-Forwarded-For", "203.0.113.20")
      .attach("file", Buffer.from("image"), { filename: "avatar.png", contentType: "image/png" });

    expect((await upload("user-one")).status).toBe(200);
    expect((await upload("user-two")).status).toBe(200);
    expect((await upload("user-three")).status).toBe(429);
  });

  it("rejects admission overload before Multer MIME validation or file buffering", async () => {
    const admission = new BoundedAvatarUploadAdmission({ maxActive: 1, maxWaiters: 0, maxActivePerOwner: 1, maxWaitersPerOwner: 0, maxActivePerIp: 1, maxWaitersPerIp: 0 });
    const held = await admission.acquire({ ownerKey: "held-owner", ipKey: "held-ip" });
    const f = buildAuthedApp(5 * 1024 * 1024, { userLimit: 20, ipLimit: 20 }, admission);

    const response = await request(f.app).post("/me/avatar")
      .set("Authorization", "Bearer token")
      .attach("file", Buffer.alloc(5 * 1024 * 1024 - 1), { filename: "avatar.gif", contentType: "image/gif" });

    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      error: "SERVICE_UNAVAILABLE",
      message: "Avatar upload temporarily unavailable",
    });
    expect(admission.snapshot()).toEqual({ active: 1, waiting: 0 });
    expect(f.avatar.upload).not.toHaveBeenCalled();
    held.release();
  });

  it("admits only a bounded number of multipart bodies before Multer", async () => {
    const admission = new BoundedAvatarUploadAdmission({ maxActive: 1, maxWaiters: 1, maxActivePerOwner: 1, maxWaitersPerOwner: 1, maxActivePerIp: 1, maxWaitersPerIp: 1 });
    const firstUpload = deferred<{ avatarUrl: string }>();
    const f = buildAuthedApp(5 * 1024 * 1024, { userLimit: 20, ipLimit: 20 }, admission);
    f.avatar.upload
      .mockImplementationOnce(() => firstUpload.promise)
      .mockResolvedValue({ avatarUrl: "https://api.example.com/media/avatars/key.webp" });
    const body = Buffer.alloc(5 * 1024 * 1024 - 1);
    const upload = (token: string) => request(f.app).post("/me/avatar")
      .set("Authorization", `Bearer ${token}`)
      .attach("file", body, { filename: "avatar.png", contentType: "image/png" });

    const first = upload("user-one").then((response) => response);
    await vi.waitFor(() => expect(f.avatar.upload).toHaveBeenCalledTimes(1));
    const second = upload("user-two").then((response) => response);
    await vi.waitFor(() => expect(admission.snapshot()).toEqual({ active: 1, waiting: 1 }));

    const overloaded = await upload("user-three");
    expect(overloaded.status).toBe(503);
    expect(f.avatar.upload).toHaveBeenCalledTimes(1);

    firstUpload.resolve({ avatarUrl: "https://api.example.com/media/avatars/key.webp" });
    expect((await first).status).toBe(200);
    expect((await second).status).toBe(200);
    expect(f.avatar.upload).toHaveBeenCalledTimes(2);
    expect(admission.snapshot()).toEqual({ active: 0, waiting: 0 });
  });

  it("releases multipart admission after success, Multer rejection, and service failure", async () => {
    const admission = new BoundedAvatarUploadAdmission({ maxActive: 1, maxWaiters: 0, maxActivePerOwner: 1, maxWaitersPerOwner: 0, maxActivePerIp: 1, maxWaitersPerIp: 0 });
    const f = buildAuthedApp(100, { userLimit: 20, ipLimit: 20 }, admission);
    const upload = (contentType = "image/png") => request(f.app).post("/me/avatar")
      .set("Authorization", "Bearer token")
      .attach("file", Buffer.from("image"), { filename: "avatar.bin", contentType });

    expect((await upload()).status).toBe(200);
    expect(admission.snapshot()).toEqual({ active: 0, waiting: 0 });
    expect((await upload("image/gif")).status).toBe(400);
    expect(admission.snapshot()).toEqual({ active: 0, waiting: 0 });
    f.avatar.upload.mockRejectedValueOnce(new Error("private service failure"));
    expect((await upload()).status).toBe(500);
    expect(admission.snapshot()).toEqual({ active: 0, waiting: 0 });
  });

  it("retains admission after client disconnect until buffer-backed avatar work settles", async () => {
    const admission = new BoundedAvatarUploadAdmission({ maxActive: 1, maxWaiters: 0, maxActivePerOwner: 1, maxWaitersPerOwner: 0, maxActivePerIp: 1, maxWaitersPerIp: 0 });
    const firstUpload = deferred<{ avatarUrl: string }>();
    const f = buildAuthedApp(5 * 1024 * 1024, { userLimit: 20, ipLimit: 20 }, admission);
    f.avatar.upload
      .mockImplementationOnce(() => firstUpload.promise)
      .mockResolvedValue({ avatarUrl: "https://api.example.com/media/avatars/key.webp" });
    const body = Buffer.alloc(5 * 1024 * 1024 - 1);
    const upload = (token: string) => request(f.app).post("/me/avatar")
      .set("Authorization", `Bearer ${token}`)
      .attach("file", body, { filename: "avatar.png", contentType: "image/png" });

    const abandoned = upload("user-one");
    abandoned.end(() => undefined);
    await vi.waitFor(() => expect(f.avatar.upload).toHaveBeenCalledTimes(1));
    abandoned.abort();
    await new Promise<void>((resolve) => { setTimeout(resolve, 50); });
    expect(admission.snapshot()).toEqual({ active: 1, waiting: 0 });

    const overloaded = await upload("user-two");
    expect(overloaded.status).toBe(503);
    expect(f.avatar.upload).toHaveBeenCalledTimes(1);

    firstUpload.resolve({ avatarUrl: "https://api.example.com/media/avatars/key.webp" });
    await vi.waitFor(() => expect(admission.snapshot()).toEqual({ active: 0, waiting: 0 }));
    expect((await upload("user-three")).status).toBe(200);
    expect(f.avatar.upload).toHaveBeenCalledTimes(2);
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

  it("contains media failures locally and attaches one stable request ID", async () => {
    const storage = { read: vi.fn().mockRejectedValue(new Error("private filesystem detail")) };
    const app = express();
    app.use(createAvatarMediaRouter(storage as any));
    const key = "4f37e5f8-a53a-4d18-8f9a-7b6e5cb8c003";
    const response = await request(app).get(`/media/avatars/${key}.webp`).set("X-Request-Id", "media-request-1");
    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: "INTERNAL_ERROR" });
    expect(response.headers["x-request-id"]).toBe("media-request-1");
    expect(JSON.stringify(response.body)).not.toContain("filesystem");
  });
});
