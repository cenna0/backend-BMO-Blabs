import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import WebSocket, { WebSocketServer } from "ws";

import {
  mobileAuthenticateEventSchema,
  mobileOutboundEventSchema,
  type MobileOutboundEvent,
} from "./mobile-events.js";
import { claimWebSocketUpgrade, rejectUnclaimedWebSocketUpgrade } from "../../websocket/upgrade-router.js";

const MOBILE_PATH = "/api/v1/ws";
const MAX_TIMER_DELAY_MS = 2_147_483_647;

export interface MobileSocketIdentity {
  userId: string;
  sessionId: string;
  expiresAt: Date;
}

interface MobileSocketState {
  phase: "pending" | "authenticating" | "authenticated";
  identity: MobileSocketIdentity | null;
  awaitingPong: boolean;
  missedPongs: number;
  authTimer: NodeJS.Timeout;
  expiryTimer?: NodeJS.Timeout;
}

export interface MobileWebSocketServerOptions {
  httpServer: Server;
  authenticate(accessToken: string): Promise<MobileSocketIdentity | { kind: "expired" } | null>;
  authTimeoutMs?: number;
  heartbeatIntervalMs?: number;
  maxMissedPongs?: number;
  maxMessageBytes?: number;
}

function rawDataToBuffer(data: WebSocket.RawData): Buffer {
  if (Array.isArray(data)) return Buffer.concat(data);
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
}

export class MobileWebSocketServer {
  readonly #server: WebSocketServer;
  readonly #states = new WeakMap<WebSocket, MobileSocketState>();
  readonly #socketsByUser = new Map<string, Set<WebSocket>>();
  readonly #heartbeat: NodeJS.Timeout;
  readonly #upgradeHandler: (request: IncomingMessage, socket: Duplex, head: Buffer) => void;
  readonly #authTimeoutMs: number;
  readonly #maxMissedPongs: number;
  readonly #maxMessageBytes: number;
  readonly #heartbeatStats = { pingCount: 0, pongCount: 0, terminatedCount: 0 };
  #closed = false;

  constructor(private readonly options: MobileWebSocketServerOptions) {
    this.#authTimeoutMs = options.authTimeoutMs ?? 5_000;
    this.#maxMissedPongs = options.maxMissedPongs ?? 2;
    this.#maxMessageBytes = options.maxMessageBytes ?? 32 * 1_024;
    this.#server = new WebSocketServer({ noServer: true, maxPayload: this.#maxMessageBytes });
    this.#server.on("connection", (socket) => this.#handleConnection(socket));
    this.#upgradeHandler = (request, socket, head) => this.#handleUpgrade(request, socket, head);
    options.httpServer.on("upgrade", this.#upgradeHandler);
    this.#heartbeat = setInterval(
      () => this.#heartbeatTick(),
      options.heartbeatIntervalMs ?? 60_000,
    );
    this.#heartbeat.unref();
  }

  sendToUser(userId: string, event: MobileOutboundEvent): number {
    const payload = JSON.stringify(mobileOutboundEventSchema.parse(event));
    if (Buffer.byteLength(payload, "utf8") > this.#maxMessageBytes) {
      throw new Error("mobile outbound event exceeds message limit");
    }
    let sent = 0;
    for (const socket of this.#socketsByUser.get(userId) ?? []) {
      if (socket.readyState !== WebSocket.OPEN) continue;
      socket.send(payload);
      sent += 1;
    }
    return sent;
  }

  getHeartbeatStats(): { pingCount: number; pongCount: number; terminatedCount: number } {
    return { ...this.#heartbeatStats };
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    clearInterval(this.#heartbeat);
    this.options.httpServer.off("upgrade", this.#upgradeHandler);
    for (const client of this.#server.clients) client.terminate();
    await new Promise<void>((resolve, reject) => {
      this.#server.close((error) => (error ? reject(error) : resolve()));
    });
  }

  #handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
    const requestTarget = request.url ?? "";
    let parsed: URL;
    try {
      parsed = new URL(requestTarget, "http://localhost");
    } catch {
      rejectUnclaimedWebSocketUpgrade(socket);
      return;
    }
    if (parsed.pathname !== MOBILE_PATH) {
      rejectUnclaimedWebSocketUpgrade(socket);
      return;
    }
    claimWebSocketUpgrade(socket);
    if (parsed.search !== "") {
      socket.write("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    this.#server.handleUpgrade(request, socket, head, (webSocket) => {
      this.#server.emit("connection", webSocket, request);
    });
  }

  #handleConnection(socket: WebSocket): void {
    const authTimer = setTimeout(() => {
      const state = this.#states.get(socket);
      if (state?.phase !== "authenticated" && socket.readyState === WebSocket.OPEN) {
        socket.close(4408, "AUTHENTICATION_TIMEOUT");
      }
    }, this.#authTimeoutMs);
    authTimer.unref();
    const state: MobileSocketState = {
      phase: "pending",
      identity: null,
      awaitingPong: false,
      missedPongs: 0,
      authTimer,
    };
    this.#states.set(socket, state);

    socket.on("error", () => {
      // Payload and protocol errors remain isolated to this connection.
    });
    socket.on("pong", () => {
      this.#heartbeatStats.pongCount += 1;
      state.awaitingPong = false;
      state.missedPongs = 0;
    });
    socket.on("message", (data, isBinary) => {
      const message = rawDataToBuffer(data);
      if (isBinary || message.byteLength > this.#maxMessageBytes) {
        socket.close(state.phase === "authenticated" ? 1008 : 4401, "AUTHENTICATION_REQUIRED");
        return;
      }
      void this.#handleMessage(socket, state, message.toString("utf8"));
    });
    socket.on("close", () => this.#removeSocket(socket, state));
  }

  async #handleMessage(socket: WebSocket, state: MobileSocketState, raw: string): Promise<void> {
    if (state.phase !== "pending") {
      socket.close(state.phase === "authenticated" ? 1008 : 4403, "INVALID_SESSION");
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      socket.close(4401, "AUTHENTICATION_REQUIRED");
      return;
    }
    const result = mobileAuthenticateEventSchema.safeParse(parsed);
    if (!result.success) {
      socket.close(4401, "AUTHENTICATION_REQUIRED");
      return;
    }
    state.phase = "authenticating";
    let identity: MobileSocketIdentity | { kind: "expired" } | null = null;
    try {
      identity = await this.options.authenticate(result.data.accessToken);
    } catch {
      // Authentication deliberately has one indistinguishable failure result.
    }
    if (socket.readyState !== WebSocket.OPEN || state.phase !== "authenticating") return;
    if (identity && !("expiresAt" in identity)) {
      socket.close(4410, "ACCESS_TOKEN_EXPIRED");
      return;
    }
    if (!identity || !Number.isFinite(identity.expiresAt.getTime())) {
      socket.close(4403, "INVALID_SESSION");
      return;
    }
    if (identity.expiresAt.getTime() <= Date.now()) {
      socket.close(4410, "ACCESS_TOKEN_EXPIRED");
      return;
    }

    clearTimeout(state.authTimer);
    state.phase = "authenticated";
    state.identity = identity;
    const userSockets = this.#socketsByUser.get(identity.userId) ?? new Set<WebSocket>();
    userSockets.add(socket);
    this.#socketsByUser.set(identity.userId, userSockets);
    this.#scheduleExpiry(socket, state);
    socket.send(JSON.stringify({ event: "authenticated", status: "ok", userId: identity.userId }));
  }

  #scheduleExpiry(socket: WebSocket, state: MobileSocketState): void {
    const expiresAt = state.identity?.expiresAt.getTime();
    if (expiresAt === undefined) return;
    const remaining = expiresAt - Date.now();
    if (remaining <= 0) {
      if (socket.readyState === WebSocket.OPEN) socket.close(4410, "ACCESS_TOKEN_EXPIRED");
      return;
    }
    state.expiryTimer = setTimeout(
      () => this.#scheduleExpiry(socket, state),
      Math.min(remaining, MAX_TIMER_DELAY_MS),
    );
    state.expiryTimer.unref();
  }

  #removeSocket(socket: WebSocket, state: MobileSocketState): void {
    clearTimeout(state.authTimer);
    if (state.expiryTimer) clearTimeout(state.expiryTimer);
    const userId = state.identity?.userId;
    if (!userId) return;
    const sockets = this.#socketsByUser.get(userId);
    sockets?.delete(socket);
    if (sockets?.size === 0) this.#socketsByUser.delete(userId);
  }

  #heartbeatTick(): void {
    for (const socket of this.#server.clients) {
      if (socket.readyState !== WebSocket.OPEN) continue;
      const state = this.#states.get(socket);
      if (!state || state.phase !== "authenticated") continue;
      if (state.awaitingPong) {
        state.missedPongs += 1;
        if (state.missedPongs >= this.#maxMissedPongs) {
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
