import type WebSocket from "ws";

import type { RequestStore, VoiceRequestRecord } from "../domain/request-store.js";
import type { BackendState } from "./events.js";
import type { ApplicationDeviceBinding } from "../p9/services/device-binding.service.js";

interface DeviceConnection {
  socket: WebSocket;
  authenticatedAt: number;
  lastPongAt: number;
  applicationBinding: ApplicationDeviceBinding | null;
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
    this.#connections.set(deviceId, {
      socket,
      authenticatedAt: now,
      lastPongAt: now,
      applicationBinding: null,
    });
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

  setApplicationBinding(
    deviceId: string,
    socket: WebSocket,
    binding: ApplicationDeviceBinding,
  ): boolean {
    const connection = this.#connections.get(deviceId);
    if (connection?.socket !== socket) return false;
    connection.applicationBinding = binding;
    return true;
  }

  async authorizeApplicationBinding(
    deviceId: string,
    authorize: (binding: ApplicationDeviceBinding) => Promise<boolean>,
  ): Promise<ApplicationDeviceBinding | null> {
    const connection = this.#connections.get(deviceId);
    const binding = connection?.applicationBinding;
    if (!connection || !binding) return null;

    let active = false;
    try {
      active = await authorize(binding);
    } catch {
      active = false;
    }

    const current = this.#connections.get(deviceId);
    if (current !== connection || current.applicationBinding !== binding) return null;
    if (!active) {
      current.applicationBinding = null;
      return null;
    }
    return binding;
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
