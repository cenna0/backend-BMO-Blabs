import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

import { parseEnv } from "../src/config/env.js";
import { createBackendRuntime } from "../src/server.js";

const DEFAULT_SOAK_MS = 3_600_000;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForMessage(socket: WebSocket, event: string, timeoutMs = 5_000): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off("message", onMessage);
      reject(new Error(`Timed out waiting for ${event}`));
    }, timeoutMs);
    const onMessage = (data: WebSocket.RawData) => {
      const message = JSON.parse(data.toString()) as Record<string, unknown>;
      if (message.event !== event) return;
      clearTimeout(timer);
      socket.off("message", onMessage);
      resolve(message);
    };
    socket.on("message", onMessage);
  });
}

async function connectAndAuthenticate(baseUrl: string): Promise<WebSocket> {
  const socket = await new Promise<WebSocket>((resolve, reject) => {
    const candidate = new WebSocket(baseUrl.replace(/^http/, "ws") + "/ws");
    candidate.once("open", () => resolve(candidate));
    candidate.once("error", reject);
  });
  const authenticated = waitForMessage(socket, "authenticated");
  socket.send(
    JSON.stringify({
      event: "authenticate",
      device_id: "bmo-001",
      device_token: "test-device-secret",
    }),
  );
  await authenticated;
  return socket;
}

async function main(): Promise<void> {
  const soakMs = Number(process.env.P5_SOAK_MS ?? DEFAULT_SOAK_MS);
  if (!Number.isFinite(soakMs) || soakMs <= 0) {
    throw new Error("P5_SOAK_MS must be a positive number when provided");
  }
  const tempDir = await mkdtemp(join(tmpdir(), "bmo-p5-soak-"));
  const fixture = fileURLToPath(new URL("../tests/fixtures/test-response.mp3", import.meta.url));
  const config = parseEnv({
    NODE_ENV: "test",
    BACKEND_HOST: "127.0.0.1",
    BACKEND_PORT: "3000",
    PUBLIC_BASE_URL: "http://127.0.0.1:0",
    DEVICE_ID: "bmo-001",
    DEVICE_TOKEN: "test-device-secret",
    TEMP_AUDIO_DIR: tempDir,
    HARDWARE_TEST_MODE: "true",
    HARDWARE_TEST_MP3_PATH: fixture,
    WS_AUTH_TIMEOUT_MS: "5000",
    WS_HEARTBEAT_INTERVAL_MS: "60000",
    WS_MAX_MISSED_PONGS: "2",
  });
  const runtime = createBackendRuntime(config);
  const unhandled: string[] = [];
  const onUnhandled = (reason: unknown) => {
    unhandled.push(reason instanceof Error ? reason.message : String(reason));
  };
  process.on("unhandledRejection", onUnhandled);
  let socket: WebSocket | undefined;
  let closeCount = 0;
  try {
    const address = await runtime.start(0);
    const baseUrl = `http://127.0.0.1:${address.port}`;
    socket = await connectAndAuthenticate(baseUrl);
    socket.on("close", () => {
      closeCount += 1;
    });
    const memoryStart = process.memoryUsage();
    const startedAt = Date.now();
    await wait(soakMs);
    const durationMs = Date.now() - startedAt;
    const memoryEnd = process.memoryUsage();
    const stats = runtime.sockets.getHeartbeatStats();
    const result = {
      duration_ms: durationMs,
      memory_start_rss_bytes: memoryStart.rss,
      memory_end_rss_bytes: memoryEnd.rss,
      memory_delta_rss_bytes: memoryEnd.rss - memoryStart.rss,
      ping_count: stats.pingCount,
      pong_count: stats.pongCount,
      terminated_count: stats.terminatedCount,
      disconnect_count: closeCount,
      reconnect_count: 0,
      unhandled_rejections: unhandled.length,
      socket_open: socket.readyState === WebSocket.OPEN,
    };
    console.log(JSON.stringify(result, null, 2));
    if (!result.socket_open || closeCount !== 0 || unhandled.length !== 0 || stats.terminatedCount !== 0) {
      process.exitCode = 1;
    }
  } finally {
    process.off("unhandledRejection", onUnhandled);
    if (socket && socket.readyState === WebSocket.OPEN) socket.close();
    await runtime.stop();
    await rm(tempDir, { recursive: true, force: true });
  }
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
