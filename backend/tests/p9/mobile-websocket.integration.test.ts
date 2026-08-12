import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";

import { RequestStore } from "../../src/domain/request-store.js";
import {
  MobileWebSocketServer,
  type MobileSocketIdentity,
} from "../../src/p9/websocket/mobile-websocket.server.js";
import { DeviceRegistry } from "../../src/websocket/device-registry.js";
import { DeviceWebSocketServer } from "../../src/websocket/websocket.server.js";

const userId = "00000000-0000-4000-8000-000000000010";
const sessionId = "00000000-0000-4000-8000-000000000020";

interface Runtime {
  httpServer: Server;
  mobile: MobileWebSocketServer;
  device?: DeviceWebSocketServer;
  baseUrl: string;
}

const runtimes: Runtime[] = [];

async function startRuntime(options: {
  authenticate?: (accessToken: string) => Promise<MobileSocketIdentity | { kind: "expired" } | null>;
  authTimeoutMs?: number;
  heartbeatIntervalMs?: number;
  maxMissedPongs?: number;
  withDeviceServer?: boolean;
} = {}): Promise<Runtime> {
  const httpServer = createServer();
  const device = options.withDeviceServer ? new DeviceWebSocketServer({
    httpServer,
    registry: new DeviceRegistry(new RequestStore()),
    deviceId: "bmo-001",
    deviceToken: "test-device-secret",
    authTimeoutMs: 100,
    heartbeatIntervalMs: 1_000,
    maxMissedPongs: 2,
    maxMessageBytes: 8_192,
  }) : undefined;
  const mobile = new MobileWebSocketServer({
    httpServer,
    authenticate: options.authenticate ?? vi.fn().mockResolvedValue({
      userId,
      sessionId,
      expiresAt: new Date(Date.now() + 60_000),
    }),
    authTimeoutMs: options.authTimeoutMs ?? 80,
    heartbeatIntervalMs: options.heartbeatIntervalMs ?? 1_000,
    maxMissedPongs: options.maxMissedPongs ?? 2,
    maxMessageBytes: 32 * 1_024,
  });
  await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  const address = httpServer.address() as AddressInfo;
  const runtime = {
    httpServer,
    mobile,
    ...(device === undefined ? {} : { device }),
    baseUrl: `ws://127.0.0.1:${address.port}`,
  };
  runtimes.push(runtime);
  return runtime;
}

async function connect(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
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

function nextClose(socket: WebSocket): Promise<{ code: number; reason: string }> {
  return new Promise((resolve) => {
    socket.once("close", (code, reason) => resolve({ code, reason: reason.toString() }));
  });
}

async function authenticateSocket(socket: WebSocket, token = "access-secret"): Promise<Record<string, unknown>> {
  const response = nextJson(socket);
  socket.send(JSON.stringify({ event: "authenticate", accessToken: token }));
  return response;
}

afterEach(async () => {
  await Promise.all(runtimes.splice(0).map(async ({ httpServer, mobile, device }) => {
    await mobile.close();
    if (device) await device.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  }));
});

describe("mobile realtime WebSocket", () => {
  it("authenticates on the distinct /api/v1/ws path with server-owned identity", async () => {
    const authenticate = vi.fn().mockResolvedValue({
      userId,
      sessionId,
      expiresAt: new Date(Date.now() + 60_000),
    });
    const runtime = await startRuntime({ authenticate });
    const socket = await connect(`${runtime.baseUrl}/api/v1/ws`);
    const authenticated = nextJson(socket);

    socket.send(JSON.stringify({ event: "authenticate", accessToken: "access-secret" }));

    await expect(authenticated).resolves.toEqual({ event: "authenticated", status: "ok", userId });
    expect(authenticate).toHaveBeenCalledWith("access-secret");
    socket.close();
  });

  it("keeps the existing device /ws path independent", async () => {
    const runtime = await startRuntime({ withDeviceServer: true });
    const deviceSocket = await connect(`${runtime.baseUrl}/ws`);
    const deviceResponse = nextJson(deviceSocket);
    deviceSocket.send(JSON.stringify({
      event: "authenticate",
      device_id: "bmo-001",
      device_token: "test-device-secret",
    }));
    await expect(deviceResponse).resolves.toMatchObject({
      event: "authenticated",
      device_id: "bmo-001",
    });

    const mobileSocket = await connect(`${runtime.baseUrl}/api/v1/ws`);
    await expect(authenticateSocket(mobileSocket)).resolves.toEqual({
      event: "authenticated",
      status: "ok",
      userId,
    });
    deviceSocket.close();
    mobileSocket.close();
  });

  it("rejects unknown WebSocket paths instead of leaving an upgrade pending", async () => {
    const runtime = await startRuntime({ withDeviceServer: true });
    const statusCode = await new Promise<number>((resolve, reject) => {
      const socket = new WebSocket(`${runtime.baseUrl}/api/v1/not-ws`);
      socket.once("unexpected-response", (_request, response) => resolve(response.statusCode ?? 0));
      socket.once("error", reject);
    });
    expect(statusCode).toBe(404);
  });

  it("requires authentication within the configured timeout", async () => {
    const runtime = await startRuntime({ authTimeoutMs: 25 });
    const socket = await connect(`${runtime.baseUrl}/api/v1/ws`);
    await expect(nextClose(socket)).resolves.toEqual({
      code: 4408,
      reason: "AUTHENTICATION_TIMEOUT",
    });
  });

  it("rejects access tokens in the URL query", async () => {
    const runtime = await startRuntime();
    const statusCode = await new Promise<number>((resolve, reject) => {
      const socket = new WebSocket(`${runtime.baseUrl}/api/v1/ws?accessToken=leaked-secret`);
      socket.once("unexpected-response", (_request, response) => resolve(response.statusCode ?? 0));
      socket.once("error", reject);
    });
    expect(statusCode).toBe(400);
  });

  it.each([
    ["malformed JSON", "{"],
    ["non-auth event", JSON.stringify({ event: "chat_thinking" })],
    ["client-supplied identity", JSON.stringify({ event: "authenticate", accessToken: "secret", userId })],
  ])("closes unauthenticated text for %s", async (_label, payload) => {
    const runtime = await startRuntime();
    const socket = await connect(`${runtime.baseUrl}/api/v1/ws`);
    const closed = nextClose(socket);
    socket.send(payload);
    await expect(closed).resolves.toEqual({ code: 4401, reason: "AUTHENTICATION_REQUIRED" });
  });

  it("rejects binary authentication messages", async () => {
    const runtime = await startRuntime();
    const socket = await connect(`${runtime.baseUrl}/api/v1/ws`);
    const closed = nextClose(socket);
    socket.send(Buffer.from("secret"));
    await expect(closed).resolves.toEqual({ code: 4401, reason: "AUTHENTICATION_REQUIRED" });
  });

  it("bounds inbound JSON messages at 32 KiB", async () => {
    const runtime = await startRuntime();
    const socket = await connect(`${runtime.baseUrl}/api/v1/ws`);
    const closed = nextClose(socket);
    socket.send(JSON.stringify({ event: "authenticate", accessToken: "x".repeat(33 * 1_024) }));
    await expect(closed).resolves.toMatchObject({ code: 1009 });
  });

  it("uses INVALID_SESSION for invalid or revoked sessions without reflecting the token", async () => {
    const runtime = await startRuntime({ authenticate: vi.fn().mockResolvedValue(null) });
    const socket = await connect(`${runtime.baseUrl}/api/v1/ws`);
    const closed = nextClose(socket);
    socket.send(JSON.stringify({ event: "authenticate", accessToken: "never-reflect-this" }));
    const result = await closed;
    expect(result).toEqual({ code: 4403, reason: "INVALID_SESSION" });
    expect(JSON.stringify(result)).not.toContain("never-reflect-this");
  });

  it("uses ACCESS_TOKEN_EXPIRED when authentication resolves an expired token", async () => {
    const runtime = await startRuntime({ authenticate: vi.fn().mockResolvedValue({
      userId,
      sessionId,
      expiresAt: new Date(Date.now() - 1),
    }) });
    const socket = await connect(`${runtime.baseUrl}/api/v1/ws`);
    const closed = nextClose(socket);
    socket.send(JSON.stringify({ event: "authenticate", accessToken: "expired" }));
    await expect(closed).resolves.toEqual({ code: 4410, reason: "ACCESS_TOKEN_EXPIRED" });
  });

  it("uses ACCESS_TOKEN_EXPIRED when the verifier reports JWT expiry", async () => {
    const runtime = await startRuntime({
      authenticate: vi.fn().mockResolvedValue({ kind: "expired" }),
    });
    const socket = await connect(`${runtime.baseUrl}/api/v1/ws`);
    const closed = nextClose(socket);
    socket.send(JSON.stringify({ event: "authenticate", accessToken: "expired" }));
    await expect(closed).resolves.toEqual({ code: 4410, reason: "ACCESS_TOKEN_EXPIRED" });
  });

  it("closes an authenticated socket when its access token expires", async () => {
    const runtime = await startRuntime({ authenticate: vi.fn().mockResolvedValue({
      userId,
      sessionId,
      expiresAt: new Date(Date.now() + 35),
    }) });
    const socket = await connect(`${runtime.baseUrl}/api/v1/ws`);
    await authenticateSocket(socket);
    await expect(nextClose(socket)).resolves.toEqual({ code: 4410, reason: "ACCESS_TOKEN_EXPIRED" });
  });

  it("fans out a validated event only to sockets for the authenticated user", async () => {
    const otherUserId = "00000000-0000-4000-8000-000000000011";
    const runtime = await startRuntime({ authenticate: vi.fn(async (token) => ({
      userId: token === "other" ? otherUserId : userId,
      sessionId,
      expiresAt: new Date(Date.now() + 60_000),
    })) });
    const first = await connect(`${runtime.baseUrl}/api/v1/ws`);
    const second = await connect(`${runtime.baseUrl}/api/v1/ws`);
    const other = await connect(`${runtime.baseUrl}/api/v1/ws`);
    await Promise.all([authenticateSocket(first), authenticateSocket(second), authenticateSocket(other, "other")]);
    const firstEvent = nextJson(first);
    const secondEvent = nextJson(second);

    expect(runtime.mobile.sendToUser(userId, {
      event: "chat_thinking",
      sessionId,
      messageId: "00000000-0000-4000-8000-000000000030",
    })).toBe(2);
    await expect(firstEvent).resolves.toMatchObject({ event: "chat_thinking", sessionId });
    await expect(secondEvent).resolves.toMatchObject({ event: "chat_thinking", sessionId });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(other.readyState).toBe(WebSocket.OPEN);
    expect(() => runtime.mobile.sendToUser(userId, {
      event: "notification",
      id: "not-a-uuid",
      type: "GENERIC",
      title: "BMO",
      body: "hello",
      createdAt: new Date().toISOString(),
    })).toThrow();
    first.close();
    second.close();
    other.close();
  });

  it("terminates authenticated sockets after missed pongs", async () => {
    const runtime = await startRuntime({ heartbeatIntervalMs: 20, maxMissedPongs: 1 });
    const socket = await connect(`${runtime.baseUrl}/api/v1/ws`);
    await authenticateSocket(socket);
    socket.pong = vi.fn();
    await expect(nextClose(socket)).resolves.toMatchObject({ code: 1006 });
    expect(runtime.mobile.getHeartbeatStats().pingCount).toBeGreaterThan(0);
    expect(runtime.mobile.getHeartbeatStats().terminatedCount).toBe(1);
  });
});
