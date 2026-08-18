import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { createPairingRouter } from "../../src/p9/http/pairing.route.js";
import { p9ErrorHandler } from "../../src/p9/http/middleware.js";

function fixture(pairingLimit = 10) {
  const pairing = {
    claim: vi.fn().mockResolvedValue({
      id: "device-1",
      hardwareId: "bmo-001",
      name: "BMO",
      status: "ACTIVE",
      pairedAt: "2026-08-18T12:00:00.000Z",
      lastSeenAt: null,
    }),
  };
  const accessTokens = {
    verify: vi.fn().mockResolvedValue({ sub: "user-1", sid: "session-1" }),
  };
  const sessions = { isActive: vi.fn().mockResolvedValue(true) };
  const app = express();
  app.use(express.json());
  app.use(createPairingRouter(pairing as never, accessTokens as never, sessions as never, {
    pairingWindowMs: 900_000,
    pairingLimit,
  } as never));
  app.use(p9ErrorHandler);
  return { app, pairing, accessTokens };
}

describe("code-only pairing route", () => {
  it("claims with only the six-digit code", async () => {
    const f = fixture();
    await request(f.app)
      .post("/pairing/claim")
      .set("Authorization", "Bearer access-token")
      .send({ code: "123456" })
      .expect(201)
      .expect(({ body }) => expect(body.device.id).toBe("device-1"));

    expect(f.pairing.claim).toHaveBeenCalledWith("user-1", { code: "123456" }, expect.any(String));
  });

  it("rejects legacy credential fields and does not call the service", async () => {
    const f = fixture();
    await request(f.app)
      .post("/pairing/claim")
      .set("Authorization", "Bearer access-token")
      .send({ code: "123456", hardwareId: "bmo-001", deviceCredential: "legacy-secret" })
      .expect(400);

    expect(f.pairing.claim).not.toHaveBeenCalled();
  });

  it("does not expose the old ordinary Mobile pairing endpoints", async () => {
    const f = fixture();
    await request(f.app)
      .post("/pairing/challenges")
      .set("Authorization", "Bearer access-token")
      .send({})
      .expect(404);
    await request(f.app)
      .post("/pairing/legacy-id/claim")
      .set("Authorization", "Bearer access-token")
      .send({ code: "123456", hardwareId: "bmo-001", deviceCredential: "legacy-secret" })
      .expect(404);
  });

  it("rate-limits repeated authenticated claim attempts", async () => {
    const f = fixture(1);
    const headers = { Authorization: "Bearer access-token" };
    await request(f.app).post("/pairing/claim").set(headers).send({ code: "123456" }).expect(201);
    await request(f.app).post("/pairing/claim").set(headers).send({ code: "123456" }).expect(429);
  });

  it("applies the session limit independently of the user limit", async () => {
    const f = fixture(1);
    f.accessTokens.verify
      .mockResolvedValueOnce({ sub: "user-1", sid: "shared-session" })
      .mockResolvedValueOnce({ sub: "user-2", sid: "shared-session" });
    const headers = { Authorization: "Bearer access-token" };

    await request(f.app).post("/pairing/claim").set(headers).send({ code: "123456" }).expect(201);
    await request(f.app).post("/pairing/claim").set(headers).send({ code: "123456" }).expect(429);
  });

  it("applies the IP limit across users and sessions", async () => {
    const f = fixture(1);
    f.accessTokens.verify
      .mockResolvedValueOnce({ sub: "user-1", sid: "session-1" })
      .mockResolvedValueOnce({ sub: "user-2", sid: "session-2" })
      .mockResolvedValueOnce({ sub: "user-3", sid: "session-3" });
    const headers = { Authorization: "Bearer access-token" };

    await request(f.app).post("/pairing/claim").set(headers).send({ code: "123456" }).expect(201);
    await request(f.app).post("/pairing/claim").set(headers).send({ code: "123456" }).expect(201);
    await request(f.app).post("/pairing/claim").set(headers).send({ code: "123456" }).expect(429);
  });
});
