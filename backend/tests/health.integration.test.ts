import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";

import { startTestRuntime, stopTestRuntime, type TestRuntime } from "./helpers/test-runtime.js";

let runtime: TestRuntime | undefined;

afterEach(async () => {
  if (runtime) await stopTestRuntime(runtime);
  runtime = undefined;
});

describe("GET /health", () => {
  it("reports an honest healthy hardware-test transport without secrets", async () => {
    runtime = await startTestRuntime();

    const response = await request(runtime.baseUrl).get("/health").expect(200);

    expect(response.body).toEqual({
      status: "ok",
      backend: "ok",
      hermes: "bypassed",
      audio_service: "bypassed",
      rvc: "bypassed",
    });
    expect(JSON.stringify(response.body)).not.toContain("test-device-secret");
  });
});
