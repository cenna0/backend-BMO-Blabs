import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";

import { createP9Router } from "../../src/p9/http/router.js";
import { P9_REQUIRED_MIGRATIONS } from "../../src/p9/migration-manifest.js";

const foundation = "20260804110000_p9_1_foundation";
const integrityConstraints = "20260804123000_p9_1_integrity_constraints";

function appWithOps(
  includeOps: boolean,
  migrations: Array<{ name: string; finishedAt: Date | null }> = P9_REQUIRED_MIGRATIONS.map(
    (name) => ({ name, finishedAt: new Date() }),
  ),
) {
  const app = express();
  app.use(createP9Router({
    includeOps,
    auth: {} as never,
    sessions: {} as never,
    users: {} as never,
    devices: {} as never,
    pairing: {} as never,
    settings: {} as never,
    recovery: {} as never,
    profile: {} as never,
    avatars: {} as never,
    personalization: {} as never,
    chat: {} as never,
    memory: {} as never,
    accessTokens: {} as never,
    repositories: {
      healthCheck: async () => undefined,
      migrationStatus: async () => migrations,
    } as never,
    config: {
      loginWindowMs: 900_000,
      loginLimit: 5,
      pairingWindowMs: 900_000,
      pairingLimit: 10,
      avatarMaxBytes: 5 * 1024 * 1024,
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

  it("rejects readiness when the latest required source migration is absent", async () => {
    await request(appWithOps(true, [
      { name: foundation, finishedAt: new Date() },
    ])).get("/ops/db/readyz").expect(503).expect({
      status: "error",
      database: "migrations_pending",
      migration_count: 1,
    });
  });

  it("rejects readiness when any required source migration is unfinished", async () => {
    await request(appWithOps(true, [
      { name: foundation, finishedAt: new Date() },
      { name: integrityConstraints, finishedAt: null },
    ])).get("/ops/db/readyz").expect(503);
  });

  it("accepts readiness when every required source migration is finished", async () => {
    await request(appWithOps(true)).get("/ops/db/readyz").expect(200).expect({
      status: "ok",
      database: "ready",
      migration_count: P9_REQUIRED_MIGRATIONS.length,
    });
  });
});
