import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";

import { RequestStore } from "../src/domain/request-store.js";
import { DeviceRegistry } from "../src/websocket/device-registry.js";
import { DeviceWebSocketServer } from "../src/websocket/websocket.server.js";

const requestId = "550e8400-e29b-41d4-a716-446655440000";

interface TestRuntime {
  httpServer: Server;
  requestStore: RequestStore;
  socketServer: DeviceWebSocketServer;
  url: string;
}

const runtimes: TestRuntime[] = [];

async function startRuntime(options: { heartbeatMs?: number; maxMissedPongs?: number } = {}) {
  const httpServer = createServer();
  const requestStore = new RequestStore();
  const registry = new DeviceRegistry(requestStore);
  const socketServer = new DeviceWebSocketServer({
    httpServer,
    registry,
    deviceId: "bmo-001",
    deviceToken: "test-device-secret",
    authTimeoutMs: 80,
    heartbeatIntervalMs: options.heartbeatMs ?? 1_000,
    maxMissedPongs: options.maxMissedPongs ?? 2,
    maxMessageBytes: 8_192,
  });

  await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  const address = httpServer.address();
  if (!address || typeof address === "string") throw new Error("test server did not bind");
  const runtime = {
    httpServer,
    requestStore,
    socketServer,
    url: `ws://127.0.0.1:${address.port}/ws`,
  };
  runtimes.push(runtime);
  return runtime;
}

function connect(url: string, options: WebSocket.ClientOptions = {}): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, options);
    socket.once("open", () => resolve(socket));
    socket.once("error", reject);
  });
}

function nextJson(socket: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    socket.once("message", (data) => {
      try {
        resolve(JSON.parse(data.toString()) as Record<string, unknown>);
      } catch (error) {
        reject(error);
      }
    });
  });
}

function nextJsonMessages(socket: WebSocket, count: number): Promise<Record<string, unknown>[]> {
  return new Promise((resolve, reject) => {
    const messages: Record<string, unknown>[] = [];
    const onMessage = (data: WebSocket.RawData) => {
      try {
        messages.push(JSON.parse(data.toString()) as Record<string, unknown>);
        if (messages.length === count) {
          socket.off("message", onMessage);
          resolve(messages);
        }
      } catch (error) {
        socket.off("message", onMessage);
        reject(error);
      }
    };
    socket.on("message", onMessage);
  });
}

function nextClose(socket: WebSocket): Promise<{ code: number; reason: string }> {
  return new Promise((resolve) => {
    socket.once("close", (code, reason) => resolve({ code, reason: reason.toString() }));
  });
}

function authenticate(socket: WebSocket): void {
  socket.send(
    JSON.stringify({
      event: "authenticate",
      device_id: "bmo-001",
      device_token: "test-device-secret",
    }),
  );
}

afterEach(async () => {
  await Promise.all(
    runtimes.splice(0).map(async ({ httpServer, socketServer }) => {
      await socketServer.close();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    }),
  );
});

describe("P1 WebSocket contract", () => {
  it("authenticates by JSON message and reports idle backend state", async () => {
    const runtime = await startRuntime();
    const socket = await connect(runtime.url);
    const message = nextJson(socket);
    authenticate(socket);

    await expect(message).resolves.toEqual({
      event: "authenticated",
      status: "ok",
      device_id: "bmo-001",
      backend_state: "idle",
      active_request_id: null,
    });
    expect(runtime.socketServer.isAuthenticated("bmo-001")).toBe(true);
  });

  it("closes with 4001 when first message is not authenticate", async () => {
    const runtime = await startRuntime();
    const socket = await connect(runtime.url);
    const closed = nextClose(socket);
    socket.send(JSON.stringify({ event: "audio_playback_done", request_id: requestId }));

    await expect(closed).resolves.toMatchObject({ code: 4001 });
  });

  it("emits exact failure then closes with 4003 for invalid credentials", async () => {
    const runtime = await startRuntime();
    const socket = await connect(runtime.url);
    const failure = nextJson(socket);
    const closed = nextClose(socket);
    socket.send(
      JSON.stringify({ event: "authenticate", device_id: "bmo-001", device_token: "wrong-secret" }),
    );

    await expect(failure).resolves.toEqual({
      event: "authentication_failed",
      error: "INVALID_DEVICE_CREDENTIALS",
    });
    await expect(closed).resolves.toMatchObject({ code: 4003 });
  });

  it("closes with 4008 when authentication times out", async () => {
    const runtime = await startRuntime();
    const socket = await connect(runtime.url);

    await expect(nextClose(socket)).resolves.toMatchObject({ code: 4008 });
  });

  it("makes the newest authenticated connection active", async () => {
    const runtime = await startRuntime();
    const first = await connect(runtime.url);
    const firstAuth = nextJson(first);
    authenticate(first);
    await firstAuth;

    const replacementEvent = nextJson(first);
    const firstClosed = nextClose(first);
    const second = await connect(runtime.url);
    const secondAuth = nextJson(second);
    authenticate(second);

    await expect(secondAuth).resolves.toMatchObject({ event: "authenticated", status: "ok" });
    await expect(replacementEvent).resolves.toEqual({
      event: "connection_replaced",
      reason: "NEW_CONNECTION_ESTABLISHED",
    });
    await expect(firstClosed).resolves.toMatchObject({ code: 1000 });
    expect(runtime.socketServer.isAuthenticated("bmo-001")).toBe(true);
    expect(second.readyState).toBe(WebSocket.OPEN);
  });

  it("replays thinking state after authentication", async () => {
    const runtime = await startRuntime();
    runtime.requestStore.create({
      requestId,
      deviceId: "bmo-001",
      inputPath: "C:/tmp/input.wav",
      inputSha256: "a".repeat(64),
      inputContentLength: 3_244,
    });
    const socket = await connect(runtime.url);
    const messages = nextJsonMessages(socket, 2);
    authenticate(socket);

    const [authenticated, thinking] = await messages;
    expect(authenticated).toMatchObject({
      event: "authenticated",
      backend_state: "thinking",
      active_request_id: requestId,
    });
    expect(thinking).toEqual({
      event: "display_status",
      request_id: requestId,
      status: "thinking",
    });
  });

  it("replays audio-ready state with remaining TTL", async () => {
    const runtime = await startRuntime();
    runtime.requestStore.create({
      requestId,
      deviceId: "bmo-001",
      inputPath: "C:/tmp/input.wav",
      inputSha256: "a".repeat(64),
      inputContentLength: 3_244,
    });
    runtime.requestStore.markAudioReady(requestId, {
      audioId: "6b6a1bc8-55b0-4e88-b62e-289ae089fd54",
      audioPath: "C:/tmp/output.mp3",
      audioUrl: "http://127.0.0.1:3000/audio/6b6a1bc8-55b0-4e88-b62e-289ae089fd54.mp3",
      expiresAt: Date.now() + 120_000,
    });
    const socket = await connect(runtime.url);
    const messages = nextJsonMessages(socket, 2);
    authenticate(socket);

    const [authenticated, audioReady] = await messages;
    expect(authenticated).toMatchObject({
      event: "authenticated",
      backend_state: "audio_ready",
      active_request_id: requestId,
    });
    expect(audioReady).toMatchObject({
      event: "audio_ready",
      request_id: requestId,
      format: "mp3",
      expires_in_seconds: expect.any(Number),
    });
  });

  it("keeps a healthy idle connection open through native ping/pong", async () => {
    const runtime = await startRuntime({ heartbeatMs: 20 });
    const socket = await connect(runtime.url);
    const authenticated = nextJson(socket);
    authenticate(socket);
    await authenticated;

    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(socket.readyState).toBe(WebSocket.OPEN);
  });

  it("terminates after two missed pongs", async () => {
    const runtime = await startRuntime({ heartbeatMs: 20, maxMissedPongs: 2 });
    const socket = await connect(runtime.url, { autoPong: false });
    const authenticated = nextJson(socket);
    authenticate(socket);
    await authenticated;

    await expect(nextClose(socket)).resolves.toMatchObject({ code: 1006 });
  });

  it("rejects an unknown authenticated event without crashing the server", async () => {
    const runtime = await startRuntime();
    const socket = await connect(runtime.url);
    const authenticated = nextJson(socket);
    authenticate(socket);
    await authenticated;
    const closed = nextClose(socket);
    socket.send(JSON.stringify({ event: "unknown_event" }));
    await expect(closed).resolves.toMatchObject({ code: 1008 });

    const replacement = await connect(runtime.url);
    const replacementAuth = nextJson(replacement);
    authenticate(replacement);
    await expect(replacementAuth).resolves.toMatchObject({ event: "authenticated" });
  });

  it("enforces the 8 KB message limit without crashing the server", async () => {
    const runtime = await startRuntime();
    const socket = await connect(runtime.url);
    const authenticated = nextJson(socket);
    authenticate(socket);
    await authenticated;
    const closed = nextClose(socket);
    socket.send("x".repeat(8_193));
    await expect(closed).resolves.toMatchObject({ code: 1009 });

    const replacement = await connect(runtime.url);
    const replacementAuth = nextJson(replacement);
    authenticate(replacement);
    await expect(replacementAuth).resolves.toMatchObject({ event: "authenticated" });
  });
});
