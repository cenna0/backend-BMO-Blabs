import { access } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";

import { runFakeEsp32 } from "../scripts/fake-esp32.js";
import { makePcmWav } from "./helpers/wav.js";
import {
  startTestRuntime,
  stopTestRuntime,
  waitUntil,
  type TestRuntime,
} from "./helpers/test-runtime.js";

let runtime: TestRuntime | undefined;

afterEach(async () => {
  if (runtime) await stopTestRuntime(runtime);
  runtime = undefined;
});

describe("fake ESP32 basic E2E", () => {
  it("authenticates, uploads WAV, downloads MP3, and reports playback done", async () => {
    runtime = await startTestRuntime();
    const result = await runFakeEsp32({
      baseUrl: runtime.baseUrl,
      deviceId: "bmo-001",
      deviceToken: "test-device-secret",
      requestId: "550e8400-e29b-41d4-a716-446655440000",
      wav: makePcmWav({ durationSeconds: 0.2 }),
      timeoutMs: 3_000,
    });

    expect(result).toMatchObject({
      authenticated: true,
      uploadStatus: 202,
      thinkingSeen: true,
      audioReadySeen: true,
      audioContentType: "audio/mpeg",
      playbackDoneSent: true,
    });
    expect(result.audioBytes).toBeGreaterThan(0);

    await waitUntil(
      () => runtime!.backend.requestStore.get(result.requestId)?.status === "completed",
    );
    const record = runtime.backend.requestStore.get(result.requestId)!;
    await expect(access(record.audioPath!)).rejects.toThrow();
  });
});
