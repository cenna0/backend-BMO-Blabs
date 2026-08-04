import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";

import { createP9Router } from "../../src/p9/http/router.js";

function appWithOps(includeOps: boolean) {
  const app = express();
  app.use(createP9Router({
    includeOps,
    auth: {} as never,
    sessions: {} as never,
    users: {} as never,
    devices: {} as never,
    pairing: {} as never,
    settings: {} as never,
    accessTokens: {} as never,
    repositories: {
      healthCheck: async () => undefined,
      migrationStatus: async () => [{ name: "review", finishedAt: new Date() }],
    } as never,
    config: {
      loginWindowMs: 900_000,
      loginLimit: 5,
      pairingWindowMs: 900_000,
      pairingLimit: 10,
    } as never,
  }));
  return app;
}

describe("P9 operational route exposure", () => {
  it("does not mount database diagnostics in the normal Backend runtime", async () => {
    await request(appWithOps(false)).get("/ops/db/livez").expect(404);
  });

  it("keeps diagnostics available only when the isolated candidate opts in", async () => {
    await request(appWithOps(true)).get("/ops/db/livez").expect(200).expect({ status: "ok", database: "ok" });
  });
});
