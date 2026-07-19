import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

import { parseEnv } from "../../src/config/env.js";
import { createBackendRuntime, type BackendRuntime } from "../../src/server.js";

export class WsInbox {
  readonly #messages: Record<string, unknown>[] = [];
  readonly #waiters: Array<{
    event: string;
    resolve: (message: Record<string, unknown>) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
  }> = [];

  constructor(readonly socket: WebSocket) {
    socket.on("message", (data) => {
      const message = JSON.parse(data.toString()) as Record<string, unknown>;
      const waiterIndex = this.#waiters.findIndex((waiter) => waiter.event === message.event);
      if (waiterIndex >= 0) {
        const [waiter] = this.#waiters.splice(waiterIndex, 1);
        if (waiter) {
          clearTimeout(waiter.timer);
          waiter.resolve(message);
        }
      } else {
        this.#messages.push(message);
      }
    });
  }

  next(event: string, timeoutMs = 2_000): Promise<Record<string, unknown>> {
    const messageIndex = this.#messages.findIndex((message) => message.event === event);
    if (messageIndex >= 0) {
      const [message] = this.#messages.splice(messageIndex, 1);
      return Promise.resolve(message!);
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = this.#waiters.findIndex((waiter) => waiter.timer === timer);
        if (index >= 0) this.#waiters.splice(index, 1);
        reject(new Error(`Timed out waiting for ${event}`));
      }, timeoutMs);
      this.#waiters.push({ event, resolve, reject, timer });
    });
  }

  queued(event: string): number {
    return this.#messages.filter((message) => message.event === event).length;
  }
}

export interface TestRuntime {
  backend: BackendRuntime;
  baseUrl: string;
  tempDir: string;
}

export async function startTestRuntime(
  hardwareTestMode = true,
  envOverrides: Record<string, string> = {},
): Promise<TestRuntime> {
  const tempDir = await mkdtemp(join(tmpdir(), "bmo-p1-"));
  const fixture = fileURLToPath(new URL("../fixtures/test-response.mp3", import.meta.url));
  const config = parseEnv({
    NODE_ENV: "test",
    BACKEND_HOST: "127.0.0.1",
    BACKEND_PORT: "3000",
    PUBLIC_BASE_URL: "http://127.0.0.1:0",
    DEVICE_ID: "bmo-001",
    DEVICE_TOKEN: "test-device-secret",
    TEMP_AUDIO_DIR: tempDir,
    HARDWARE_TEST_MODE: String(hardwareTestMode),
    HARDWARE_TEST_MP3_PATH: fixture,
    AUDIO_SERVICE_STT_TIMEOUT_MS: "1000",
    AUDIO_SERVICE_TTS_TIMEOUT_MS: "1000",
    HERMES_HARD_TIMEOUT_MS: "1000",
    TOTAL_PIPELINE_TIMEOUT_MS: "3000",
    WS_AUTH_TIMEOUT_MS: "100",
    WS_HEARTBEAT_INTERVAL_MS: "1000",
    ...envOverrides,
  });
  const backend = createBackendRuntime(config);
  const address = await backend.start(0);
  return { backend, baseUrl: `http://127.0.0.1:${address.port}`, tempDir };
}

export async function stopTestRuntime(runtime: TestRuntime): Promise<void> {
  await runtime.backend.stop();
  await rm(runtime.tempDir, { recursive: true, force: true });
}

export async function connectDevice(runtime: TestRuntime): Promise<WsInbox> {
  const wsUrl = runtime.baseUrl.replace(/^http/, "ws") + "/ws";
  const socket = await new Promise<WebSocket>((resolve, reject) => {
    const candidate = new WebSocket(wsUrl);
    candidate.once("open", () => resolve(candidate));
    candidate.once("error", reject);
  });
  const inbox = new WsInbox(socket);
  const authenticated = inbox.next("authenticated");
  socket.send(
    JSON.stringify({
      event: "authenticate",
      device_id: "bmo-001",
      device_token: "test-device-secret",
    }),
  );
  await authenticated;
  return inbox;
}

export async function waitUntil(predicate: () => boolean | Promise<boolean>, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("condition did not become true");
}
