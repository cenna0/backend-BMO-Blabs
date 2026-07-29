import { access, mkdir, mkdtemp, readdir, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
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
const thirdRequestId = "c8a13e7e-ef47-4c7f-91c2-9bba73fd921d";

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

async function setAge(path: string, now: number, ageMs: number) {
  const modified = new Date(now - ageMs);
  await utimes(path, modified, modified);
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

  it("periodic maintenance removes expired canonical orphan MP3 and input WAV files", async () => {
    runtime = await startTestRuntime(false, {
      TEMP_AUDIO_TTL_SECONDS: "1",
      TEMP_AUDIO_CLEANUP_INTERVAL_SECONDS: "30",
    });
    const orphanMp3 = join(runtime.tempDir, `${requestId}.mp3`);
    const orphanWav = join(runtime.tempDir, `input-${secondRequestId}.wav`);
    await writeFile(orphanMp3, "mp3");
    await writeFile(orphanWav, "wav");
    await setAge(orphanMp3, Date.now(), 2_000);
    await setAge(orphanWav, Date.now(), 700_000);

    await runtime.backend.runMaintenance();

    await expect(access(orphanMp3)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(orphanWav)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("periodic orphan cleanup preserves canonical files until each configured age expires", async () => {
    const now = Date.now();
    const tempDir = await mkdtemp(join(tmpdir(), "bmo-p7-recent-audio-"));
    const recentMp3 = join(tempDir, `${requestId}.mp3`);
    const recentWav = join(tempDir, `input-${secondRequestId}.wav`);
    await writeFile(recentMp3, "mp3");
    await writeFile(recentWav, "wav");
    await setAge(recentMp3, now, 299_000);
    await setAge(recentWav, now, 599_000);
    const service = new TempAudioService(tempDir, 300, { now: () => now });

    await service.cleanupExpiredOrphans();

    await expect(access(recentMp3)).resolves.toBeUndefined();
    await expect(access(recentWav)).resolves.toBeUndefined();
  });

  it("periodic orphan cleanup never deletes unrelated or non-canonical files", async () => {
    const now = Date.now();
    const tempDir = await mkdtemp(join(tmpdir(), "bmo-p7-unrelated-audio-"));
    const nestedDir = join(tempDir, "nested");
    await mkdir(nestedDir);
    const unrelated = [
      join(tempDir, "keep.txt"),
      join(tempDir, "not-a-uuid.mp3"),
      join(tempDir, `${requestId}.wav`),
      join(tempDir, "input-not-a-uuid.wav"),
      join(nestedDir, `${requestId}.mp3`),
    ];
    for (const path of unrelated) {
      await writeFile(path, "keep");
      await setAge(path, now, 700_000);
    }
    const service = new TempAudioService(tempDir, 300, { now: () => now });

    await service.cleanupExpiredOrphans();

    await expect(Promise.all(unrelated.map((path) => access(path)))).resolves.toBeDefined();
  });

  it("periodic orphan cleanup is bounded and idempotent across repeated passes", async () => {
    const now = Date.now();
    const tempDir = await mkdtemp(join(tmpdir(), "bmo-p7-bounded-audio-"));
    const expired = [requestId, secondRequestId, thirdRequestId].map((id) =>
      join(tempDir, `${id}.mp3`),
    );
    for (const path of expired) {
      await writeFile(path, "mp3");
      await setAge(path, now, 301_000);
    }
    const service = new TempAudioService(tempDir, 300, {
      now: () => now,
      cleanupBatchLimit: 2,
    });

    await expect(service.cleanupExpiredOrphans()).resolves.toMatchObject({ deleted: 2 });
    expect((await readdir(tempDir)).length).toBe(1);
    await expect(service.cleanupExpiredOrphans()).resolves.toMatchObject({ deleted: 1 });
    await expect(service.cleanupExpiredOrphans()).resolves.toMatchObject({ deleted: 0 });
    expect(await readdir(tempDir)).toEqual([]);
  });

  it("contains periodic cleanup errors without terminating the backend", async () => {
    runtime = await startTestRuntime(false, {
      TEMP_AUDIO_CLEANUP_INTERVAL_SECONDS: "30",
    });
    const cleanup = vi
      .spyOn(runtime.backend.tempAudio, "cleanupExpiredOrphans")
      .mockRejectedValueOnce(new Error("simulated cleanup failure"));

    await expect(runtime.backend.runMaintenance()).resolves.toBeUndefined();
    expect(cleanup).toHaveBeenCalledOnce();
    await request(runtime.baseUrl).get("/livez").expect(200, {
      status: "ok",
      backend: "ok",
    });
  });
});
