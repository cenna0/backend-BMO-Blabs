import { describe, expect, it } from "vitest";
import request from "supertest";

import { parseEnv } from "../src/config/env.js";
import { RequestStore } from "../src/domain/request-store.js";
import { TempAudioService } from "../src/services/temp-audio.service.js";
import { VoicePipelineService } from "../src/services/voice-pipeline.service.js";
import { makePcmWav } from "./helpers/wav.js";
import { connectDevice, startTestRuntime, stopTestRuntime } from "./helpers/test-runtime.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const minimal = {
  DEVICE_ID: "bmo-001",
  DEVICE_TOKEN: "test-device-secret",
  PUBLIC_BASE_URL: "http://127.0.0.1:3000",
  TEMP_AUDIO_DIR: "C:/tmp/bmo-tests",
  HARDWARE_TEST_MP3_PATH: "C:/fixtures/test-response.mp3",
};

describe("P5 security hardening", () => {
  it("rejects unsafe production placeholder secrets", () => {
    for (const overrides of [
      { INTERNAL_SERVICE_TOKEN: "local-internal-token", HERMES_API_KEY: "strong-hermes-key-1234567890" },
      { INTERNAL_SERVICE_TOKEN: "test-internal-token", HERMES_API_KEY: "strong-hermes-key-1234567890" },
      { INTERNAL_SERVICE_TOKEN: "strong-internal-token-1234567890", HERMES_API_KEY: "local-hermes-key" },
      { INTERNAL_SERVICE_TOKEN: "strong-internal-token-1234567890", HERMES_API_KEY: "key" },
      { DEVICE_TOKEN: "test-device-secret", INTERNAL_SERVICE_TOKEN: "strong-internal-token-1234567890", HERMES_API_KEY: "strong-hermes-key-1234567890" },
    ]) {
      expect(() =>
        parseEnv({
          ...minimal,
          NODE_ENV: "production",
          ...overrides,
        }),
      ).toThrow(/unsafe production secret/);
    }
  });

  it("verifies actual bytes against Content-Length", async () => {
    const runtime = await startTestRuntime();
    const inbox = await connectDevice(runtime);
    try {
      const wav = makePcmWav();
      const response = await request(runtime.baseUrl)
        .post("/api/v1/voice")
        .set("X-Device-Id", "bmo-001")
        .set("X-Device-Token", "test-device-secret")
        .set("X-Request-Id", "550e8400-e29b-41d4-a716-446655440000")
        .set("Content-Type", "audio/wav")
        .set("Content-Length", String(wav.length - 1))
        .send(wav)
        .expect(400);

      expect(response.body).not.toEqual({ request_id: "550e8400-e29b-41d4-a716-446655440000" });
      expect(runtime.backend.requestStore.get("550e8400-e29b-41d4-a716-446655440000")).toBeUndefined();
    } finally {
      if (inbox.socket.readyState === inbox.socket.OPEN) inbox.socket.close();
      await stopTestRuntime(runtime);
    }
  });

  it("does not write full transcript or raw audio to default pipeline logs", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "bmo-p5-log-"));
    const logs: unknown[] = [];
    const tempAudio = new TempAudioService(tempDir, 300);
    await tempAudio.initialize();
    const requestStore = new RequestStore();
    const inputPath = await tempAudio.writeInput("550e8400-e29b-41d4-a716-446655440000", makePcmWav());
    const record = requestStore.create({
      requestId: "550e8400-e29b-41d4-a716-446655440000",
      deviceId: "bmo-001",
      inputPath,
      inputSha256: "a".repeat(64),
      inputContentLength: makePcmWav().length,
    });
    const service = new VoicePipelineService({
      publicBaseUrl: () => "http://127.0.0.1:3000",
      tempAudio,
      requestStore,
      sockets: {
        sendThinking: () => true,
        sendAudioReady: () => true,
        sendRequestFailed: () => true,
      },
      logger: {
        info: (bindings: unknown, message?: string): void => void logs.push({ bindings, message }),
        warn: (bindings: unknown, message?: string): void => void logs.push({ bindings, message }),
        error: (bindings: unknown, message?: string): void => void logs.push({ bindings, message }),
      },
      audioService: {
        transcribe: async () => ({
          text: "this is the full private transcript",
          speechDetected: true,
          language: "en",
          languageProbability: 0.99,
          durationSeconds: 1,
        }),
        synthesize: async () => ({ audio: Buffer.from("mp3"), rvcApplied: false, ttsEngine: "kokoro" }),
      },
      hermes: { generate: async () => "Hi! BMO can help." },
      conversationQueue: { run: (_key, work) => work() },
      conversationKey: "bmo-001",
      totalTimeoutMs: 3_000,
    });

    try {
      await service.process(record);
      const serialized = JSON.stringify(logs);
      expect(serialized).not.toContain("this is the full private transcript");
      expect(serialized).not.toContain(makePcmWav().toString("base64"));
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
