import { access, readFile } from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
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

interface PipelineFixtures {
  audioBaseUrl: string;
  hermesBaseUrl: string;
  sttBytes: number[];
  ttsRequests: unknown[];
  hermesRequests: unknown[];
  mp3Length: number;
  close(): Promise<void>;
}

function voicePost(id = requestId, wav = makePcmWav()) {
  return request(runtime.baseUrl)
    .post("/api/v1/voice")
    .set("X-Device-Id", "bmo-001")
    .set("X-Device-Token", "test-device-secret")
    .set("X-Request-Id", id)
    .set("Content-Type", "audio/wav")
    .send(wav);
}

async function startPipelineFixtures(): Promise<PipelineFixtures> {
  const mp3 = await readFile(fileURLToPath(new URL("./fixtures/test-response.mp3", import.meta.url)));
  const sttBytes: number[] = [];
  const ttsRequests: unknown[] = [];
  const hermesRequests: unknown[] = [];

  const audioServer = http.createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const path = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
      if (request.headers["x-internal-service-token"] !== "fixture-internal-token") {
        response.writeHead(401).end("unauthorized");
        return;
      }
      if (request.method === "POST" && path === "/stt/transcribe") {
        const body = Buffer.concat(chunks);
        sttBytes.push(body.length);
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            text: "halo bmo",
            speech_detected: true,
            language: "id",
            language_probability: 0.91,
            duration_seconds: 1.0,
          }),
        );
        return;
      }
      if (request.method === "POST" && path === "/tts/synthesize") {
        ttsRequests.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        response.writeHead(200, {
          "content-type": "audio/mpeg",
          "x-rvc-applied": "false",
          "x-tts-engine": "kokoro",
        });
        response.end(mp3);
        return;
      }
      response.writeHead(404).end("not found");
    });
  });

  const hermesServer = http.createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const path = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
      if (request.headers.authorization !== "Bearer fixture-hermes-key") {
        response.writeHead(401).end("unauthorized");
        return;
      }
      if (request.method === "POST" && path === "/v1/responses") {
        hermesRequests.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            status: "completed",
            output: [
              { type: "function_call", name: "ignored_tool", arguments: "{}" },
              {
                type: "message",
                content: [{ type: "output_text", text: "Hi! **BMO** is ready to help." }],
              },
            ],
          }),
        );
        return;
      }
      response.writeHead(404).end("not found");
    });
  });

  const [audioAddress, hermesAddress] = await Promise.all([
    new Promise<AddressInfo>((resolve) => audioServer.listen(0, "127.0.0.1", () => resolve(audioServer.address() as AddressInfo))),
    new Promise<AddressInfo>((resolve) => hermesServer.listen(0, "127.0.0.1", () => resolve(hermesServer.address() as AddressInfo))),
  ]);

  return {
    audioBaseUrl: `http://127.0.0.1:${audioAddress.port}`,
    hermesBaseUrl: `http://127.0.0.1:${hermesAddress.port}`,
    sttBytes,
    ttsRequests,
    hermesRequests,
    mp3Length: mp3.length,
    async close() {
      await Promise.all([
        new Promise<void>((resolve, reject) => audioServer.close((error) => (error ? reject(error) : resolve()))),
        new Promise<void>((resolve, reject) => hermesServer.close((error) => (error ? reject(error) : resolve()))),
      ]);
    },
  };
}

beforeEach(async () => {
  runtime = await startTestRuntime();
});

afterEach(async () => {
  if (inbox && inbox.socket.readyState === inbox.socket.OPEN) inbox.socket.close();
  inbox = undefined;
  await stopTestRuntime(runtime);
});

describe("POST /api/v1/voice validation", () => {
  it("rejects missing canonical headers", async () => {
    inbox = await connectDevice(runtime);
    const response = await request(runtime.baseUrl)
      .post("/api/v1/voice")
      .set("Content-Type", "audio/wav")
      .send(makePcmWav())
      .expect(400);
    expect(response.body).toEqual({ error: "MISSING_REQUIRED_HEADER" });
  });

  it("rejects invalid credentials", async () => {
    inbox = await connectDevice(runtime);
    const response = await voicePost().set("X-Device-Token", "wrong-device-secret").expect(401);
    expect(response.body).toEqual({ error: "INVALID_DEVICE_CREDENTIALS" });
  });

  it("rejects a non-v4 request ID", async () => {
    inbox = await connectDevice(runtime);
    const response = await voicePost("550e8400-e29b-11d4-a716-446655440000").expect(400);
    expect(response.body).toEqual({ error: "INVALID_REQUEST_ID" });
  });

  it("rejects unsupported content type", async () => {
    inbox = await connectDevice(runtime);
    const response = await voicePost().set("Content-Type", "application/octet-stream").expect(415);
    expect(response.body).toEqual({ error: "UNSUPPORTED_AUDIO_TYPE", expected: "audio/wav" });
  });

  it("rejects audio over 3 MB", async () => {
    inbox = await connectDevice(runtime);
    const response = await voicePost(requestId, Buffer.alloc(3_145_729)).expect(413);
    expect(response.body).toEqual({ error: "AUDIO_TOO_LARGE", max_bytes: 3_145_728 });
  });

  it("rejects invalid WAV metadata", async () => {
    inbox = await connectDevice(runtime);
    const response = await voicePost(requestId, makePcmWav({ channels: 2 })).expect(422);
    expect(response.body).toEqual({
      error: "INVALID_AUDIO_FORMAT",
      expected: "WAV PCM 16-bit, 16 kHz, mono",
    });
  });

  it("rejects a device without active authenticated WebSocket", async () => {
    const response = await voicePost().expect(409);
    expect(response.body).toEqual({
      error: "WEBSOCKET_NOT_CONNECTED",
      message: "Device must reconnect before uploading audio.",
    });
  });

  it("checks WebSocket again after a slow body upload", async () => {
    inbox = await connectDevice(runtime);
    const wav = makePcmWav({ durationSeconds: 1 });
    const url = new URL("/api/v1/voice", runtime.baseUrl);
    const response = new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = http.request(
        url,
        {
          method: "POST",
          headers: {
            "X-Device-Id": "bmo-001",
            "X-Device-Token": "test-device-secret",
            "X-Request-Id": requestId,
            "Content-Type": "audio/wav",
            "Content-Length": String(wav.length),
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => chunks.push(chunk));
          res.on("end", () =>
            resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }),
          );
        },
      );
      req.on("error", reject);
      req.write(wav.subarray(0, 44));
      inbox!.socket.close();
      inbox!.socket.once("close", () => req.end(wav.subarray(44)));
    });

    await expect(response).resolves.toEqual({
      status: 409,
      body: JSON.stringify({
        error: "WEBSOCKET_NOT_CONNECTED",
        message: "Device must reconnect before uploading audio.",
      }),
    });
    expect(runtime.backend.requestStore.get(requestId)).toBeUndefined();
  });
});

describe("hardware test mode flow", () => {
  it("accepts canonical WAV, emits thinking/audio_ready, and serves dummy MP3", async () => {
    inbox = await connectDevice(runtime);
    const thinking = inbox.next("display_status");
    const audioReady = inbox.next("audio_ready");

    const accepted = await voicePost().expect(202);
    expect(accepted.body).toEqual({ request_id: requestId, status: "processing" });
    await expect(thinking).resolves.toEqual({
      event: "display_status",
      request_id: requestId,
      status: "thinking",
    });
    const event = await audioReady;
    expect(event).toMatchObject({
      event: "audio_ready",
      request_id: requestId,
      format: "mp3",
      expires_in_seconds: 300,
    });

    const download = await request(String(event.audio_url)).get("").expect(200);
    expect(download.headers["content-type"]).toMatch(/^audio\/mpeg/);
    expect(download.headers["content-length"]).toBe(String(download.body.length));
    expect(download.headers["cache-control"]).toBe("no-store, private, max-age=0");
    expect(download.body.length).toBeGreaterThan(0);
  });

  it("rejects a second request while dummy audio awaits playback", async () => {
    inbox = await connectDevice(runtime);
    const audioReady = inbox.next("audio_ready");
    await voicePost().expect(202);
    await audioReady;

    const response = await voicePost(secondRequestId).expect(409);
    expect(response.body).toEqual({
      error: "DEVICE_BUSY",
      message: "Previous voice request is still processing.",
    });
  });

  it("deletes MP3 and releases busy state on playback done", async () => {
    inbox = await connectDevice(runtime);
    const audioReady = inbox.next("audio_ready");
    await voicePost().expect(202);
    await audioReady;
    const record = runtime.backend.requestStore.get(requestId)!;
    expect(record.audioPath).toBeTruthy();

    inbox.socket.send(JSON.stringify({ event: "audio_playback_done", request_id: requestId }));
    await waitUntil(() => runtime.backend.requestStore.get(requestId)?.status === "completed");
    await expect(access(record.audioPath!)).rejects.toThrow();
    await voicePost(secondRequestId).expect(202);
  });

  it("deletes MP3, releases busy, and does not resend on playback failed", async () => {
    inbox = await connectDevice(runtime);
    const audioReady = inbox.next("audio_ready");
    await voicePost().expect(202);
    await audioReady;
    const record = runtime.backend.requestStore.get(requestId)!;

    inbox.socket.send(
      JSON.stringify({
        event: "audio_playback_failed",
        request_id: requestId,
        reason: "DOWNLOAD_FAILED",
      }),
    );
    await waitUntil(() => runtime.backend.requestStore.get(requestId)?.status === "failed");
    await expect(access(record.audioPath!)).rejects.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(inbox.queued("audio_ready")).toBe(0);
    await voicePost(secondRequestId).expect(202);
  });

  it("does not expose unknown or traversal audio paths", async () => {
    await request(runtime.baseUrl).get("/audio/not-a-uuid.mp3").expect(404);
    await request(runtime.baseUrl).get("/audio/%2e%2e%2fsecret.mp3").expect(404);
  });
});

describe("full voice pipeline mode", () => {
  it("runs local STT fixture â†’ Hermes fixture â†’ TTS fixture when hardware test mode is disabled", async () => {
    const fixtures = await startPipelineFixtures();
    await stopTestRuntime(runtime);
    runtime = await startTestRuntime(false, {
      AUDIO_SERVICE_URL: fixtures.audioBaseUrl,
      HERMES_API_URL: fixtures.hermesBaseUrl,
      INTERNAL_SERVICE_TOKEN: "fixture-internal-token",
      HERMES_API_KEY: "fixture-hermes-key",
    });

    try {
      inbox = await connectDevice(runtime);
      const thinking = inbox.next("display_status");
      const audioReady = inbox.next("audio_ready");

      const accepted = await voicePost().expect(202);
      expect(accepted.body).toEqual({ request_id: requestId, status: "processing" });
      await expect(thinking).resolves.toEqual({
        event: "display_status",
        request_id: requestId,
        status: "thinking",
      });
      const event = await audioReady;
      expect(event).toMatchObject({
        event: "audio_ready",
        request_id: requestId,
        format: "mp3",
      });
      const download = await request(String(event.audio_url)).get("").expect(200);
      expect(download.headers["content-type"]).toMatch(/^audio\/mpeg/);
      expect(download.body.length).toBe(fixtures.mp3Length);

      expect(fixtures.sttBytes[0]).toBeGreaterThan(44);
      expect(fixtures.hermesRequests[0]).toMatchObject({
        model: "hermes-agent",
        input: "halo bmo",
        conversation: "bmo-001",
        store: true,
        stream: false,
        truncation: "auto",
      });
      expect(fixtures.hermesRequests[0]).toHaveProperty("instructions");
      expect(fixtures.ttsRequests[0]).toEqual({
        request_id: requestId,
        text: "Hi! BMO is ready to help.",
        use_rvc: true,
      });
    } finally {
      await fixtures.close();
    }
  });
});
