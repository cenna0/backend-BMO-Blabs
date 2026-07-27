import { access } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";

import { makePcmWav } from "./helpers/wav.js";
import {
  connectDevice,
  startTestRuntime,
  stopTestRuntime,
  waitUntil,
  type TestRuntime,
  type WsInbox,
} from "./helpers/test-runtime.js";

const requestId = "550e8400-e29b-41d4-a716-446655440000";

let runtime: TestRuntime;
let inbox: WsInbox | undefined;

function voicePost() {
  return request(runtime.baseUrl)
    .post("/api/v1/voice")
    .set("X-Device-Id", "bmo-001")
    .set("X-Device-Token", "test-device-secret")
    .set("X-Request-Id", requestId)
    .set("Content-Type", "audio/wav")
    .send(makePcmWav());
}

beforeEach(async () => {
  runtime = await startTestRuntime();
  inbox = await connectDevice(runtime);
});

afterEach(async () => {
  if (inbox && inbox.socket.readyState === inbox.socket.OPEN) inbox.socket.close();
  await stopTestRuntime(runtime);
});

describe("P5 playback lifecycle idempotency", () => {
  it("accepts duplicate playback_done without deleting unrelated state", async () => {
    const audioReady = inbox!.next("audio_ready");
    await voicePost().expect(202);
    await audioReady;
    const record = runtime.backend.requestStore.get(requestId)!;

    inbox!.socket.send(JSON.stringify({ event: "audio_playback_done", request_id: requestId }));
    await waitUntil(() => runtime.backend.requestStore.get(requestId)?.status === "completed");
    inbox!.socket.send(JSON.stringify({ event: "audio_playback_done", request_id: requestId }));
    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(runtime.backend.requestStore.get(requestId)?.status).toBe("completed");
    await expect(access(record.audioPath!)).rejects.toThrow();
  });

  it("accepts duplicate playback_failed and does not resend audio_ready", async () => {
    const audioReady = inbox!.next("audio_ready");
    await voicePost().expect(202);
    await audioReady;
    const record = runtime.backend.requestStore.get(requestId)!;

    for (let index = 0; index < 2; index += 1) {
      inbox!.socket.send(
        JSON.stringify({
          event: "audio_playback_failed",
          request_id: requestId,
          reason: "DOWNLOAD_FAILED",
        }),
      );
    }
    await waitUntil(() => runtime.backend.requestStore.get(requestId)?.status === "failed");
    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(runtime.backend.requestStore.get(requestId)?.status).toBe("failed");
    await expect(access(record.audioPath!)).rejects.toThrow();
    expect(inbox!.queued("audio_ready")).toBe(0);
  });

  it("ignores playback events from a device that does not own the request", async () => {
    runtime.backend.requestStore.create({
      requestId,
      deviceId: "bmo-other",
      inputPath: "C:/tmp/other.wav",
      inputSha256: "a".repeat(64),
      inputContentLength: makePcmWav().length,
    });
    runtime.backend.requestStore.markAudioReady(requestId, {
      audioId: "6b6a1bc8-55b0-4e88-b62e-289ae089fd54",
      audioPath: "C:/tmp/output.mp3",
      audioUrl: "http://127.0.0.1/audio/output.mp3",
      expiresAt: Date.now() + 300_000,
    });

    inbox!.socket.send(JSON.stringify({ event: "audio_playback_done", request_id: requestId }));
    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(runtime.backend.requestStore.get(requestId)?.status).toBe("audio_ready");
  });
});
