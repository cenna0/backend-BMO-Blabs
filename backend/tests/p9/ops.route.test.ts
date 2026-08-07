import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";

import { createP9Router } from "../../src/p9/http/router.js";

function appWithOps(includeOps?: boolean) {
  const app = express();
  app.use(createP9Router({
    ...(includeOps === undefined ? {} : { includeOps }),
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
      databaseIdentity: async () => "bmo_restore_acceptance_test",
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
  it("does not mount database diagnostics by default", async () => {
    await request(appWithOps()).get("/ops/db/livez").expect(404);
    await request(appWithOps(false)).get("/ops/db/livez").expect(404);
  });

  it("keeps diagnostics available only when the isolated candidate opts in", async () => {
    await request(appWithOps(true)).get("/ops/db/livez").expect(200).expect({ status: "ok", database: "ok" });
  });

  it("reports only the current database identity on the isolated ops surface", async () => {
    await request(appWithOps(true)).get("/ops/db/identity").expect(200).expect({ database: "bmo_restore_acceptance_test" });
    await request(appWithOps(false)).get("/ops/db/identity").expect(404);
  });
});
