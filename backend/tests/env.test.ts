import { describe, expect, it } from "vitest";

import { parseEnv } from "../src/config/env.js";

const minimal = {
  DEVICE_ID: "bmo-001",
  DEVICE_TOKEN: "test-device-secret",
  PUBLIC_BASE_URL: "http://127.0.0.1:3000",
  TEMP_AUDIO_DIR: "C:/tmp/bmo-tests",
  HARDWARE_TEST_MP3_PATH: "C:/fixtures/test-response.mp3",
};

describe("parseEnv", () => {
  it("uses canonical P1 defaults with hardware test mode disabled", () => {
    const config = parseEnv(minimal);

    expect(config.HARDWARE_TEST_MODE).toBe(false);
    expect(config.MAX_AUDIO_BYTES).toBe(3_145_728);
    expect(config.MAX_AUDIO_DURATION_SECONDS).toBe(60);
    expect(config.WS_AUTH_TIMEOUT_MS).toBe(5_000);
    expect(config.WS_HEARTBEAT_INTERVAL_MS).toBe(60_000);
    expect(config.WS_MAX_MISSED_PONGS).toBe(2);
  });

  it("parses an explicit hardware test mode flag", () => {
    expect(parseEnv({ ...minimal, HARDWARE_TEST_MODE: "true" }).HARDWARE_TEST_MODE).toBe(true);
    expect(parseEnv({ ...minimal, HARDWARE_TEST_MODE: "false" }).HARDWARE_TEST_MODE).toBe(false);
  });

  it("rejects hardware test mode in production", () => {
    expect(() =>
      parseEnv({ ...minimal, NODE_ENV: "production", HARDWARE_TEST_MODE: "true" }),
    ).toThrow(/HARDWARE_TEST_MODE/);
  });

  it("rejects weak or missing device credentials", () => {
    expect(() => parseEnv({ ...minimal, DEVICE_TOKEN: "short" })).toThrow(/DEVICE_TOKEN/);
    expect(() => parseEnv({ ...minimal, DEVICE_ID: "" })).toThrow(/DEVICE_ID/);
  });
});
