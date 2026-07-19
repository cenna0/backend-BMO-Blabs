import { access, mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";

import { TempAudioService } from "../src/services/temp-audio.service.js";
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

let runtime: TestRuntime | undefined;
let inbox: WsInbox | undefined;

function voicePost(id = requestId) {
  return request(runtime!.baseUrl)
    .post("/api/v1/voice")
    .set("X-Device-Id", "bmo-001")
    .set("X-Device-Token", "test-device-secret")
    .set("X-Request-Id", id)
    .set("Content-Type", "audio/wav")
    .send(makePcmWav());
}

afterEach(async () => {
  if (inbox && inbox.socket.readyState === inbox.socket.OPEN) inbox.socket.close();
  if (runtime) await stopTestRuntime(runtime);
  runtime = undefined;
  inbox = undefined;
});

describe("P5 temp audio TTL and cleanup", () => {
  it("expires MP3 after TTL, sends AUDIO_EXPIRED, releases busy, and returns 410 for the old audio ID", async () => {
    runtime = await startTestRuntime(true, {
      TEMP_AUDIO_TTL_SECONDS: "1",
      TEMP_AUDIO_CLEANUP_INTERVAL_SECONDS: "1",
    });
    inbox = await connectDevice(runtime);
    const audioReady = inbox.next("audio_ready");
    await voicePost().expect(202);
    const ready = await audioReady;
    const audioUrl = String(ready.audio_url);
    const expired = inbox.next("request_failed", 2_500);

    await new Promise((resolve) => setTimeout(resolve, 1_200));

    await expect(expired).resolves.toEqual({
      event: "request_failed",
      request_id: requestId,
      code: "AUDIO_EXPIRED",
      recoverable: true,
    });
    expect(runtime.backend.requestStore.get(requestId)?.status).toBe("expired");
    await request(audioUrl).get("").expect(410, { error: "AUDIO_EXPIRED" });
    await voicePost(secondRequestId).expect(202);
  });

  it("GET of an expired MP3 synchronously marks request expired and releases busy", async () => {
    runtime = await startTestRuntime(true, {
      TEMP_AUDIO_TTL_SECONDS: "1",
      TEMP_AUDIO_CLEANUP_INTERVAL_SECONDS: "30",
    });
    inbox = await connectDevice(runtime);
    const audioReady = inbox.next("audio_ready");
    await voicePost().expect(202);
    const ready = await audioReady;

    await new Promise((resolve) => setTimeout(resolve, 1_100));
    const expired = inbox.next("request_failed", 1_000);
    await request(String(ready.audio_url)).get("").expect(410, { error: "AUDIO_EXPIRED" });

    expect(runtime.backend.requestStore.get(requestId)?.status).toBe("expired");
    await expect(expired).resolves.toMatchObject({ code: "AUDIO_EXPIRED", request_id: requestId });
    await voicePost(secondRequestId).expect(202);
  });

  it("keeps expired audio IDs distinct from unknown audio IDs", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "bmo-p5-audio-"));
    const service = new TempAudioService(tempDir, 300, { now: () => 1_000 });
    await service.initialize();
    const audio = await service.createFromBytes(Buffer.from("mp3"));

    await service.expireAudio(audio.audioId);

    expect(service.getForDownload(audio.audioId).status).toBe("expired");
    expect(service.getForDownload("6b6a1bc8-55b0-4e88-b62e-289ae089fd54").status).toBe("unknown");

    service.collectExpiredAudioTombstones(600_000, 0);
    expect(service.getForDownload(audio.audioId).status).toBe("unknown");
  });

  it("startup cleanup removes only old orphan files inside temp directory", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "bmo-p5-startup-"));
    const oldMp3 = join(tempDir, "550e8400-e29b-41d4-a716-446655440000.mp3");
    const oldWav = join(tempDir, "input-550e8400-e29b-41d4-a716-446655440000.wav");
    const note = join(tempDir, "keep.txt");
    await writeFile(oldMp3, "mp3");
    await writeFile(oldWav, "wav");
    await writeFile(note, "keep");

    const service = new TempAudioService(tempDir, 300, { now: () => Date.now() + 700_000 });
    await service.startupCleanup();

    const files = await readdir(tempDir);
    expect(files).toEqual(["keep.txt"]);
    await expect(access(note)).resolves.toBeUndefined();
  });
});
