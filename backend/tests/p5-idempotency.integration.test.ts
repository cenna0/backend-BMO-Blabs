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
const secondRequestId = "6b6a1bc8-55b0-4e88-b62e-289ae089fd54";

let runtime: TestRuntime;
let inbox: WsInbox | undefined;

function voicePost(id = requestId, wav = makePcmWav()) {
  return request(runtime.baseUrl)
    .post("/api/v1/voice")
    .set("X-Device-Id", "bmo-001")
    .set("X-Device-Token", "test-device-secret")
    .set("X-Request-Id", id)
    .set("Content-Type", "audio/wav")
    .send(wav);
}

beforeEach(async () => {
  runtime = await startTestRuntime();
  inbox = await connectDevice(runtime);
});

afterEach(async () => {
  if (inbox && inbox.socket.readyState === inbox.socket.OPEN) inbox.socket.close();
  await stopTestRuntime(runtime);
});

describe("P5 voice upload idempotency", () => {
  it("returns 200 duplicate with current audio_ready status and resends the same audio URL", async () => {
    const firstAudioReady = inbox!.next("audio_ready");
    await voicePost().expect(202);
    const firstEvent = await firstAudioReady;

    const duplicateAudioReady = inbox!.next("audio_ready");
    const duplicate = await voicePost().expect(200);
    const duplicateEvent = await duplicateAudioReady;

    expect(duplicate.body).toEqual({
      request_id: requestId,
      status: "audio_ready",
      duplicate: true,
      error_code: null,
    });
    expect(duplicateEvent).toMatchObject({
      event: "audio_ready",
      request_id: requestId,
      audio_url: firstEvent.audio_url,
    });
  });

  it("checks duplicate before DEVICE_BUSY for the same active request", async () => {
    await voicePost().expect(202);

    const duplicate = await voicePost().expect(200);

    expect(duplicate.body).toMatchObject({
      request_id: requestId,
      duplicate: true,
    });
    expect(duplicate.body.error).not.toBe("DEVICE_BUSY");
  });

  it("returns REQUEST_ID_CONFLICT when the same device reuses request ID with different WAV bytes", async () => {
    await voicePost(requestId, makePcmWav({ durationSeconds: 1 })).expect(202);

    const conflict = await voicePost(requestId, makePcmWav({ durationSeconds: 2 })).expect(409);

    expect(conflict.body).toEqual({ error: "REQUEST_ID_CONFLICT" });
  });

  it("returns REQUEST_ID_CONFLICT when request ID already belongs to another device", async () => {
    runtime.backend.requestStore.create({
      requestId: secondRequestId,
      deviceId: "bmo-other",
      inputPath: "C:/tmp/other.wav",
      inputSha256: "a".repeat(64),
      inputContentLength: makePcmWav().length,
    });

    const conflict = await voicePost(secondRequestId).expect(409);

    expect(conflict.body).toEqual({ error: "REQUEST_ID_CONFLICT" });
  });

  it("returns terminal public status for completed duplicate requests", async () => {
    const audioReady = inbox!.next("audio_ready");
    await voicePost().expect(202);
    await audioReady;
    inbox!.socket.send(JSON.stringify({ event: "audio_playback_done", request_id: requestId }));
    await waitUntil(() => runtime.backend.requestStore.get(requestId)?.status === "completed");

    const duplicate = await voicePost().expect(200);

    expect(duplicate.body).toEqual({
      request_id: requestId,
      status: "completed",
      duplicate: true,
      error_code: null,
    });
  });
});
