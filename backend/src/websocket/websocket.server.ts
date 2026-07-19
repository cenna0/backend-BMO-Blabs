import type { Server } from "node:http";
import { setImmediate } from "node:timers";
import WebSocket, { WebSocketServer } from "ws";

import type { VoiceRequestRecord } from "../domain/request-store.js";
import { deviceTokenMatches } from "../utils/device-auth.js";
import type { DeviceRegistry } from "./device-registry.js";
import { inboundEventSchema, type InboundEvent, type OutboundEvent } from "./events.js";

function rawDataToBuffer(data: WebSocket.RawData): Buffer {
  if (Array.isArray(data)) return Buffer.concat(data);
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
}

interface SocketState {
  authenticated: boolean;
  deviceId: string | null;
  awaitingPong: boolean;
  missedPongs: number;
}

export interface DeviceWebSocketServerOptions {
  httpServer: Server;
  registry: DeviceRegistry;
  deviceId: string;
  deviceToken: string;
  authTimeoutMs: number;
  heartbeatIntervalMs: number;
  maxMissedPongs: number;
  maxMessageBytes: number;
  onPlaybackDone?: (deviceId: string, requestId: string) => void | Promise<void>;
  onPlaybackFailed?: (
    deviceId: string,
    requestId: string,
    reason: "DOWNLOAD_FAILED" | "DECODE_FAILED" | "PLAYBACK_FAILED",
  ) => void | Promise<void>;
}

export class DeviceWebSocketServer {
  readonly #server: WebSocketServer;
  readonly #states = new WeakMap<WebSocket, SocketState>();
  readonly #heartbeat: NodeJS.Timeout;
  readonly #heartbeatStats = {
    pingCount: 0,
    pongCount: 0,
    terminatedCount: 0,
  };

  constructor(private readonly options: DeviceWebSocketServerOptions) {
    this.#server = new WebSocketServer({
      server: options.httpServer,
      path: "/ws",
      maxPayload: options.maxMessageBytes,
    });
    this.#server.on("connection", (socket) => this.#handleConnection(socket));
    this.#heartbeat = setInterval(() => this.#heartbeatTick(), options.heartbeatIntervalMs);
    this.#heartbeat.unref();
  }

  isAuthenticated(deviceId: string, socket?: WebSocket): boolean {
    return this.options.registry.isAuthenticated(deviceId, socket);
  }

  sendThinking(deviceId: string, requestId: string): boolean {
    return this.#sendToDevice(deviceId, {
      event: "display_status",
      request_id: requestId,
      status: "thinking",
    });
  }

  sendAudioReady(record: VoiceRequestRecord): boolean {
    if (!record.audioUrl || !record.expiresAt) return false;
    return this.#sendToDevice(record.deviceId, this.#audioReadyEvent(record));
  }

  sendRequestFailed(
    deviceId: string,
    requestId: string,
    code: Extract<OutboundEvent, { event: "request_failed" }>["code"],
  ): boolean {
    return this.#sendToDevice(deviceId, {
      event: "request_failed",
      request_id: requestId,
      code,
      recoverable: true,
    });
  }

  getHeartbeatStats(): { pingCount: number; pongCount: number; terminatedCount: number } {
    return { ...this.#heartbeatStats };
  }

  async close(): Promise<void> {
    clearInterval(this.#heartbeat);
    for (const client of this.#server.clients) {
      client.terminate();
    }
    await new Promise<void>((resolve, reject) => {
      this.#server.close((error) => (error ? reject(error) : resolve()));
    });
  }

  #handleConnection(socket: WebSocket): void {
    const state: SocketState = {
      authenticated: false,
      deviceId: null,
      awaitingPong: false,
      missedPongs: 0,
    };
    this.#states.set(socket, state);

    socket.on("error", () => {
      // Protocol/payload errors are isolated to this connection by ws.
    });

    const authTimer = setTimeout(() => {
      if (!state.authenticated && socket.readyState === WebSocket.OPEN) {
        socket.close(4008, "AUTHENTICATION_TIMEOUT");
      }
    }, this.options.authTimeoutMs);
    authTimer.unref();

    socket.on("pong", () => {
      this.#heartbeatStats.pongCount += 1;
      state.awaitingPong = false;
      state.missedPongs = 0;
      if (state.deviceId) this.options.registry.touchPong(state.deviceId, socket);
    });

    socket.on("message", (data, isBinary) => {
      const message = rawDataToBuffer(data);
      if (isBinary || message.byteLength > this.options.maxMessageBytes) {
        socket.close(state.authenticated ? 1008 : 4001, "INVALID_MESSAGE");
        return;
      }
      this.#handleMessage(socket, state, message.toString("utf8"), authTimer);
    });

    socket.on("close", () => {
      clearTimeout(authTimer);
      if (state.deviceId) this.options.registry.remove(state.deviceId, socket);
    });
  }

  #handleMessage(
    socket: WebSocket,
    state: SocketState,
    raw: string,
    authTimer: NodeJS.Timeout,
  ): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      socket.close(state.authenticated ? 1008 : 4001, "INVALID_MESSAGE");
      return;
    }

    const result = inboundEventSchema.safeParse(parsed);
    if (!result.success) {
      socket.close(state.authenticated ? 1008 : 4001, "INVALID_MESSAGE");
      return;
    }

    if (!state.authenticated) {
      if (result.data.event !== "authenticate") {
        socket.close(4001, "AUTHENTICATION_REQUIRED");
        return;
      }
      this.#authenticate(socket, state, result.data, authTimer);
      return;
    }

    void this.#handleAuthenticatedEvent(state, result.data);
  }

  #authenticate(
    socket: WebSocket,
    state: SocketState,
    event: Extract<InboundEvent, { event: "authenticate" }>,
    authTimer: NodeJS.Timeout,
  ): void {
    if (
      event.device_id !== this.options.deviceId ||
      !deviceTokenMatches(event.device_token, this.options.deviceToken)
    ) {
      this.#send(socket, {
        event: "authentication_failed",
        error: "INVALID_DEVICE_CREDENTIALS",
      });
      socket.close(4003, "INVALID_CREDENTIALS");
      return;
    }

    clearTimeout(authTimer);
    state.authenticated = true;
    state.deviceId = event.device_id;
    const previous = this.options.registry.authenticate(event.device_id, socket);
    if (previous && previous.readyState === WebSocket.OPEN) {
      this.#send(previous, {
        event: "connection_replaced",
        reason: "NEW_CONNECTION_ESTABLISHED",
      });
      previous.close(1000, "CONNECTION_REPLACED");
    }

    const backend = this.options.registry.getBackendState(event.device_id);
    this.#send(socket, {
      event: "authenticated",
      status: "ok",
      device_id: event.device_id,
      backend_state: backend.backendState,
      active_request_id: backend.activeRequest?.requestId ?? null,
    });

    if (backend.activeRequest) {
      setImmediate(() => {
        if (backend.backendState === "thinking") {
          this.sendThinking(event.device_id, backend.activeRequest!.requestId);
        } else {
          this.sendAudioReady(backend.activeRequest!);
        }
      });
    }
  }

  async #handleAuthenticatedEvent(state: SocketState, event: InboundEvent): Promise<void> {
    if (!state.deviceId || event.event === "authenticate") return;
    if (event.event === "audio_playback_done") {
      await this.options.onPlaybackDone?.(state.deviceId, event.request_id);
    } else {
      await this.options.onPlaybackFailed?.(state.deviceId, event.request_id, event.reason);
    }
  }

  #audioReadyEvent(record: VoiceRequestRecord): OutboundEvent {
    return {
      event: "audio_ready",
      request_id: record.requestId,
      audio_url: record.audioUrl!,
      format: "mp3",
      expires_in_seconds: Math.max(0, Math.ceil((record.expiresAt! - Date.now()) / 1_000)),
    };
  }

  #sendToDevice(deviceId: string, event: OutboundEvent): boolean {
    const socket = this.options.registry.getSocket(deviceId);
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    this.#send(socket, event);
    return true;
  }

  #send(socket: WebSocket, event: OutboundEvent): void {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(event));
    }
  }

  #heartbeatTick(): void {
    for (const socket of this.#server.clients) {
      const state = this.#states.get(socket);
      if (!state?.authenticated || socket.readyState !== WebSocket.OPEN) continue;

      if (state.awaitingPong) {
        state.missedPongs += 1;
        if (state.missedPongs >= this.options.maxMissedPongs) {
          this.#heartbeatStats.terminatedCount += 1;
          socket.terminate();
          continue;
        }
      }
      state.awaitingPong = true;
      this.#heartbeatStats.pingCount += 1;
      socket.ping();
    }
  }
}
