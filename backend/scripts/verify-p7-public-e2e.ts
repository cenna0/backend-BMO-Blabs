import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

type JsonObject = Record<string, unknown>;
type ReportStatus = "PASS" | "FAIL";

const CACHE_CONTROL = "no-store, private, max-age=0";
const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const AUDIO_PATH =
  /^\/audio\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.mp3$/i;
const PUBLIC_HEALTH_FIELDS = new Set([
  "audio_service",
  "backend",
  "hermes",
  "rvc",
  "status",
]);

export interface P7PublicAcceptanceOptions {
  apiBaseUrl: string;
  webSocketUrl: string;
  deviceId: string;
  deviceToken: string;
  wav: Buffer;
  timeoutMs: number;
}

export interface SocketClose {
  code: number;
  reason: string;
}

export interface AcceptanceSocket {
  sendJson(message: JsonObject): Promise<void>;
  nextEvent(eventName: string, timeoutMs: number): Promise<JsonObject>;
  waitForClose(timeoutMs: number): Promise<SocketClose>;
  ensureOpen(durationMs: number): Promise<void>;
  close(): Promise<void>;
}

export interface AcceptanceDependencies {
  fetch(
    input: string | URL,
    init?: RequestInit,
  ): Promise<Response>;
  connectWebSocket(
    url: string,
    timeoutMs: number,
  ): Promise<AcceptanceSocket>;
  requestIdFactory(): string;
  sleep(durationMs: number): Promise<void>;
  now?: () => number;
}

export interface AcceptanceCheck {
  name: string;
  status: ReportStatus;
  duration_ms: number;
  failure_code?: string;
  request_id?: string;
  http_status?: number;
  websocket_close_code?: number;
  event_names?: string[];
  headers?: {
    cache_control?: string;
    content_length?: string;
    content_type?: string;
  };
}

export interface AcceptanceReport {
  schema_version: 1;
  started_at: string;
  duration_ms: number;
  checks: AcceptanceCheck[];
  summary: {
    passed: number;
    failed: number;
  };
  result: ReportStatus;
}

interface CheckResult<T> {
  value: T;
  evidence?: Omit<
    AcceptanceCheck,
    "duration_ms" | "failure_code" | "name" | "status"
  >;
}

interface RunCliOptions {
  argv?: string[];
  env?: NodeJS.ProcessEnv;
  readFile?: (path: string) => Promise<Buffer>;
  stdout?: { write(value: string): unknown };
  dependencies?: AcceptanceDependencies;
}

class GateFailure extends Error {
  constructor(
    readonly code: string,
    readonly evidence: Omit<
      AcceptanceCheck,
      "duration_ms" | "failure_code" | "name" | "status"
    > = {},
  ) {
    super(code);
    this.name = "GateFailure";
  }
}

class EvidenceRecorder {
  readonly checks: AcceptanceCheck[] = [];

  constructor(private readonly now: () => number) {}

  async run<T>(
    name: string,
    action: () => Promise<CheckResult<T>>,
  ): Promise<T> {
    const started = this.now();
    try {
      const result = await action();
      this.checks.push({
        name,
        status: "PASS",
        duration_ms: Math.max(0, this.now() - started),
        ...result.evidence,
      });
      return result.value;
    } catch (error) {
      this.checks.push({
        name,
        status: "FAIL",
        duration_ms: Math.max(0, this.now() - started),
        failure_code:
          error instanceof GateFailure ? error.code : "UNEXPECTED_ERROR",
        ...(error instanceof GateFailure ? error.evidence : {}),
      });
      throw error;
    }
  }
}

class RequestLifecycle {
  #audioClaimed = false;
  #audioUrl: string | undefined;
  audioReadyEvents = 0;
  thinkingEvents = 0;

  constructor(readonly requestId: string) {}

  observeThinking(event: JsonObject): void {
    requireValue(event.event === "display_status", "THINKING_EVENT");
    requireValue(event.request_id === this.requestId, "THINKING_REQUEST_ID");
    requireValue(event.status === "thinking", "THINKING_STATUS");
    this.thinkingEvents += 1;
  }

  observeAudioReady(event: JsonObject, apiOrigin: string): void {
    requireValue(event.event === "audio_ready", "AUDIO_READY_EVENT");
    requireValue(
      event.request_id === this.requestId,
      "AUDIO_READY_REQUEST_ID",
    );
    requireValue(event.format === "mp3", "AUDIO_READY_FORMAT");
    requireValue(
      typeof event.expires_in_seconds === "number" &&
        Number.isFinite(event.expires_in_seconds) &&
        event.expires_in_seconds > 0,
      "AUDIO_READY_EXPIRY",
    );
    requireValue(typeof event.audio_url === "string", "AUDIO_READY_URL");
    validateAudioUrl(event.audio_url, apiOrigin);
    this.#audioUrl = event.audio_url;
    this.audioReadyEvents += 1;
  }

  claimAudioUrl(): string | undefined {
    if (this.#audioClaimed || !this.#audioUrl) return undefined;
    this.#audioClaimed = true;
    return this.#audioUrl;
  }
}

function requireValue(
  condition: unknown,
  failureCode: string,
  evidence: Omit<
    AcceptanceCheck,
    "duration_ms" | "failure_code" | "name" | "status"
  > = {},
): asserts condition {
  if (!condition) throw new GateFailure(failureCode, evidence);
}

function asJsonObject(value: unknown, failureCode: string): JsonObject {
  requireValue(
    typeof value === "object" && value !== null && !Array.isArray(value),
    failureCode,
  );
  return value as JsonObject;
}

async function responseJson(
  response: Response,
  failureCode: string,
): Promise<JsonObject> {
  try {
    return asJsonObject(await response.json(), failureCode);
  } catch (error) {
    if (error instanceof GateFailure) throw error;
    throw new GateFailure(failureCode);
  }
}

function normalizedUrl(
  raw: string,
  protocol: "https:" | "wss:",
  failureCode: string,
): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new GateFailure(failureCode);
  }
  requireValue(url.protocol === protocol, failureCode);
  requireValue(url.username === "" && url.password === "", failureCode);
  requireValue(url.search === "" && url.hash === "", failureCode);
  return url;
}

function normalizeOptions(
  options: P7PublicAcceptanceOptions,
): P7PublicAcceptanceOptions {
  const api = normalizedUrl(
    options.apiBaseUrl,
    "https:",
    "INVALID_API_BASE_URL",
  );
  const socket = normalizedUrl(
    options.webSocketUrl,
    "wss:",
    "INVALID_WEBSOCKET_URL",
  );
  requireValue(socket.pathname === "/ws", "INVALID_WEBSOCKET_PATH");
  requireValue(
    api.origin === socket.origin.replace(/^wss:/, "https:"),
    "PUBLIC_ORIGIN_MISMATCH",
  );
  requireValue(options.deviceId.trim().length > 0, "INVALID_DEVICE_ID");
  requireValue(options.deviceToken.length > 0, "INVALID_DEVICE_TOKEN");
  requireValue(
    !options.webSocketUrl.includes(options.deviceToken),
    "CREDENTIAL_IN_WEBSOCKET_URL",
  );
  requireValue(
    Number.isInteger(options.timeoutMs) && options.timeoutMs >= 100,
    "INVALID_TIMEOUT",
  );
  requireValue(
    options.wav.length > 44 &&
      options.wav.subarray(0, 4).toString("ascii") === "RIFF" &&
      options.wav.subarray(8, 12).toString("ascii") === "WAVE",
    "INVALID_TEST_WAV",
  );
  return {
    ...options,
    apiBaseUrl: api.toString().replace(/\/$/, ""),
    webSocketUrl: socket.toString(),
  };
}

function validateAudioUrl(raw: string, apiOrigin: string): URL {
  const url = normalizedUrl(raw, "https:", "INVALID_AUDIO_URL");
  requireValue(url.origin === apiOrigin, "AUDIO_ORIGIN_MISMATCH");
  requireValue(AUDIO_PATH.test(url.pathname), "INVALID_AUDIO_PATH");
  return url;
}

function changedCanonicalWav(wav: Buffer): Buffer {
  const changed = Buffer.from(wav);
  const sampleIndex = changed.length - 1;
  changed[sampleIndex] = (changed[sampleIndex] ?? 0) ^ 0x01;
  return changed;
}

function invalidMetadataWav(wav: Buffer): Buffer {
  const changed = Buffer.from(wav);
  changed.writeUInt32LE(8_000, 24);
  return changed;
}

function publicRequestId(value: string): string {
  return UUID_V4.test(value) ? value.toLowerCase() : "[invalid-request-id]";
}

function safeEventNames(values: string[]): string[] {
  return values.filter((value) => /^[a-z_]+$/.test(value));
}

async function fetchWithTimeout(
  dependencies: AcceptanceDependencies,
  input: string | URL,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await dependencies.fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } catch {
    throw new GateFailure("HTTP_REQUEST_FAILED");
  } finally {
    clearTimeout(timer);
  }
}

function buildReport(
  startedAt: Date,
  startedMs: number,
  now: () => number,
  checks: AcceptanceCheck[],
): AcceptanceReport {
  const passed = checks.filter((check) => check.status === "PASS").length;
  const failed = checks.length - passed;
  return {
    schema_version: 1,
    started_at: startedAt.toISOString(),
    duration_ms: Math.max(0, now() - startedMs),
    checks,
    summary: { passed, failed },
    result: failed === 0 ? "PASS" : "FAIL",
  };
}

function configurationFailureReport(code: string): AcceptanceReport {
  return {
    schema_version: 1,
    started_at: new Date().toISOString(),
    duration_ms: 0,
    checks: [
      {
        name: "configuration",
        status: "FAIL",
        duration_ms: 0,
        failure_code: code,
      },
    ],
    summary: { passed: 0, failed: 1 },
    result: "FAIL",
  };
}

async function authenticate(
  socket: AcceptanceSocket,
  options: P7PublicAcceptanceOptions,
): Promise<JsonObject> {
  const event = socket.nextEvent("authenticated", options.timeoutMs);
  await socket.sendJson({
    event: "authenticate",
    device_id: options.deviceId,
    device_token: options.deviceToken,
  });
  return event;
}

function validateAuthenticated(
  event: JsonObject,
  options: {
    deviceId: string;
    backendState: "idle" | "thinking" | "audio_ready";
    requestId: string | null;
  },
): void {
  requireValue(event.event === "authenticated", "AUTH_EVENT");
  requireValue(event.status === "ok", "AUTH_STATUS");
  requireValue(event.device_id === options.deviceId, "AUTH_DEVICE_ID");
  requireValue(
    event.backend_state === options.backendState,
    "AUTH_BACKEND_STATE",
  );
  requireValue(
    event.active_request_id === options.requestId,
    "AUTH_ACTIVE_REQUEST_ID",
  );
}

async function postVoice(
  dependencies: AcceptanceDependencies,
  options: P7PublicAcceptanceOptions,
  requestId: string,
  wav: Buffer,
  deviceToken = options.deviceToken,
): Promise<Response> {
  return fetchWithTimeout(
    dependencies,
    `${options.apiBaseUrl}/api/v1/voice`,
    {
      method: "POST",
      headers: {
        "Content-Length": String(wav.length),
        "Content-Type": "audio/wav",
        "X-Device-Id": options.deviceId,
        "X-Device-Token": deviceToken,
        "X-Request-Id": requestId,
      },
      body: new Uint8Array(wav),
    },
    Math.min(options.timeoutMs, 90_000),
  );
}

async function expectErrorResponse(
  response: Response,
  status: number,
  errorCode: string,
): Promise<void> {
  requireValue(response.status === status, "ERROR_HTTP_STATUS");
  const body = await responseJson(response, "ERROR_RESPONSE_JSON");
  requireValue(body.error === errorCode, "ERROR_CODE");
}

async function expectDuplicate(
  response: Response,
  requestId: string,
  allowedStatuses: string[],
): Promise<JsonObject> {
  requireValue(response.status === 200, "DUPLICATE_HTTP_STATUS");
  const body = await responseJson(response, "DUPLICATE_RESPONSE_JSON");
  requireValue(body.request_id === requestId, "DUPLICATE_REQUEST_ID");
  requireValue(body.duplicate === true, "DUPLICATE_FLAG");
  requireValue(
    typeof body.status === "string" && allowedStatuses.includes(body.status),
    "DUPLICATE_STATUS",
  );
  requireValue(
    body.error_code === null || typeof body.error_code === "string",
    "DUPLICATE_ERROR_CODE",
  );
  return body;
}

function nextUniqueRequestId(
  dependencies: AcceptanceDependencies,
  used: Set<string>,
): string {
  const requestId = dependencies.requestIdFactory();
  requireValue(UUID_V4.test(requestId), "REQUEST_ID_GENERATION");
  requireValue(!used.has(requestId), "DUPLICATE_GENERATED_REQUEST_ID");
  used.add(requestId);
  return requestId;
}

export async function runP7PublicAcceptance(
  rawOptions: P7PublicAcceptanceOptions,
  dependencies: AcceptanceDependencies = defaultDependencies(),
): Promise<AcceptanceReport> {
  const now = dependencies.now ?? Date.now;
  const startedAt = new Date();
  const startedMs = now();
  const recorder = new EvidenceRecorder(now);
  const sockets = new Set<AcceptanceSocket>();
  let options: P7PublicAcceptanceOptions;

  try {
    options = normalizeOptions(rawOptions);
  } catch (error) {
    const code =
      error instanceof GateFailure ? error.code : "INVALID_CONFIGURATION";
    return configurationFailureReport(code);
  }

  const apiOrigin = new URL(options.apiBaseUrl).origin;
  const quickTimeoutMs = Math.min(options.timeoutMs, 10_000);
  const usedRequestIds = new Set<string>();
  const connect = async (): Promise<AcceptanceSocket> => {
    try {
      const socket = await dependencies.connectWebSocket(
        options.webSocketUrl,
        options.timeoutMs,
      );
      sockets.add(socket);
      return socket;
    } catch {
      throw new GateFailure("WEBSOCKET_CONNECT_FAILED");
    }
  };

  let activeSocket: AcceptanceSocket | undefined;
  try {
    await recorder.run("public_health", async () => {
      const response = await fetchWithTimeout(
        dependencies,
        `${options.apiBaseUrl}/health`,
        {},
        quickTimeoutMs,
      );
      requireValue(
        response.status === 200,
        "HEALTH_HTTP_STATUS",
        { http_status: response.status },
      );
      const body = await responseJson(response, "HEALTH_RESPONSE_JSON");
      requireValue(
        Object.keys(body).every((key) => PUBLIC_HEALTH_FIELDS.has(key)),
        "HEALTH_UNEXPECTED_FIELD",
      );
      requireValue(
        body.status === "ok" || body.status === "degraded",
        "HEALTH_STATUS",
      );
      requireValue(body.backend === "ok", "HEALTH_BACKEND");
      requireValue(body.hermes === "ok", "HEALTH_HERMES");
      requireValue(body.audio_service === "ok", "HEALTH_AUDIO_SERVICE");
      requireValue(
        body.rvc === "available" || body.rvc === "unavailable",
        "HEALTH_RVC",
      );
      return { value: undefined, evidence: { http_status: response.status } };
    });

    for (const [name, path] of [
      ["public_livez_hidden", "/livez"],
      ["public_readyz_hidden", "/readyz"],
    ] as const) {
      await recorder.run(name, async () => {
        const response = await fetchWithTimeout(
          dependencies,
          `${options.apiBaseUrl}${path}`,
          {},
          quickTimeoutMs,
        );
        requireValue(
          response.status === 404,
          "INTERNAL_HEALTH_EXPOSED",
          { http_status: response.status },
        );
        return {
          value: undefined,
          evidence: { http_status: response.status },
        };
      });
    }

    const missingAuthRequestId = nextUniqueRequestId(
      dependencies,
      usedRequestIds,
    );
    await recorder.run("websocket_missing_auth", async () => {
      const socket = await connect();
      const closed = socket.waitForClose(quickTimeoutMs);
      await socket.sendJson({
        event: "audio_playback_done",
        request_id: missingAuthRequestId,
      });
      const close = await closed;
      requireValue(close.code === 4001, "MISSING_AUTH_CLOSE_CODE");
      return {
        value: undefined,
        evidence: {
          event_names: safeEventNames(["audio_playback_done"]),
          request_id: publicRequestId(missingAuthRequestId),
          websocket_close_code: close.code,
        },
      };
    });

    await recorder.run("websocket_invalid_auth", async () => {
      const socket = await connect();
      const failure = socket.nextEvent(
        "authentication_failed",
        quickTimeoutMs,
      );
      const closed = socket.waitForClose(quickTimeoutMs);
      await socket.sendJson({
        event: "authenticate",
        device_id: options.deviceId,
        device_token: `invalid-${randomUUID()}`,
      });
      const [event, close] = await Promise.all([failure, closed]);
      requireValue(
        event.event === "authentication_failed" &&
          event.error === "INVALID_DEVICE_CREDENTIALS",
        "INVALID_AUTH_EVENT",
      );
      requireValue(close.code === 4003, "INVALID_AUTH_CLOSE_CODE");
      return {
        value: undefined,
        evidence: {
          event_names: safeEventNames(["authentication_failed"]),
          websocket_close_code: close.code,
        },
      };
    });

    activeSocket = await recorder.run("websocket_valid_auth", async () => {
      const socket = await connect();
      const event = await authenticate(socket, options);
      validateAuthenticated(event, {
        deviceId: options.deviceId,
        backendState: "idle",
        requestId: null,
      });
      return {
        value: socket,
        evidence: { event_names: safeEventNames(["authenticated"]) },
      };
    });

    const invalidAuthRequestId = nextUniqueRequestId(
      dependencies,
      usedRequestIds,
    );
    await recorder.run("http_invalid_auth", async () => {
      const response = await postVoice(
        dependencies,
        options,
        invalidAuthRequestId,
        options.wav,
        `invalid-${randomUUID()}`,
      );
      await expectErrorResponse(
        response,
        401,
        "INVALID_DEVICE_CREDENTIALS",
      );
      return {
        value: undefined,
        evidence: {
          http_status: response.status,
          request_id: publicRequestId(invalidAuthRequestId),
        },
      };
    });

    await recorder.run("invalid_request_id", async () => {
      const response = await postVoice(
        dependencies,
        options,
        "not-a-uuid",
        options.wav,
      );
      await expectErrorResponse(response, 400, "INVALID_REQUEST_ID");
      return {
        value: undefined,
        evidence: { http_status: response.status },
      };
    });

    const invalidWavBodyRequestId = nextUniqueRequestId(
      dependencies,
      usedRequestIds,
    );
    await recorder.run("invalid_wav_body", async () => {
      const response = await postVoice(
        dependencies,
        options,
        invalidWavBodyRequestId,
        Buffer.from("not-a-canonical-wav"),
      );
      await expectErrorResponse(response, 422, "INVALID_AUDIO_FORMAT");
      return {
        value: undefined,
        evidence: {
          http_status: response.status,
          request_id: publicRequestId(invalidWavBodyRequestId),
        },
      };
    });

    const invalidWavMetadataRequestId = nextUniqueRequestId(
      dependencies,
      usedRequestIds,
    );
    await recorder.run("invalid_wav_metadata", async () => {
      const response = await postVoice(
        dependencies,
        options,
        invalidWavMetadataRequestId,
        invalidMetadataWav(options.wav),
      );
      await expectErrorResponse(response, 422, "INVALID_AUDIO_FORMAT");
      return {
        value: undefined,
        evidence: {
          http_status: response.status,
          request_id: publicRequestId(invalidWavMetadataRequestId),
        },
      };
    });

    const requestId = nextUniqueRequestId(dependencies, usedRequestIds);
    const lifecycle = new RequestLifecycle(requestId);
    await recorder.run("voice_accept", async () => {
      const response = await postVoice(
        dependencies,
        options,
        requestId,
        options.wav,
      );
      requireValue(response.status === 202, "VOICE_ACCEPT_HTTP_STATUS");
      const body = await responseJson(response, "VOICE_ACCEPT_RESPONSE_JSON");
      requireValue(body.request_id === requestId, "VOICE_ACCEPT_REQUEST_ID");
      requireValue(body.status === "processing", "VOICE_ACCEPT_STATUS");
      return {
        value: undefined,
        evidence: {
          http_status: response.status,
          request_id: publicRequestId(requestId),
        },
      };
    });

    await recorder.run("thinking_event", async () => {
      const event = await activeSocket!.nextEvent(
        "display_status",
        options.timeoutMs,
      );
      lifecycle.observeThinking(event);
      return {
        value: undefined,
        evidence: {
          event_names: safeEventNames(["display_status"]),
          request_id: publicRequestId(requestId),
        },
      };
    });

    await recorder.run("duplicate_upload", async () => {
      const response = await postVoice(
        dependencies,
        options,
        requestId,
        options.wav,
      );
      await expectDuplicate(response, requestId, [
        "processing",
        "audio_ready",
      ]);
      return {
        value: undefined,
        evidence: {
          http_status: response.status,
          request_id: publicRequestId(requestId),
        },
      };
    });

    await recorder.run("request_id_conflict", async () => {
      const response = await postVoice(
        dependencies,
        options,
        requestId,
        changedCanonicalWav(options.wav),
      );
      await expectErrorResponse(response, 409, "REQUEST_ID_CONFLICT");
      return {
        value: undefined,
        evidence: {
          http_status: response.status,
          request_id: publicRequestId(requestId),
        },
      };
    });

    const busyRequestId = nextUniqueRequestId(
      dependencies,
      usedRequestIds,
    );
    await recorder.run("device_busy", async () => {
      const response = await postVoice(
        dependencies,
        options,
        busyRequestId,
        options.wav,
      );
      await expectErrorResponse(response, 409, "DEVICE_BUSY");
      return {
        value: undefined,
        evidence: {
          http_status: response.status,
          request_id: publicRequestId(busyRequestId),
        },
      };
    });

    await activeSocket.close();
    activeSocket = await recorder.run("reconnect_thinking", async () => {
      const socket = await connect();
      const authenticated = await authenticate(socket, options);
      validateAuthenticated(authenticated, {
        deviceId: options.deviceId,
        backendState: "thinking",
        requestId,
      });
      const thinking = await socket.nextEvent(
        "display_status",
        options.timeoutMs,
      );
      lifecycle.observeThinking(thinking);
      requireValue(
        lifecycle.thinkingEvents >= 2,
        "THINKING_RESYNC_MISSING",
      );
      return {
        value: socket,
        evidence: {
          event_names: safeEventNames([
            "authenticated",
            "display_status",
          ]),
          request_id: publicRequestId(requestId),
        },
      };
    });

    await recorder.run("audio_ready_event", async () => {
      const event = await activeSocket!.nextEvent(
        "audio_ready",
        options.timeoutMs,
      );
      lifecycle.observeAudioReady(event, apiOrigin);
      return {
        value: undefined,
        evidence: {
          event_names: safeEventNames(["audio_ready"]),
          request_id: publicRequestId(requestId),
        },
      };
    });

    await activeSocket.close();
    activeSocket = await recorder.run(
      "reconnect_audio_ready",
      async () => {
        const socket = await connect();
        const authenticated = await authenticate(socket, options);
        validateAuthenticated(authenticated, {
          deviceId: options.deviceId,
          backendState: "audio_ready",
          requestId,
        });
        const audioReady = await socket.nextEvent(
          "audio_ready",
          options.timeoutMs,
        );
        lifecycle.observeAudioReady(audioReady, apiOrigin);
        return {
          value: socket,
          evidence: {
            event_names: safeEventNames([
              "authenticated",
              "audio_ready",
            ]),
            request_id: publicRequestId(requestId),
          },
        };
      },
    );

    await recorder.run("duplicate_audio_ready", async () => {
      const response = await postVoice(
        dependencies,
        options,
        requestId,
        options.wav,
      );
      await expectDuplicate(response, requestId, ["audio_ready"]);
      const duplicateEvent = await activeSocket!.nextEvent(
        "audio_ready",
        options.timeoutMs,
      );
      lifecycle.observeAudioReady(duplicateEvent, apiOrigin);
      requireValue(
        lifecycle.audioReadyEvents >= 3,
        "AUDIO_READY_RESEND_MISSING",
      );
      return {
        value: undefined,
        evidence: {
          event_names: safeEventNames(["audio_ready"]),
          http_status: response.status,
          request_id: publicRequestId(requestId),
        },
      };
    });

    const claimedAudioUrl = lifecycle.claimAudioUrl();
    requireValue(claimedAudioUrl, "AUDIO_URL_NOT_CLAIMED");
    requireValue(
      lifecycle.claimAudioUrl() === undefined,
      "DUPLICATE_AUDIO_CLAIM",
    );
    await recorder.run("mp3_download", async () => {
      const response = await fetchWithTimeout(
        dependencies,
        claimedAudioUrl,
        {},
        Math.min(options.timeoutMs, 90_000),
      );
      const contentType = response.headers.get("content-type") ?? "";
      const cacheControl = response.headers.get("cache-control") ?? "";
      const contentLength = response.headers.get("content-length") ?? "";
      const evidence = {
        headers: {
          cache_control: cacheControl,
          content_length: contentLength,
          content_type: contentType,
        },
        http_status: response.status,
        request_id: publicRequestId(requestId),
      };
      requireValue(
        response.status === 200,
        "AUDIO_HTTP_STATUS",
        evidence,
      );
      requireValue(
        contentType === "audio/mpeg",
        "AUDIO_CONTENT_TYPE",
        evidence,
      );
      requireValue(
        cacheControl === CACHE_CONTROL,
        "AUDIO_CACHE_CONTROL",
        evidence,
      );
      requireValue(
        /^[1-9]\d*$/.test(contentLength),
        "AUDIO_CONTENT_LENGTH",
        evidence,
      );
      const audio = Buffer.from(await response.arrayBuffer());
      requireValue(audio.length > 0, "AUDIO_EMPTY", evidence);
      requireValue(
        Number(contentLength) === audio.length,
        "AUDIO_LENGTH_MISMATCH",
        evidence,
      );
      return {
        value: undefined,
        evidence,
      };
    });

    await recorder.run("playback_completion", async () => {
      await activeSocket!.sendJson({
        event: "audio_playback_done",
        request_id: requestId,
      });
      let response: Response | undefined;
      let body: JsonObject | undefined;
      for (let attempt = 0; attempt < 10; attempt += 1) {
        response = await postVoice(
          dependencies,
          options,
          requestId,
          options.wav,
        );
        body = await expectDuplicate(response, requestId, [
          "audio_ready",
          "completed",
        ]);
        if (body.status === "completed") break;
        await dependencies.sleep(100);
      }
      requireValue(body?.status === "completed", "COMPLETION_NOT_OBSERVED");
      return {
        value: undefined,
        evidence: {
          event_names: safeEventNames(["audio_playback_done"]),
          http_status: response!.status,
          request_id: publicRequestId(requestId),
        },
      };
    });

    await activeSocket.close();
    activeSocket = await recorder.run("completion_resend", async () => {
      const socket = await connect();
      const authenticated = await authenticate(socket, options);
      validateAuthenticated(authenticated, {
        deviceId: options.deviceId,
        backendState: "idle",
        requestId: null,
      });
      await socket.sendJson({
        event: "audio_playback_done",
        request_id: requestId,
      });
      await socket.ensureOpen(100);
      return {
        value: socket,
        evidence: {
          event_names: safeEventNames([
            "authenticated",
            "audio_playback_done",
          ]),
          request_id: publicRequestId(requestId),
        },
      };
    });

    await recorder.run("completed_audio_unavailable", async () => {
      const response = await fetchWithTimeout(
        dependencies,
        claimedAudioUrl,
        {},
        quickTimeoutMs,
      );
      requireValue(
        response.status === 404 || response.status === 410,
        "COMPLETED_AUDIO_STILL_AVAILABLE",
      );
      if (response.status === 410) {
        const body = await responseJson(
          response,
          "AUDIO_EXPIRED_RESPONSE_JSON",
        );
        requireValue(body.error === "AUDIO_EXPIRED", "AUDIO_EXPIRED_CODE");
      }
      return {
        value: undefined,
        evidence: {
          http_status: response.status,
          request_id: publicRequestId(requestId),
        },
      };
    });
  } catch {
    // The failed mandatory gate is already recorded without raw error text.
  } finally {
    await Promise.all(
      [...sockets].map(async (socket) => {
        try {
          await socket.close();
        } catch {
          // Cleanup failure must not expose transport details in evidence.
        }
      }),
    );
  }

  return buildReport(startedAt, startedMs, now, recorder.checks);
}

interface EventWaiter {
  eventName: string;
  resolve(event: JsonObject): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
}

class NodeWebSocket implements AcceptanceSocket {
  readonly #events: JsonObject[] = [];
  readonly #waiters: EventWaiter[] = [];
  readonly #socket: WebSocket;
  #close: SocketClose | undefined;
  #closeWaiters: Array<(close: SocketClose) => void> = [];

  private constructor(url: string) {
    this.#socket = new WebSocket(url);
    this.#socket.on("message", (data, isBinary) => {
      if (isBinary) {
        this.#rejectEventWaiters("WEBSOCKET_BINARY_MESSAGE");
        return;
      }
      let event: JsonObject;
      try {
        event = asJsonObject(
          JSON.parse(data.toString()),
          "WEBSOCKET_EVENT_JSON",
        );
      } catch {
        this.#rejectEventWaiters("WEBSOCKET_EVENT_JSON");
        return;
      }
      const eventName =
        typeof event.event === "string" ? event.event : "";
      const index = this.#waiters.findIndex(
        (waiter) => waiter.eventName === eventName,
      );
      if (index < 0) {
        this.#events.push(event);
        return;
      }
      const [waiter] = this.#waiters.splice(index, 1);
      if (waiter) {
        clearTimeout(waiter.timer);
        waiter.resolve(event);
      }
    });
    this.#socket.on("close", (code, reason) => {
      this.#close = { code, reason: reason.toString() };
      for (const resolve of this.#closeWaiters.splice(0)) {
        resolve(this.#close);
      }
      this.#rejectEventWaiters("WEBSOCKET_CLOSED");
    });
    this.#socket.on("error", () => {
      this.#rejectEventWaiters("WEBSOCKET_ERROR");
    });
  }

  static async connect(
    url: string,
    timeoutMs: number,
  ): Promise<NodeWebSocket> {
    const client = new NodeWebSocket(url);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        client.#socket.terminate();
        reject(new GateFailure("WEBSOCKET_CONNECT_TIMEOUT"));
      }, timeoutMs);
      client.#socket.once("open", () => {
        clearTimeout(timer);
        resolve();
      });
      client.#socket.once("error", () => {
        clearTimeout(timer);
        reject(new GateFailure("WEBSOCKET_CONNECT_ERROR"));
      });
    });
    return client;
  }

  sendJson(message: JsonObject): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.#socket.readyState !== WebSocket.OPEN) {
        reject(new GateFailure("WEBSOCKET_NOT_OPEN"));
        return;
      }
      this.#socket.send(JSON.stringify(message), (error) => {
        if (error) reject(new GateFailure("WEBSOCKET_SEND_FAILED"));
        else resolve();
      });
    });
  }

  nextEvent(eventName: string, timeoutMs: number): Promise<JsonObject> {
    const index = this.#events.findIndex(
      (event) => event.event === eventName,
    );
    if (index >= 0) {
      return Promise.resolve(this.#events.splice(index, 1)[0]!);
    }
    if (this.#close) {
      return Promise.reject(new GateFailure("WEBSOCKET_CLOSED"));
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const waiterIndex = this.#waiters.findIndex(
          (waiter) => waiter.timer === timer,
        );
        if (waiterIndex >= 0) this.#waiters.splice(waiterIndex, 1);
        reject(new GateFailure("WEBSOCKET_EVENT_TIMEOUT"));
      }, timeoutMs);
      this.#waiters.push({ eventName, resolve, reject, timer });
    });
  }

  waitForClose(timeoutMs: number): Promise<SocketClose> {
    if (this.#close) return Promise.resolve(this.#close);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new GateFailure("WEBSOCKET_CLOSE_TIMEOUT")),
        timeoutMs,
      );
      this.#closeWaiters.push((close) => {
        clearTimeout(timer);
        resolve(close);
      });
    });
  }

  async ensureOpen(durationMs: number): Promise<void> {
    requireValue(
      this.#socket.readyState === WebSocket.OPEN,
      "WEBSOCKET_NOT_OPEN",
    );
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, durationMs);
      this.#socket.once("close", () => {
        clearTimeout(timer);
        reject(new GateFailure("WEBSOCKET_CLOSED"));
      });
    });
  }

  async close(): Promise<void> {
    if (
      this.#socket.readyState === WebSocket.CLOSED ||
      this.#socket.readyState === WebSocket.CLOSING
    ) {
      return;
    }
    const closed = this.waitForClose(1_000).catch(() => undefined);
    this.#socket.close(1000, "CLIENT_CLOSE");
    await closed;
  }

  #rejectEventWaiters(code: string): void {
    for (const waiter of this.#waiters.splice(0)) {
      clearTimeout(waiter.timer);
      waiter.reject(new GateFailure(code));
    }
  }
}

function defaultDependencies(): AcceptanceDependencies {
  return {
    fetch: (input, init) => fetch(input, init),
    connectWebSocket: (url, timeoutMs) =>
      NodeWebSocket.connect(url, timeoutMs),
    requestIdFactory: randomUUID,
    sleep: (durationMs) =>
      new Promise((resolve) => setTimeout(resolve, durationMs)),
  };
}

function requiredEnv(
  env: NodeJS.ProcessEnv,
  name: string,
): string {
  const value = env[name];
  if (!value) throw new GateFailure(`MISSING_${name}`);
  return value;
}

function renderHeaders(check: AcceptanceCheck): string {
  if (!check.headers) return "";
  const values = [
    check.headers.content_type
      ? `content-type=${check.headers.content_type}`
      : "",
    check.headers.cache_control
      ? `cache-control=${check.headers.cache_control}`
      : "",
    check.headers.content_length
      ? `content-length=${check.headers.content_length}`
      : "",
  ].filter(Boolean);
  return values.length > 0 ? ` headers=${values.join(",")}` : "";
}

export function renderHuman(report: AcceptanceReport): string {
  const lines = [`P7 public fake-ESP32 acceptance: ${report.result}`];
  for (const check of report.checks) {
    const request = check.request_id
      ? ` request_id=${check.request_id}`
      : "";
    const http =
      check.http_status === undefined
        ? ""
        : ` http_status=${check.http_status}`;
    const websocketClose =
      check.websocket_close_code === undefined
        ? ""
        : ` websocket_close_code=${check.websocket_close_code}`;
    const events = check.event_names?.length
      ? ` events=${check.event_names.join(",")}`
      : "";
    const failure = check.failure_code
      ? ` failure=${check.failure_code}`
      : "";
    lines.push(
      `[${check.status}] ${check.name} ${check.duration_ms}ms` +
        request +
        http +
        websocketClose +
        events +
        renderHeaders(check) +
        failure,
    );
  }
  lines.push(
    `Summary: passed=${report.summary.passed} ` +
      `failed=${report.summary.failed} duration=${report.duration_ms}ms`,
  );
  return `${lines.join("\n")}\n`;
}

export function renderJson(report: AcceptanceReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

export async function runCli(
  cli: RunCliOptions = {},
): Promise<number> {
  const argv = cli.argv ?? process.argv.slice(2);
  const env = cli.env ?? process.env;
  const output = cli.stdout ?? process.stdout;
  const readWav = cli.readFile ?? readFile;
  const json = argv.length === 1 && argv[0] === "--json";
  if (argv.length > (json ? 1 : 0)) {
    const report = configurationFailureReport("INVALID_ARGUMENTS");
    output.write(json ? renderJson(report) : renderHuman(report));
    return 1;
  }

  let report: AcceptanceReport;
  try {
    const wavPath = requiredEnv(env, "P7_TEST_WAV_PATH");
    const timeoutRaw = env.P7_ACCEPTANCE_TIMEOUT_MS ?? "330000";
    requireValue(/^\d+$/.test(timeoutRaw), "INVALID_TIMEOUT");
    const wav = await readWav(wavPath);
    report = await runP7PublicAcceptance(
      {
        apiBaseUrl: requiredEnv(env, "P7_PUBLIC_API_BASE_URL"),
        webSocketUrl: requiredEnv(env, "P7_PUBLIC_WSS_URL"),
        deviceId: requiredEnv(env, "P7_DEVICE_ID"),
        deviceToken: requiredEnv(env, "P7_DEVICE_TOKEN"),
        wav,
        timeoutMs: Number(timeoutRaw),
      },
      cli.dependencies ?? defaultDependencies(),
    );
  } catch (error) {
    report = configurationFailureReport(
      error instanceof GateFailure
        ? error.code
        : "TEST_WAV_UNREADABLE",
    );
  }

  output.write(json ? renderJson(report) : renderHuman(report));
  return report.result === "PASS" ? 0 : 1;
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === process.argv[1]
) {
  void runCli().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
