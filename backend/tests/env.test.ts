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

    expect(config.BACKEND_HOST).toBe("127.0.0.1");
    expect(config.HARDWARE_TEST_MODE).toBe(false);
    expect(config.MAX_AUDIO_BYTES).toBe(3_145_728);
    expect(config.MAX_AUDIO_DURATION_SECONDS).toBe(60);
    expect(config.WS_AUTH_TIMEOUT_MS).toBe(5_000);
    expect(config.WS_HEARTBEAT_INTERVAL_MS).toBe(60_000);
    expect(config.WS_MAX_MISSED_PONGS).toBe(2);
  });

  it("uses canonical P4 local orchestration defaults", () => {
    const config = parseEnv(minimal);

    expect(config.AUDIO_SERVICE_URL).toBe("http://127.0.0.1:8001");
    expect(config.HERMES_API_URL).toBe("http://127.0.0.1:8642");
    expect(config.HERMES_MODEL).toBe("hermes-agent");
    expect(config.HERMES_CONVERSATION).toBe("bmo-001");
    expect(config.HERMES_SOFT_TIMEOUT_MS).toBe(30_000);
    expect(config.HERMES_HARD_TIMEOUT_MS).toBe(180_000);
    expect(config.TOTAL_PIPELINE_TIMEOUT_MS).toBe(300_000);
    expect(config.AUDIO_SERVICE_STT_TIMEOUT_MS).toBe(90_000);
    expect(config.AUDIO_SERVICE_TTS_TIMEOUT_MS).toBe(180_000);
  });

  it("parses an explicit hardware test mode flag", () => {
    expect(parseEnv({ ...minimal, HARDWARE_TEST_MODE: "true" }).HARDWARE_TEST_MODE).toBe(true);
    expect(parseEnv({ ...minimal, HARDWARE_TEST_MODE: "false" }).HARDWARE_TEST_MODE).toBe(false);
  });

  it("requires the hardware fixture only when hardware test mode is enabled", () => {
    const { HARDWARE_TEST_MP3_PATH: _fixture, ...withoutFixture } = minimal;

    expect(parseEnv(withoutFixture).HARDWARE_TEST_MP3_PATH).toBeUndefined();
    expect(() =>
      parseEnv({ ...withoutFixture, HARDWARE_TEST_MODE: "true" }),
    ).toThrow(/HARDWARE_TEST_MP3_PATH/);
  });

  it("rejects hardware test mode in production", () => {
    expect(() =>
      parseEnv({ ...minimal, NODE_ENV: "production", HARDWARE_TEST_MODE: "true" }),
    ).toThrow(/HARDWARE_TEST_MODE/);
  });

  it("requires a loopback backend binding in production", () => {
    const production = {
      ...minimal,
      NODE_ENV: "production",
      DEVICE_TOKEN: "strong-device-secret-1234567890",
      INTERNAL_SERVICE_TOKEN: "strong-internal-secret-1234567890",
      HERMES_API_KEY: "strong-hermes-secret-1234567890",
    };

    expect(parseEnv(production).BACKEND_HOST).toBe("127.0.0.1");
    expect(() => parseEnv({ ...production, BACKEND_HOST: "0.0.0.0" })).toThrow(/BACKEND_HOST/);
  });

  it("rejects weak or missing device credentials", () => {
    expect(() => parseEnv({ ...minimal, DEVICE_TOKEN: "short" })).toThrow(/DEVICE_TOKEN/);
    expect(() => parseEnv({ ...minimal, DEVICE_ID: "" })).toThrow(/DEVICE_ID/);
  });
});
