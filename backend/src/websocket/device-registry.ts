import type WebSocket from "ws";

import type { RequestStore, VoiceRequestRecord } from "../domain/request-store.js";
import type { BackendState } from "./events.js";

interface DeviceConnection {
  socket: WebSocket;
  authenticatedAt: number;
  lastPongAt: number;
}

export interface DeviceBackendState {
  backendState: BackendState;
  activeRequest: VoiceRequestRecord | null;
}

export class DeviceRegistry {
  readonly #connections = new Map<string, DeviceConnection>();

  constructor(private readonly requestStore: RequestStore) {}

  authenticate(deviceId: string, socket: WebSocket): WebSocket | null {
    const previous = this.#connections.get(deviceId)?.socket ?? null;
    const now = Date.now();
    this.#connections.set(deviceId, { socket, authenticatedAt: now, lastPongAt: now });
    return previous === socket ? null : previous;
  }

  remove(deviceId: string, socket: WebSocket): void {
    if (this.#connections.get(deviceId)?.socket === socket) {
      this.#connections.delete(deviceId);
    }
  }

  touchPong(deviceId: string, socket: WebSocket): void {
    const connection = this.#connections.get(deviceId);
    if (connection?.socket === socket) {
      connection.lastPongAt = Date.now();
    }
  }

  getSocket(deviceId: string): WebSocket | undefined {
    return this.#connections.get(deviceId)?.socket;
  }

  isAuthenticated(deviceId: string, socket?: WebSocket): boolean {
    const active = this.#connections.get(deviceId)?.socket;
    return socket ? active === socket : active !== undefined;
  }

  getBackendState(deviceId: string): DeviceBackendState {
    const activeRequest = this.requestStore.getActiveForDevice(deviceId) ?? null;
    if (!activeRequest) {
      return { backendState: "idle", activeRequest: null };
    }
    return {
      backendState: activeRequest.status === "audio_ready" ? "audio_ready" : "thinking",
      activeRequest,
    };
  }
}
