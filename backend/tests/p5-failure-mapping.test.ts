import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { RequestStore } from "../src/domain/request-store.js";
import { TempAudioService } from "../src/services/temp-audio.service.js";
import { VoicePipelineService } from "../src/services/voice-pipeline.service.js";
import { makePcmWav } from "./helpers/wav.js";

const requestId = "550e8400-e29b-41d4-a716-446655440000";

async function makeRuntime(overrides: {
  stt?: object;
  hermes?: object;
  tts?: object;
  totalTimeoutMs?: number;
} = {}) {
  const tempDir = await mkdtemp(join(tmpdir(), "bmo-p5-failure-"));
  const tempAudio = new TempAudioService(tempDir, 300);
  await tempAudio.initialize();
  const requestStore = new RequestStore();
  const inputPath = await tempAudio.writeInput(requestId, makePcmWav());
  const record = requestStore.create({
    requestId,
    deviceId: "bmo-001",
    inputPath,
    inputSha256: "a".repeat(64),
    inputContentLength: makePcmWav().length,
  });
  const events: unknown[] = [];
  const service = new VoicePipelineService({
    publicBaseUrl: () => "http://127.0.0.1:3000",
    tempAudio,
    requestStore,
    sockets: {
      sendThinking: () => true,
      sendAudioReady: () => true,
      sendRequestFailed: (_deviceId, id, code) => {
        events.push({ event: "request_failed", request_id: id, code });
        return true;
      },
    },
    logger: { error() {}, warn() {}, info() {} },
    audioService: {
      transcribe: async () => ({
        text: "hello bmo",
        speechDetected: true,
        language: "en",
        languageProbability: 0.99,
        durationSeconds: 1,
      }),
      synthesize: async () => ({ audio: Buffer.from("mp3"), rvcApplied: false, ttsEngine: "kokoro" }),
      ...overrides.stt,
      ...overrides.tts,
    },
    hermes: {
      generate: async () => "Hi! BMO can help.",
      ...overrides.hermes,
    },
    conversationQueue: { run: (_key, work) => work() },
    conversationKey: "bmo-001",
    totalTimeoutMs: overrides.totalTimeoutMs ?? 3_000,
  });
  return { tempDir, inputPath, requestStore, record, service, events };
}

describe("P5 failure mapping matrix", () => {
  it.each([
    ["NO_SPEECH", { stt: { transcribe: async () => ({ text: "", speechDetected: false, language: null, languageProbability: 0, durationSeconds: 1 }) } }],
    ["INVALID_AUDIO", { stt: { transcribe: async () => { throw Object.assign(new Error("invalid"), { code: "INVALID_AUDIO" }); } } }],
    ["STT_FAILED", { stt: { transcribe: async () => { throw Object.assign(new Error("stt"), { code: "STT_FAILED" }); } } }],
    ["HERMES_FAILED", { hermes: { generate: async () => { throw Object.assign(new Error("hermes"), { code: "HERMES_FAILED" }); } } }],
    ["TTS_FAILED", { tts: { synthesize: async () => { throw Object.assign(new Error("tts"), { code: "TTS_FAILED" }); } } }],
    ["PIPELINE_TIMEOUT", { hermes: { generate: async () => { throw Object.assign(new Error("timeout"), { code: "PIPELINE_TIMEOUT" }); } } }],
    ["INTERNAL_ERROR", { hermes: { generate: async () => { throw new Error("unexpected"); } } }],
  ])("maps %s to request_failed", async (code, overrides) => {
    const runtime = await makeRuntime(overrides);
    try {
      const result = await runtime.service.process(runtime.record);

      expect(result).toMatchObject({ status: "failed", errorCode: code });
      expect(runtime.requestStore.get(requestId)?.errorCode).toBe(code);
      expect(runtime.events).toContainEqual({ event: "request_failed", request_id: requestId, code });
      await expect(readFile(runtime.inputPath)).rejects.toThrow();
    } finally {
      await rm(runtime.tempDir, { recursive: true, force: true });
    }
  });

  it("aborts total pipeline timeout and records PIPELINE_TIMEOUT", async () => {
    vi.useFakeTimers();
    const runtime = await makeRuntime({
      totalTimeoutMs: 50,
      hermes: {
        generate: async (_input: string, signal?: AbortSignal) =>
          new Promise<string>((_resolve, reject) => {
            signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { code: "PIPELINE_TIMEOUT" })));
          }),
      },
    });
    try {
      const processing = runtime.service.process(runtime.record);
      await vi.advanceTimersByTimeAsync(51);

      await expect(processing).resolves.toMatchObject({ status: "failed", errorCode: "PIPELINE_TIMEOUT" });
    } finally {
      vi.useRealTimers();
      await rm(runtime.tempDir, { recursive: true, force: true });
    }
  });
});
