import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";

import { RequestStore } from "../src/domain/request-store.js";
import { sha256Hex } from "../src/p9/crypto.js";
import { DeviceRegistry } from "../src/websocket/device-registry.js";
import type { PairingCodeEvent } from "../src/websocket/events.js";
import { DeviceWebSocketServer } from "../src/websocket/websocket.server.js";

const requestId = "550e8400-e29b-41d4-a716-446655440000";

interface TestRuntime {
  httpServer: Server;
  requestStore: RequestStore;
  socketServer: DeviceWebSocketServer;
  url: string;
}

const runtimes: TestRuntime[] = [];

async function startRuntime(options: {
  heartbeatMs?: number;
  maxMissedPongs?: number;
  resolveApplicationDevice?: (deviceId: string, deviceToken: string) => Promise<{
    deviceId: string;
    userId: string;
    hardwareId: string;
  } | null>;
  authorizeApplicationDevice?: (binding: {
    deviceId: string;
    userId: string;
    hardwareId: string;
  }) => Promise<boolean>;
  onDeviceNotBound?: (deviceId: string, tokenHash: string) => PairingCodeEvent | void | Promise<PairingCodeEvent | void>;
  onPairingModeRequest?: (deviceId: string, tokenHash: string) => PairingCodeEvent | void | Promise<PairingCodeEvent | void>;
} = {}) {
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
    ...(options.resolveApplicationDevice === undefined ? {} : {
      resolveApplicationDevice: options.resolveApplicationDevice,
    }),
    ...(options.authorizeApplicationDevice === undefined ? {} : {
      authorizeApplicationDevice: options.authorizeApplicationDevice,
    }),
    ...(options.onDeviceNotBound === undefined ? {} : {
      onDeviceNotBound: options.onDeviceNotBound,
    }),
    ...(options.onPairingModeRequest === undefined ? {} : {
      onPairingModeRequest: options.onPairingModeRequest,
    }),
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

  it("authorizes a cached application binding only after an ACTIVE revalidation", async () => {
    const resolveApplicationDevice = vi.fn().mockResolvedValue({
      deviceId: "00000000-0000-4000-8000-000000000001",
      userId: "00000000-0000-4000-8000-000000000010",
      hardwareId: "bmo-001",
    });
    const authorizeApplicationDevice = vi.fn().mockResolvedValue(true);
    const runtime = await startRuntime({ resolveApplicationDevice, authorizeApplicationDevice });
    const socket = await connect(runtime.url);
    const authenticated = nextJson(socket);
    authenticate(socket);
    await authenticated;

    await expect.poll(() => runtime.socketServer.authorizeApplicationBinding("bmo-001")).toEqual({
      deviceId: "00000000-0000-4000-8000-000000000001",
      userId: "00000000-0000-4000-8000-000000000010",
      hardwareId: "bmo-001",
    });
    expect(resolveApplicationDevice).toHaveBeenCalledWith("bmo-001", "test-device-secret");
    expect(authorizeApplicationDevice).toHaveBeenCalledWith({
      deviceId: "00000000-0000-4000-8000-000000000001",
      userId: "00000000-0000-4000-8000-000000000010",
      hardwareId: "bmo-001",
    });
  });

  it("clears a cached application binding when its Device is revoked", async () => {
    const authorizeApplicationDevice = vi.fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValue(false);
    const runtime = await startRuntime({
      resolveApplicationDevice: vi.fn().mockResolvedValue({
        deviceId: "00000000-0000-4000-8000-000000000001",
        userId: "00000000-0000-4000-8000-000000000010",
        hardwareId: "bmo-001",
      }),
      authorizeApplicationDevice,
    });
    const socket = await connect(runtime.url);
    const authenticated = nextJson(socket);
    authenticate(socket);
    await authenticated;

    await expect.poll(() => runtime.socketServer.authorizeApplicationBinding("bmo-001")).not.toBeNull();
    await expect(runtime.socketServer.authorizeApplicationBinding("bmo-001")).resolves.toBeNull();
    await expect(runtime.socketServer.authorizeApplicationBinding("bmo-001")).resolves.toBeNull();
    expect(authorizeApplicationDevice).toHaveBeenCalledTimes(2);
    expect(socket.readyState).toBe(WebSocket.OPEN);
  });

  it("rejects a stale binding returned by a delayed resolver after unpair-style revocation", async () => {
    let finishResolution!: (binding: {
      deviceId: string;
      userId: string;
      hardwareId: string;
    }) => void;
    const resolveApplicationDevice = vi.fn(() => new Promise<{
      deviceId: string;
      userId: string;
      hardwareId: string;
    }>((resolve) => { finishResolution = resolve; }));
    const authorizeApplicationDevice = vi.fn().mockResolvedValue(false);
    const runtime = await startRuntime({ resolveApplicationDevice, authorizeApplicationDevice });
    const socket = await connect(runtime.url);
    const authenticated = nextJson(socket);
    authenticate(socket);
    await authenticated;
    finishResolution({
      deviceId: "00000000-0000-4000-8000-000000000001",
      userId: "00000000-0000-4000-8000-000000000010",
      hardwareId: "bmo-001",
    });

    await new Promise<void>((resolve) => setImmediate(resolve));
    await expect(runtime.socketServer.authorizeApplicationBinding("bmo-001")).resolves.toBeNull();
    expect(authorizeApplicationDevice).toHaveBeenCalledTimes(1);
    expect(socket.readyState).toBe(WebSocket.OPEN);
  });

  it("keeps legacy voice connected but reports a safe diagnostic when unbound", async () => {
    const onDeviceNotBound = vi.fn();
    const runtime = await startRuntime({
      resolveApplicationDevice: vi.fn().mockResolvedValue(null),
      onDeviceNotBound,
    });
    const socket = await connect(runtime.url);
    const authenticated = nextJson(socket);
    authenticate(socket);

    await expect(authenticated).resolves.toMatchObject({ event: "authenticated", status: "ok" });
    await expect.poll(() => onDeviceNotBound.mock.calls.length).toBe(1);
    expect(socket.readyState).toBe(WebSocket.OPEN);
    await expect(runtime.socketServer.authorizeApplicationBinding("bmo-001")).resolves.toBeNull();
  });

  it("does not issue pairing state when the application binding lookup fails", async () => {
    const onDeviceNotBound = vi.fn();
    const runtime = await startRuntime({
      resolveApplicationDevice: vi.fn().mockRejectedValue(new Error("database unavailable")),
      onDeviceNotBound,
    });
    const socket = await connect(runtime.url);
    const authenticated = nextJson(socket);
    authenticate(socket);

    await expect(authenticated).resolves.toMatchObject({ event: "authenticated", status: "ok" });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(onDeviceNotBound).not.toHaveBeenCalled();
    expect(socket.readyState).toBe(WebSocket.OPEN);
  });

  it("sends pairing code only after trusted hardware authentication and supports reissue requests", async () => {
    const onDeviceNotBound = vi.fn().mockResolvedValue({
      event: "pairing_code",
      code: "123456",
      expires_at: "2026-08-18T12:10:00.000Z",
    });
    const onPairingModeRequest = vi.fn().mockResolvedValue({
      event: "pairing_code",
      code: "654321",
      expires_at: "2026-08-18T12:10:00.000Z",
    });
    const runtime = await startRuntime({
      resolveApplicationDevice: vi.fn().mockResolvedValue(null),
      onDeviceNotBound,
      onPairingModeRequest,
    });
    const socket = await connect(runtime.url);
    const messages = nextJsonMessages(socket, 2);
    authenticate(socket);

    await expect(messages).resolves.toEqual([
      expect.objectContaining({ event: "authenticated", status: "ok" }),
      { event: "pairing_code", code: "123456", expires_at: "2026-08-18T12:10:00.000Z" },
    ]);
    expect(onDeviceNotBound).toHaveBeenCalledWith("bmo-001", sha256Hex("test-device-secret"));

    socket.send(JSON.stringify({ event: "pairing_mode_request" }));
    await expect(nextJson(socket)).resolves.toEqual({
      event: "pairing_code",
      code: "654321",
      expires_at: "2026-08-18T12:10:00.000Z",
    });
    expect(onPairingModeRequest).toHaveBeenCalledWith("bmo-001", sha256Hex("test-device-secret"));
  });

  it("keeps the claimed socket unbound until hardware reconnects and authenticates", async () => {
    const binding = {
      deviceId: "00000000-0000-4000-8000-000000000001",
      userId: "00000000-0000-4000-8000-000000000010",
      hardwareId: "bmo-001",
    };
    let activeBinding: typeof binding | null = null;
    const resolveApplicationDevice = vi.fn(async () => activeBinding);
    const authorizeApplicationDevice = vi.fn().mockResolvedValue(true);
    const onDeviceNotBound = vi.fn().mockResolvedValue({
      event: "pairing_code",
      code: "123456",
      expires_at: "2026-08-18T12:10:00.000Z",
    });
    const runtime = await startRuntime({
      resolveApplicationDevice,
      authorizeApplicationDevice,
      onDeviceNotBound,
    });
    const oldSocket = await connect(runtime.url);
    const oldMessages = nextJsonMessages(oldSocket, 2);
    authenticate(oldSocket);
    await oldMessages;

    await expect(runtime.socketServer.authorizeApplicationBinding("bmo-001")).resolves.toBeNull();
    await expect(runtime.socketServer.sendAdditiveEvent("bmo-001", {
      event: "device_settings",
      version: 1,
      settings: { playback_volume: 50 },
    })).resolves.toBe(false);

    const completed = nextJson(oldSocket);
    expect(runtime.socketServer.sendPairingEvent("bmo-001", {
      event: "pairing_completed",
      status: "ok",
    })).toBe(true);
    await expect(completed).resolves.toEqual({ event: "pairing_completed", status: "ok" });
    await expect(runtime.socketServer.authorizeApplicationBinding("bmo-001")).resolves.toBeNull();

    const oldClosed = nextClose(oldSocket);
    oldSocket.close();
    await oldClosed;

    activeBinding = binding;
    const newSocket = await connect(runtime.url);
    const newAuthenticated = nextJson(newSocket);
    authenticate(newSocket);
    await expect(newAuthenticated).resolves.toMatchObject({ event: "authenticated", status: "ok" });
    await expect.poll(() => runtime.socketServer.authorizeApplicationBinding("bmo-001")).toEqual(binding);
    await expect(runtime.socketServer.sendAdditiveEvent("bmo-001", {
      event: "device_settings",
      version: 2,
      settings: { playback_volume: 55 },
    })).resolves.toBe(true);
    expect(authorizeApplicationDevice).toHaveBeenCalledWith(binding);
  });

  it("recovers a missed pairing completion through one bound reconnect request", async () => {
    const binding = {
      deviceId: "00000000-0000-4000-8000-000000000001",
      userId: "00000000-0000-4000-8000-000000000010",
      hardwareId: "bmo-001",
    };
    let activeBinding: typeof binding | null = null;
    const onPairingModeRequest = vi.fn().mockResolvedValue({
      event: "pairing_code",
      code: "654321",
      expires_at: "2026-08-18T12:10:00.000Z",
    });
    const runtime = await startRuntime({
      resolveApplicationDevice: vi.fn(async () => activeBinding),
      authorizeApplicationDevice: vi.fn().mockResolvedValue(true),
      onDeviceNotBound: vi.fn().mockResolvedValue({
        event: "pairing_code",
        code: "123456",
        expires_at: "2026-08-18T12:10:00.000Z",
      }),
      onPairingModeRequest,
    });
    const oldSocket = await connect(runtime.url);
    const oldMessages = nextJsonMessages(oldSocket, 2);
    authenticate(oldSocket);
    await oldMessages;

    const oldClosed = nextClose(oldSocket);
    oldSocket.close();
    await oldClosed;
    expect(runtime.socketServer.sendPairingEvent("bmo-001", {
      event: "pairing_completed",
      status: "ok",
    })).toBe(false);

    activeBinding = binding;
    const reconnected = await connect(runtime.url);
    const authenticated = nextJson(reconnected);
    authenticate(reconnected);
    await expect(authenticated).resolves.toMatchObject({ event: "authenticated", status: "ok" });
    await expect.poll(() => runtime.socketServer.authorizeApplicationBinding("bmo-001")).toEqual(binding);

    reconnected.send(JSON.stringify({ event: "pairing_mode_request" }));
    await expect(nextJson(reconnected)).resolves.toEqual({ event: "pairing_completed", status: "ok" });
    expect(onPairingModeRequest).not.toHaveBeenCalled();
    await expect(runtime.socketServer.sendAdditiveEvent("bmo-001", {
      event: "device_settings",
      version: 3,
      settings: { playback_volume: 60 },
    })).resolves.toBe(true);
  });

  it("does not issue pairing code for a bound device and acknowledges pairing mode as complete", async () => {
    const onDeviceNotBound = vi.fn();
    const onPairingModeRequest = vi.fn();
    const runtime = await startRuntime({
      resolveApplicationDevice: vi.fn().mockResolvedValue({
        deviceId: "00000000-0000-4000-8000-000000000001",
        userId: "00000000-0000-4000-8000-000000000010",
        hardwareId: "bmo-001",
      }),
      authorizeApplicationDevice: vi.fn().mockResolvedValue(true),
      onDeviceNotBound,
      onPairingModeRequest,
    });
    const socket = await connect(runtime.url);
    const authenticated = nextJson(socket);
    authenticate(socket);
    await expect(authenticated).resolves.toMatchObject({ event: "authenticated", status: "ok" });
    await new Promise<void>((resolve) => setImmediate(resolve));

    socket.send(JSON.stringify({ event: "pairing_mode_request" }));
    await expect(nextJson(socket)).resolves.toEqual({ event: "pairing_completed", status: "ok" });
    expect(onDeviceNotBound).not.toHaveBeenCalled();
    expect(onPairingModeRequest).not.toHaveBeenCalled();
  });

  it("contains a rejected unbound diagnostic callback without an unhandled rejection", async () => {
    const onDeviceNotBound = vi.fn().mockRejectedValue(new Error("diagnostic sink unavailable"));
    const runtime = await startRuntime({
      resolveApplicationDevice: vi.fn().mockResolvedValue(null),
      onDeviceNotBound,
    });
    const socket = await connect(runtime.url);
    const authenticated = nextJson(socket);
    authenticate(socket);

    await expect(authenticated).resolves.toMatchObject({ event: "authenticated", status: "ok" });
    await expect.poll(() => onDeviceNotBound.mock.calls.length).toBe(1);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(socket.readyState).toBe(WebSocket.OPEN);
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
