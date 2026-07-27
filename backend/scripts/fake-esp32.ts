import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

import { parseEnv } from "../src/config/env.js";
import { createBackendRuntime } from "../src/server.js";

interface JsonObject {
  [key: string]: unknown;
}

export interface FakeEsp32Options {
  baseUrl: string;
  deviceId: string;
  deviceToken: string;
  requestId: string;
  wav: Buffer;
  timeoutMs?: number;
  outputMp3Path?: string;
}

export interface FakeEsp32Result {
  requestId: string;
  authenticated: boolean;
  uploadStatus: number;
  thinkingSeen: boolean;
  audioReadySeen: boolean;
  audioContentType: string;
  audioBytes: number;
  audioPath: string | null;
  playbackDoneSent: boolean;
}

export class RequestCoordinator {
  #httpAccepted = false;
  #thinkingSeen = false;
  #audioUrl: string | null = null;
  #audioClaimed = false;

  constructor(readonly requestId: string) {}

  observeHttp(status: number, body: JsonObject): void {
    if (status !== 202 || body.request_id !== this.requestId || body.status !== "processing") {
      throw new Error(`unexpected upload response: ${status}`);
    }
    this.#httpAccepted = true;
  }

  observeEvent(event: JsonObject): void {
    if (event.request_id !== this.requestId) return;
    if (event.event === "display_status" && event.status === "thinking") {
      this.#thinkingSeen = true;
      return;
    }
    if (
      event.event === "audio_ready" &&
      event.format === "mp3" &&
      typeof event.audio_url === "string" &&
      typeof event.expires_in_seconds === "number"
    ) {
      this.#audioUrl = event.audio_url;
    }
  }

  isReadyForDownload(): boolean {
    return this.#httpAccepted && this.#thinkingSeen && this.#audioUrl !== null;
  }

  claimAudioUrl(): string | null {
    if (!this.isReadyForDownload() || this.#audioClaimed) return null;
    this.#audioClaimed = true;
    return this.#audioUrl;
  }

  get thinkingSeen(): boolean {
    return this.#thinkingSeen;
  }

  get audioReadySeen(): boolean {
    return this.#audioUrl !== null;
  }
}

async function waitFor(
  condition: () => boolean,
  getError: () => Error | null,
  timeoutMs: number,
  description: string,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    const error = getError();
    if (error) throw error;
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${description}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function sendJson(socket: WebSocket, message: JsonObject): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.send(JSON.stringify(message), (error) => (error ? reject(error) : resolve()));
  });
}

export async function runFakeEsp32(options: FakeEsp32Options): Promise<FakeEsp32Result> {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const baseUrl = options.baseUrl.replace(/\/$/, "");
  const socket = new WebSocket(baseUrl.replace(/^http/, "ws") + "/ws");
  const coordinator = new RequestCoordinator(options.requestId);
  let authenticated = false;
  let asyncError: Error | null = null;

  socket.on("message", (data) => {
    try {
      const event = JSON.parse(data.toString()) as JsonObject;
      if (event.event === "authenticated" && event.status === "ok") authenticated = true;
      coordinator.observeEvent(event);
    } catch (error) {
      asyncError = error instanceof Error ? error : new Error(String(error));
    }
  });
  socket.on("error", (error) => {
    asyncError = error;
  });

  try {
    await new Promise<void>((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });
    await sendJson(socket, {
      event: "authenticate",
      device_id: options.deviceId,
      device_token: options.deviceToken,
    });
    await waitFor(() => authenticated, () => asyncError, timeoutMs, "authenticated");

    const upload = await fetch(`${baseUrl}/api/v1/voice`, {
      method: "POST",
      headers: {
        "X-Device-Id": options.deviceId,
        "X-Device-Token": options.deviceToken,
        "X-Request-Id": options.requestId,
        "Content-Type": "audio/wav",
        "Content-Length": String(options.wav.length),
      },
      body: new Uint8Array(options.wav),
    });
    const uploadBody = (await upload.json()) as JsonObject;
    coordinator.observeHttp(upload.status, uploadBody);
    await waitFor(
      () => coordinator.isReadyForDownload(),
      () => asyncError,
      timeoutMs,
      "thinking and audio_ready",
    );

    const audioUrl = coordinator.claimAudioUrl();
    if (!audioUrl) throw new Error("audio URL was already claimed");
    const audio = await fetch(audioUrl);
    if (!audio.ok) throw new Error(`audio download failed: ${audio.status}`);
    const audioContentType = audio.headers.get("content-type") ?? "";
    if (audioContentType !== "audio/mpeg") {
      throw new Error(`unexpected audio content type: ${audioContentType}`);
    }
    const bytes = Buffer.from(await audio.arrayBuffer());
    const declaredLength = Number(audio.headers.get("content-length"));
    if (bytes.length === 0 || declaredLength !== bytes.length) {
      throw new Error("audio content length mismatch");
    }
    if (options.outputMp3Path) {
      await writeFile(options.outputMp3Path, bytes, { flag: "w" });
    }

    await sendJson(socket, { event: "audio_playback_done", request_id: options.requestId });
    return {
      requestId: options.requestId,
      authenticated,
      uploadStatus: upload.status,
      thinkingSeen: coordinator.thinkingSeen,
      audioReadySeen: coordinator.audioReadySeen,
      audioContentType,
      audioBytes: bytes.length,
      audioPath: options.outputMp3Path ?? null,
      playbackDoneSent: true,
    };
  } finally {
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
      socket.close();
    }
  }
}

function makeSilenceWav(durationSeconds = 0.2): Buffer {
  const sampleRate = 16_000;
  const bitsPerSample = 16;
  const channels = 1;
  const dataBytes = Math.floor(sampleRate * durationSeconds * 2);
  const wav = Buffer.alloc(44 + dataBytes);
  wav.write("RIFF", 0, "ascii");
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVE", 8, "ascii");
  wav.write("fmt ", 12, "ascii");
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(channels, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(bitsPerSample, 34);
  wav.write("data", 36, "ascii");
  wav.writeUInt32LE(dataBytes, 40);
  return wav;
}

async function runCli(): Promise<void> {
  const selfHost = process.env.FAKE_ESP32_SELF_HOST === "true" || (!process.env.BMO_BASE_URL && !process.env.DEVICE_TOKEN);
  let cleanup: (() => Promise<void>) | undefined;
  let baseUrl = process.env.BMO_BASE_URL ?? "http://127.0.0.1:3000";
  let deviceToken = process.env.DEVICE_TOKEN ?? "";
  if (selfHost) {
    const tempDir = await mkdtemp(join(tmpdir(), "bmo-fake-esp32-"));
    const fixture = fileURLToPath(new URL("../tests/fixtures/test-response.mp3", import.meta.url));
    const runtime = createBackendRuntime(
      parseEnv({
        NODE_ENV: "test",
        BACKEND_HOST: "127.0.0.1",
        BACKEND_PORT: "3000",
        PUBLIC_BASE_URL: "http://127.0.0.1:0",
        DEVICE_ID: "bmo-001",
        DEVICE_TOKEN: "test-device-secret",
        TEMP_AUDIO_DIR: tempDir,
        HARDWARE_TEST_MODE: "true",
        HARDWARE_TEST_MP3_PATH: fixture,
      }),
    );
    const address = await runtime.start(0);
    baseUrl = `http://127.0.0.1:${address.port}`;
    deviceToken = "test-device-secret";
    cleanup = async () => {
      await runtime.stop();
      await rm(tempDir, { recursive: true, force: true });
    };
  }
  const wav = process.env.FAKE_ESP32_WAV_PATH
    ? await readFile(process.env.FAKE_ESP32_WAV_PATH)
    : makeSilenceWav();
  const options: FakeEsp32Options = {
    baseUrl,
    deviceId: process.env.DEVICE_ID ?? "bmo-001",
    deviceToken,
    requestId: process.env.FAKE_ESP32_REQUEST_ID ?? randomUUID(),
    wav,
  };
  if (process.env.FAKE_ESP32_TIMEOUT_MS) {
    options.timeoutMs = Number(process.env.FAKE_ESP32_TIMEOUT_MS);
  }
  if (process.env.FAKE_ESP32_OUTPUT_MP3_PATH) {
    options.outputMp3Path = process.env.FAKE_ESP32_OUTPUT_MP3_PATH;
  }
  try {
    const result = await runFakeEsp32(options);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally {
    await cleanup?.();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  void runCli().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
