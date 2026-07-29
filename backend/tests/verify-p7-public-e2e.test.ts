import { describe, expect, it } from "vitest";

import {
  renderHuman,
  renderJson,
  runCli,
  runP7PublicAcceptance,
  type AcceptanceDependencies,
  type AcceptanceSocket,
  type P7PublicAcceptanceOptions,
  type SocketClose,
} from "../scripts/verify-p7-public-e2e.js";
import { makePcmWav } from "./helpers/wav.js";

const deviceId = "bmo-001";
const deviceToken = "task9-test-device-token-never-print";
const apiBaseUrl = "https://api.example.test";
const webSocketUrl = "wss://api.example.test/ws";
const audioId = "223e4567-e89b-42d3-a456-426614174000";
const audioUrl = `${apiBaseUrl}/audio/${audioId}.mp3`;
const requestIds = [
  "550e8400-e29b-41d4-a716-446655440000",
  "6b6a1bc8-55b0-4e88-b62e-289ae089fd54",
  "7c7a1bc8-55b0-4e88-b62e-289ae089fd54",
  "8d8a1bc8-55b0-4e88-b62e-289ae089fd54",
  "9e9a1bc8-55b0-4e88-b62e-289ae089fd54",
  "aa0a1bc8-55b0-4e88-b62e-289ae089fd54",
];

interface FakeOptions {
  audioCacheControl?: string;
  audioContentType?: string;
  healthStatus?: number;
  livezStatus?: number;
  readyzStatus?: number;
}

type BackendState = "idle" | "thinking" | "audio_ready" | "completed";

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

class FakeSocket implements AcceptanceSocket {
  readonly #events: Record<string, unknown>[] = [];
  readonly #eventWaiters: Array<{
    eventName: string;
    resolve(event: Record<string, unknown>): void;
  }> = [];
  readonly #closeWaiters: Array<(close: SocketClose) => void> = [];
  #close: SocketClose | undefined;

  constructor(private readonly backend: FakePublicBackend) {}

  queue(event: Record<string, unknown>): void {
    const index = this.#eventWaiters.findIndex(
      (waiter) => waiter.eventName === event.event,
    );
    if (index >= 0) {
      this.#eventWaiters.splice(index, 1)[0]!.resolve(event);
      return;
    }
    this.#events.push(event);
  }

  reject(code: number, reason: string): void {
    this.#close = { code, reason };
    for (const resolve of this.#closeWaiters.splice(0)) {
      resolve(this.#close);
    }
  }

  async sendJson(message: Record<string, unknown>): Promise<void> {
    if (this.#close) throw new Error("fake socket is closed");
    this.backend.receive(this, message);
  }

  async nextEvent(eventName: string): Promise<Record<string, unknown>> {
    const index = this.#events.findIndex((event) => event.event === eventName);
    if (index >= 0) return this.#events.splice(index, 1)[0]!;
    return new Promise((resolve) => {
      this.#eventWaiters.push({ eventName, resolve });
    });
  }

  async waitForClose(): Promise<SocketClose> {
    if (this.#close) return this.#close;
    return new Promise((resolve) => this.#closeWaiters.push(resolve));
  }

  async ensureOpen(): Promise<void> {
    if (this.#close) throw new Error("fake socket closed unexpectedly");
  }

  async close(): Promise<void> {
    if (!this.#close) this.#close = { code: 1000, reason: "CLIENT_CLOSE" };
    this.backend.disconnect(this);
  }
}

class FakePublicBackend {
  readonly wav = makePcmWav({ durationSeconds: 0.2 });
  readonly sensitiveResponseText =
    "private transcript and response text that evidence must never contain";
  readonly authenticatedStates: string[] = [];
  readonly requestedUrls: string[] = [];
  audioDownloads = 0;
  completionMessages = 0;
  conflictUploads = 0;
  duplicateUploads = 0;
  invalidHttpAuthAttempts = 0;
  invalidWebSocketAuthAttempts = 0;
  mainRequestId: string | undefined;

  readonly #options: Required<FakeOptions>;
  #activeSocket: FakeSocket | undefined;
  #mainWav: Buffer | undefined;
  #state: BackendState = "idle";

  constructor(options: FakeOptions = {}) {
    this.#options = {
      audioCacheControl:
        options.audioCacheControl ?? "no-store, private, max-age=0",
      audioContentType: options.audioContentType ?? "audio/mpeg",
      healthStatus: options.healthStatus ?? 200,
      livezStatus: options.livezStatus ?? 404,
      readyzStatus: options.readyzStatus ?? 404,
    };
  }

  readonly connectWebSocket = async (
    url: string,
  ): Promise<AcceptanceSocket> => {
    this.requestedUrls.push(url);
    return new FakeSocket(this);
  };

  readonly fetch = async (
    input: string | URL,
    init: RequestInit = {},
  ): Promise<Response> => {
    const url = new URL(String(input));
    this.requestedUrls.push(url.toString());

    if (init.method === undefined || init.method === "GET") {
      if (url.pathname === "/health") {
        const body: Record<string, unknown> = {
          status: this.#options.healthStatus === 200 ? "degraded" : "error",
          backend: "ok",
          hermes: "ok",
          audio_service: "ok",
          rvc: "unavailable",
        };
        if (this.#options.healthStatus !== 200) {
          body.detail = this.sensitiveResponseText;
        }
        return jsonResponse(this.#options.healthStatus, body);
      }
      if (url.pathname === "/livez") {
        return new Response("", { status: this.#options.livezStatus });
      }
      if (url.pathname === "/readyz") {
        return new Response("", { status: this.#options.readyzStatus });
      }
      if (url.pathname === `/audio/${audioId}.mp3`) {
        if (this.#state === "completed") {
          return new Response("", { status: 404 });
        }
        this.audioDownloads += 1;
        const audio = Buffer.from("test-mp3-bytes");
        return new Response(audio, {
          status: 200,
          headers: {
            "Cache-Control": this.#options.audioCacheControl,
            "Content-Length": String(audio.length),
            "Content-Type": this.#options.audioContentType,
          },
        });
      }
      return new Response("", { status: 404 });
    }

    if (init.method !== "POST" || url.pathname !== "/api/v1/voice") {
      return new Response("", { status: 404 });
    }

    const headers = new Headers(init.headers);
    const token = headers.get("X-Device-Token");
    const requestId = headers.get("X-Request-Id");
    const wav = Buffer.from(init.body as Uint8Array);

    if (token !== deviceToken) {
      this.invalidHttpAuthAttempts += 1;
      return jsonResponse(401, { error: "INVALID_DEVICE_CREDENTIALS" });
    }
    if (!requestId || !/^[0-9a-f-]{36}$/i.test(requestId)) {
      return jsonResponse(400, { error: "INVALID_REQUEST_ID" });
    }
    if (wav.subarray(0, 4).toString("ascii") !== "RIFF") {
      return jsonResponse(422, { error: "INVALID_AUDIO_FORMAT" });
    }
    if (wav.length < 44 || wav.readUInt32LE(24) !== 16_000) {
      return jsonResponse(422, { error: "INVALID_AUDIO_FORMAT" });
    }
    if (this.mainRequestId === undefined) {
      this.mainRequestId = requestId;
      this.#mainWav = wav;
      this.#state = "thinking";
      this.#activeSocket?.queue({
        event: "display_status",
        request_id: requestId,
        status: "thinking",
      });
      return jsonResponse(202, {
        request_id: requestId,
        status: "processing",
      });
    }
    if (requestId === this.mainRequestId) {
      if (!this.#mainWav?.equals(wav)) {
        this.conflictUploads += 1;
        return jsonResponse(409, { error: "REQUEST_ID_CONFLICT" });
      }
      this.duplicateUploads += 1;
      if (this.#state === "audio_ready") this.#queueAudioReady();
      return jsonResponse(200, {
        request_id: requestId,
        status:
          this.#state === "thinking"
            ? "processing"
            : this.#state === "completed"
              ? "completed"
              : "audio_ready",
        duplicate: true,
        error_code: null,
      });
    }
    if (this.#state === "thinking" || this.#state === "audio_ready") {
      return jsonResponse(409, {
        error: "DEVICE_BUSY",
        message: "Previous voice request is still processing.",
      });
    }
    throw new Error("unexpected fake upload");
  };

  receive(socket: FakeSocket, message: Record<string, unknown>): void {
    if (message.event === "authenticate") {
      if (
        message.device_id !== deviceId ||
        message.device_token !== deviceToken
      ) {
        this.invalidWebSocketAuthAttempts += 1;
        socket.queue({
          event: "authentication_failed",
          error: "INVALID_DEVICE_CREDENTIALS",
        });
        socket.reject(4003, "INVALID_CREDENTIALS");
        return;
      }

      this.#activeSocket = socket;
      const authState =
        this.#state === "completed" ? "idle" : this.#state;
      this.authenticatedStates.push(authState);
      socket.queue({
        event: "authenticated",
        status: "ok",
        device_id: deviceId,
        backend_state: authState,
        active_request_id:
          authState === "idle" ? null : this.mainRequestId,
      });
      if (this.#state === "thinking") {
        socket.queue({
          event: "display_status",
          request_id: this.mainRequestId,
          status: "thinking",
        });
        this.#state = "audio_ready";
        this.#queueAudioReady();
      } else if (this.#state === "audio_ready") {
        this.#queueAudioReady();
      }
      return;
    }

    if (message.event === "audio_playback_done" && this.mainRequestId) {
      this.completionMessages += 1;
      if (message.request_id === this.mainRequestId) {
        this.#state = "completed";
      }
      return;
    }

    socket.reject(4001, "AUTHENTICATION_REQUIRED");
  }

  disconnect(socket: FakeSocket): void {
    if (this.#activeSocket === socket) this.#activeSocket = undefined;
  }

  #queueAudioReady(): void {
    this.#activeSocket?.queue({
      event: "audio_ready",
      request_id: this.mainRequestId,
      audio_url: audioUrl,
      format: "mp3",
      expires_in_seconds: 300,
    });
  }
}

function dependencies(backend: FakePublicBackend): AcceptanceDependencies {
  let index = 0;
  return {
    connectWebSocket: backend.connectWebSocket,
    fetch: backend.fetch,
    requestIdFactory: () => requestIds[index++]!,
    sleep: async () => {},
  };
}

function options(backend: FakePublicBackend): P7PublicAcceptanceOptions {
  return {
    apiBaseUrl,
    webSocketUrl,
    deviceId,
    deviceToken,
    wav: backend.wav,
    timeoutMs: 1_000,
  };
}

function checkNames(
  report: Awaited<ReturnType<typeof runP7PublicAcceptance>>,
): string[] {
  return report.checks.map((check) => check.name);
}

describe("P7 public fake-ESP32 acceptance verifier", () => {
  it("passes the complete canonical happy path", async () => {
    const backend = new FakePublicBackend();

    const report = await runP7PublicAcceptance(
      options(backend),
      dependencies(backend),
    );

    expect(report.result, renderJson(report)).toBe("PASS");
    expect(report.summary.failed).toBe(0);
    expect(checkNames(report)).toEqual(
      expect.arrayContaining([
        "public_health",
        "websocket_valid_auth",
        "voice_accept",
        "thinking_event",
        "audio_ready_event",
        "completed_audio_unavailable",
        "device_busy",
        "invalid_request_id",
        "invalid_wav_body",
        "invalid_wav_metadata",
        "mp3_download",
      ]),
    );
  });

  it("verifies canonical missing and invalid WebSocket authentication", async () => {
    const backend = new FakePublicBackend();

    const report = await runP7PublicAcceptance(
      options(backend),
      dependencies(backend),
    );

    expect(report.result).toBe("PASS");
    expect(backend.invalidWebSocketAuthAttempts).toBe(1);
    expect(backend.invalidHttpAuthAttempts).toBe(1);
    expect(
      report.checks.find(
        (check) => check.name === "websocket_missing_auth",
      )?.websocket_close_code,
    ).toBe(4001);
    expect(
      report.checks.find(
        (check) => check.name === "websocket_invalid_auth",
      )?.websocket_close_code,
    ).toBe(4003);
    expect(checkNames(report)).toEqual(
      expect.arrayContaining([
        "websocket_missing_auth",
        "websocket_invalid_auth",
        "http_invalid_auth",
      ]),
    );
  });

  it("verifies duplicate uploads without creating another lifecycle", async () => {
    const backend = new FakePublicBackend();

    const report = await runP7PublicAcceptance(
      options(backend),
      dependencies(backend),
    );

    expect(report.result).toBe("PASS");
    expect(backend.duplicateUploads).toBeGreaterThanOrEqual(3);
    expect(backend.audioDownloads).toBe(1);
    expect(checkNames(report)).toContain("duplicate_upload");
    expect(checkNames(report)).toContain("duplicate_audio_ready");
  });

  it("verifies REQUEST_ID_CONFLICT for changed WAV bytes", async () => {
    const backend = new FakePublicBackend();

    const report = await runP7PublicAcceptance(
      options(backend),
      dependencies(backend),
    );

    expect(report.result).toBe("PASS");
    expect(backend.conflictUploads).toBe(1);
    expect(checkNames(report)).toContain("request_id_conflict");
  });

  it("verifies thinking and audio_ready reconnect resynchronization", async () => {
    const backend = new FakePublicBackend();

    const report = await runP7PublicAcceptance(
      options(backend),
      dependencies(backend),
    );

    expect(report.result).toBe("PASS");
    expect(backend.authenticatedStates).toEqual([
      "idle",
      "thinking",
      "audio_ready",
      "idle",
    ]);
    expect(checkNames(report)).toEqual(
      expect.arrayContaining([
        "reconnect_thinking",
        "reconnect_audio_ready",
      ]),
    );
  });

  it("resends playback completion idempotently after reconnect", async () => {
    const backend = new FakePublicBackend();

    const report = await runP7PublicAcceptance(
      options(backend),
      dependencies(backend),
    );

    expect(report.result).toBe("PASS");
    expect(backend.completionMessages).toBe(2);
    expect(checkNames(report)).toContain("completion_resend");
  });

  it.each([
    ["MIME", { audioContentType: "application/octet-stream" }],
    ["cache header", { audioCacheControl: "no-store" }],
  ])("fails closed on invalid MP3 %s", async (_name, overrides) => {
    const backend = new FakePublicBackend(overrides);

    const report = await runP7PublicAcceptance(
      options(backend),
      dependencies(backend),
    );

    expect(report.result).toBe("FAIL");
    expect(
      report.checks.find((check) => check.name === "mp3_download")?.status,
    ).toBe("FAIL");
  });

  it.each([
    ["livez", { livezStatus: 200 }],
    ["readyz", { readyzStatus: 200 }],
  ])("requires public /%s to return 404", async (_name, overrides) => {
    const backend = new FakePublicBackend(overrides);

    const report = await runP7PublicAcceptance(
      options(backend),
      dependencies(backend),
    );

    expect(report.result).toBe("FAIL");
    expect(report.checks.at(-1)?.http_status).toBe(200);
  });

  it("renders evidence without credentials or sensitive response text", async () => {
    const backend = new FakePublicBackend({ healthStatus: 503 });
    const report = await runP7PublicAcceptance(
      options(backend),
      dependencies(backend),
    );

    const evidence = renderHuman(report) + renderJson(report);

    expect(report.result).toBe("FAIL");
    expect(evidence).not.toContain(deviceToken);
    expect(evidence).not.toContain(backend.sensitiveResponseText);
    expect(evidence).not.toContain("Authorization");
    expect(evidence).not.toContain("X-Device-Token");
    expect(
      backend.requestedUrls.every((url) => !url.includes(deviceToken)),
    ).toBe(true);
  });

  it("returns nonzero and valid JSON when a mandatory gate fails", async () => {
    const backend = new FakePublicBackend({ livezStatus: 200 });
    let output = "";

    const exitCode = await runCli({
      argv: ["--json"],
      env: {
        P7_PUBLIC_API_BASE_URL: apiBaseUrl,
        P7_PUBLIC_WSS_URL: webSocketUrl,
        P7_DEVICE_ID: deviceId,
        P7_DEVICE_TOKEN: deviceToken,
        P7_TEST_WAV_PATH: "/non-production/test.wav",
      },
      readFile: async () => backend.wav,
      stdout: { write: (value) => void (output += value) },
      dependencies: dependencies(backend),
    });

    expect(exitCode).toBe(1);
    expect(JSON.parse(output)).toMatchObject({ result: "FAIL" });
    expect(output).not.toContain(deviceToken);
  });
});
