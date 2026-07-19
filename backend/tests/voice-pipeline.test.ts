import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { RequestStore } from "../src/domain/request-store.js";
import { TempAudioService } from "../src/services/temp-audio.service.js";
import { VoicePipelineService } from "../src/services/voice-pipeline.service.js";
import { makePcmWav } from "./helpers/wav.js";

const requestId = "550e8400-e29b-41d4-a716-446655440000";

class FakeSockets {
  readonly events: unknown[] = [];

  sendThinking(deviceId: string, id: string) {
    this.events.push({ event: "display_status", device_id: deviceId, request_id: id });
    return true;
  }

  sendAudioReady(record: { requestId: string }) {
    this.events.push({ event: "audio_ready", request_id: record.requestId });
    return true;
  }

  sendRequestFailed(deviceId: string, id: string, code: string) {
    this.events.push({ event: "request_failed", device_id: deviceId, request_id: id, code });
    return true;
  }
}

async function makeRuntime(overrides: {
  stt?: object;
  hermes?: object;
  tts?: object;
} = {}) {
  const tempDir = await mkdtemp(join(tmpdir(), "bmo-p4-"));
  const tempAudio = new TempAudioService(tempDir, 300);
  await tempAudio.initialize();
  const requestStore = new RequestStore();
  const inputPath = await tempAudio.writeInput(requestId, makePcmWav());
  const record = requestStore.create({
    requestId,
    deviceId: "bmo-001",
    inputPath,
    inputSha256: "sha",
    inputContentLength: 1,
  });
  const sockets = new FakeSockets();
  const service = new VoicePipelineService({
    publicBaseUrl: () => "http://127.0.0.1:3000",
    tempAudio,
    requestStore,
    sockets,
    logger: { error() {}, warn() {}, info() {} },
    audioService: {
      transcribe: async () => ({
        text: "halo bmo",
        speechDetected: true,
        language: "id",
        languageProbability: 0.9,
        durationSeconds: 1.0,
      }),
      synthesize: async () => ({
        audio: Buffer.from("mp3"),
        rvcApplied: false,
        ttsEngine: "kokoro",
      }),
      ...overrides.tts,
      ...overrides.stt,
    },
    hermes: {
      generate: async () => "Hi! BMO is ready to help.",
      ...overrides.hermes,
    },
    conversationQueue: { run: (_key: string, work: () => Promise<string>) => work() },
    conversationKey: "bmo-001",
    totalTimeoutMs: 3_000,
  });
  return { tempDir, tempAudio, requestStore, record, sockets, service, inputPath };
}

describe("VoicePipelineService", () => {
  it("runs STT → Hermes → TTS, stores MP3, emits audio_ready, and deletes WAV input", async () => {
    const runtime = await makeRuntime();
    try {
      const result = await runtime.service.process(runtime.record);

      expect(result.status).toBe("audio_ready");
      expect(result.transcript).toBe("halo bmo");
      expect(result.responseText).toBe("Hi! BMO is ready to help.");
      const ready = runtime.requestStore.get(requestId)!;
      expect(ready.status).toBe("audio_ready");
      expect(ready.audioUrl).toMatch(/^http:\/\/127\.0\.0\.1:3000\/audio\/.+\.mp3$/);
      expect(await readFile(ready.audioPath!)).toEqual(Buffer.from("mp3"));
      await expect(readFile(runtime.inputPath)).rejects.toThrow();
      expect(runtime.sockets.events.map((event) => (event as { event: string }).event)).toEqual([
        "display_status",
        "audio_ready",
      ]);
    } finally {
      await rm(runtime.tempDir, { recursive: true, force: true });
    }
  });

  it("maps no-speech without calling Hermes or TTS", async () => {
    const runtime = await makeRuntime({
      stt: {
        transcribe: async () => ({
          text: "",
          speechDetected: false,
          language: null,
          languageProbability: 0,
          durationSeconds: 1,
        }),
      },
      hermes: {
        generate: async () => {
          throw new Error("must not call Hermes");
        },
      },
    });
    try {
      const result = await runtime.service.process(runtime.record);
      expect(result.status).toBe("failed");
      expect(result.errorCode).toBe("NO_SPEECH");
      expect(runtime.requestStore.get(requestId)?.status).toBe("failed");
      expect(runtime.sockets.events).toContainEqual({
        event: "request_failed",
        device_id: "bmo-001",
        request_id: requestId,
        code: "NO_SPEECH",
      });
      await expect(readFile(runtime.inputPath)).rejects.toThrow();
    } finally {
      await rm(runtime.tempDir, { recursive: true, force: true });
    }
  });

  it.each([
    ["STT_FAILED", { stt: { transcribe: async () => { throw Object.assign(new Error("stt"), { code: "STT_FAILED" }); } } }],
    ["HERMES_FAILED", { hermes: { generate: async () => { throw Object.assign(new Error("hermes"), { code: "HERMES_FAILED" }); } } }],
    ["TTS_FAILED", { tts: { synthesize: async () => { throw Object.assign(new Error("tts"), { code: "TTS_FAILED" }); } } }],
    ["PIPELINE_TIMEOUT", { hermes: { generate: async () => { throw Object.assign(new Error("timeout"), { code: "PIPELINE_TIMEOUT" }); } } }],
  ])("maps %s into request_failed", async (code, overrides) => {
    const runtime = await makeRuntime(overrides);
    try {
      const result = await runtime.service.process(runtime.record);
      expect(result.status).toBe("failed");
      expect(result.errorCode).toBe(code);
      expect(runtime.requestStore.get(requestId)?.errorCode).toBe(code);
    } finally {
      await rm(runtime.tempDir, { recursive: true, force: true });
    }
  });
});
