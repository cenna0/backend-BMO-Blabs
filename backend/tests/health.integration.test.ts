import { afterEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

import { createHealthRouter } from "../src/http/health.route.js";
import { startTestRuntime, stopTestRuntime, type TestRuntime } from "./helpers/test-runtime.js";

let runtime: TestRuntime | undefined;

afterEach(async () => {
  if (runtime) await stopTestRuntime(runtime);
  runtime = undefined;
});

describe("backend health endpoints", () => {
  it("keeps liveness dependency-free", async () => {
    const check = vi.fn(async () => {
      throw new Error("dependency probe must not run");
    });
    const app = express();
    app.use(createHealthRouter({ hardwareTestMode: false, readiness: { check } }));

    await request(app).get("/livez").expect(200, {
      status: "ok",
      backend: "ok",
    });

    expect(check).not.toHaveBeenCalled();
  });

  it("reports mandatory dependencies ready without leaking probe details", async () => {
    const app = express();
    app.use(
      createHealthRouter({
        hardwareTestMode: false,
        readiness: {
          check: async () => ({
            hermesReady: true,
            audioReady: true,
          }),
        },
      }),
    );

    const expected = {
      status: "ok",
      backend: "ok",
      hermes: "ok",
      audio_service: "ok",
    };
    await request(app).get("/readyz").expect(200, expected);
    await request(app).get("/health").expect(200, expected);
  });

  it("adds healthy database readiness only when P9 is enabled", async () => {
    const app = express();
    app.use(
      createHealthRouter({
        hardwareTestMode: false,
        databaseEnabled: true,
        readiness: {
          check: async () => ({
            hermesReady: true,
            audioReady: true,
            databaseReady: true,
          }),
        },
      }),
    );

    await request(app).get("/readyz").expect(200, {
      status: "ok",
      backend: "ok",
      hermes: "ok",
      audio_service: "ok",
      database: "ok",
    });
  });

  it("returns sanitized 503 database:error while P9 migrations are pending", async () => {
    const app = express();
    app.use(
      createHealthRouter({
        hardwareTestMode: false,
        databaseEnabled: true,
        readiness: {
          check: async () => ({
            hermesReady: true,
            audioReady: true,
            databaseReady: false,
          }),
        },
      }),
    );

    await request(app).get("/readyz").expect(503, {
      status: "error",
      backend: "ok",
      hermes: "ok",
      audio_service: "ok",
      database: "error",
    });
    await request(app).get("/livez").expect(200, { status: "ok", backend: "ok" });
  });

  it("returns sanitized not-ready responses while liveness remains healthy", async () => {
    const app = express();
    app.use(
      createHealthRouter({
        hardwareTestMode: false,
        readiness: {
          check: async () => ({
            hermesReady: false,
            audioReady: true,
          }),
        },
      }),
    );

    const expected = {
      status: "error",
      backend: "ok",
      hermes: "error",
      audio_service: "ok",
    };
    await request(app).get("/readyz").expect(503, expected);
    await request(app).get("/health").expect(503, expected);
    await request(app).get("/livez").expect(200);
  });

  it("contains unexpected probe failures instead of terminating the service", async () => {
    const app = express();
    app.use(
      createHealthRouter({
        hardwareTestMode: false,
        readiness: {
          check: async () => {
            throw new Error("sensitive dependency detail");
          },
        },
      }),
    );

    const response = await request(app).get("/readyz").expect(503);
    expect(response.body).toEqual({
      status: "error",
      backend: "ok",
      hermes: "error",
      audio_service: "error",
    });
    expect(JSON.stringify(response.body)).not.toContain("sensitive dependency detail");
    await request(app).get("/livez").expect(200);
  });

  it("reports an honest healthy hardware-test transport without secrets", async () => {
    runtime = await startTestRuntime();

    await request(runtime.baseUrl).get("/livez").expect(200, {
      status: "ok",
      backend: "ok",
    });
    await request(runtime.baseUrl).get("/readyz").expect(200, {
      status: "ok",
      backend: "ok",
      hermes: "bypassed",
      audio_service: "bypassed",
    });
    const response = await request(runtime.baseUrl).get("/health").expect(200);

    expect(response.body).toEqual({
      status: "ok",
      backend: "ok",
      hermes: "bypassed",
      audio_service: "bypassed",
    });
    expect(JSON.stringify(response.body)).not.toContain("test-device-secret");
  });
});
