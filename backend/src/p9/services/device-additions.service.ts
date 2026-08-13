import type { PrismaClient } from "../../generated/prisma/client.js";
import { withP9Transaction } from "../db/client.js";
import { P9Repositories } from "../db/repositories.js";
import { P9Error } from "../errors.js";
import { decryptWifiPassword, encryptWifiPassword } from "../device-additions.crypto.js";
import { deviceLogSchema, deviceTelemetrySchema, wifiPutSchema, type WifiPutInput } from "../device-additions.validation.js";
import type { InboundEvent, OutboundEvent } from "../../websocket/events.js";
import { isUuid } from "../validation.js";

const LOG_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;
const NON_TERMINAL_WIFI = ["PENDING", "DELIVERED", "APPLYING"] as const;
const SECRET_PATTERN = /(password|passphrase|token|secret|credential|authorization|cookie|api[_-]?key)\s*[:=]\s*[^\s,;]+/giu;
const SAFE_LOG_METADATA = new Set(["firmware_version", "component", "retry_count", "transport"]);
const LOG_WINDOW_MS = 60_000;
const LOG_LIMIT_PER_DEVICE = 120;

export interface DeviceAdditionEvents {
  sendToDevice(deviceId: string, event: OutboundEvent): boolean | Promise<boolean>;
}

export interface DeviceAdditionsOptions {
  client: PrismaClient;
  repositories: P9Repositories;
  encryptionKey: Buffer;
  deviceEvents: DeviceAdditionEvents;
}

function redactedMessage(value: string): string {
  return value.replace(SECRET_PATTERN, (_match, prefix: string) => `${prefix}=[REDACTED]`).slice(0, 1_000);
}

function safeMetadata(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const safe: Record<string, string | number | boolean> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!SAFE_LOG_METADATA.has(key)) continue;
    if (typeof raw === "string" && raw.length <= 128) safe[key] = raw;
    if (typeof raw === "number" && Number.isFinite(raw)) safe[key] = raw;
    if (typeof raw === "boolean") safe[key] = raw;
  }
  return Object.keys(safe).length > 0 ? JSON.stringify(safe) : null;
}

function asDate(value: string | null | undefined, fallback: Date): Date {
  if (!value) return fallback;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

export class DeviceAdditionsService {
  readonly #logWindows = new Map<string, { startedAt: number; count: number }>();
  constructor(private readonly options: DeviceAdditionsOptions) {}

  setDeviceEventSender(sender: DeviceAdditionEvents): void {
    this.options.deviceEvents = sender;
  }

  publicWifi(configuration: any): Record<string, unknown> {
    return {
      configurationId: configuration.id,
      ssid: configuration.ssid,
      security: configuration.security,
      hasPassword: configuration.security === "WPA_PSK" && Boolean(configuration.secretCiphertext),
      status: configuration.status,
      updatedAt: configuration.updatedAt.toISOString(),
    };
  }

  async getWifi(userId: string, deviceId: string): Promise<Record<string, unknown> | null> {
    const device = await this.#ownedDevice(userId, deviceId);
    const configuration = await this.options.repositories.deviceWifiConfiguration.findFirst({ where: { deviceId: device.id }, orderBy: [{ version: "desc" }] });
    return configuration ? this.publicWifi(configuration) : null;
  }

  async sendCurrentState(binding: { deviceId: string; userId: string }): Promise<void> {
    await this.#ownedDevice(binding.userId, binding.deviceId);
    const configuration: any = await this.options.repositories.deviceWifiConfiguration.findFirst({
      where: { deviceId: binding.deviceId, status: { in: [...NON_TERMINAL_WIFI] } },
      orderBy: [{ version: "desc" }],
    });
    if (configuration) await this.#sendWifi(binding.deviceId, configuration);
    const settings: any = await this.options.repositories.deviceSettings.findUnique({ where: { deviceId: binding.deviceId } });
    if (settings && settings.appliedVersion !== settings.version) {
      await this.options.deviceEvents.sendToDevice(binding.deviceId, {
        event: "device_settings",
        version: settings.version,
        settings: { playback_volume: settings.playbackVolume },
      });
      await this.options.repositories.deviceSettings.update({ where: { deviceId: binding.deviceId }, data: { deliveredAt: await this.options.repositories.databaseNow() } });
    }
  }

  async syncSettings(userId: string, deviceId: string): Promise<void> {
    await this.sendCurrentState({ userId, deviceId });
  }

  async sendDeviceEvent(deviceId: string, event: OutboundEvent): Promise<boolean> {
    return Boolean(await this.options.deviceEvents.sendToDevice(deviceId, event));
  }

  async putWifi(userId: string, deviceId: string, input: unknown, requestId?: string): Promise<Record<string, unknown>> {
    if (!isUuid(deviceId)) throw new P9Error("OWNERSHIP_DENIED", 404, "Device not found");
    const parsed = wifiPutSchema.parse(input);
    return withP9Transaction(this.options.client, async (transaction) => {
      const repositories = new P9Repositories(transaction);
      const device = await this.#ownedDevice(userId, deviceId, repositories);
      await repositories.lockUser(userId);
      const current: any = await repositories.deviceWifiConfiguration.findFirst({ where: { deviceId }, orderBy: [{ version: "desc" }] });
      const version = (current?.version ?? 0) + 1;
      await repositories.deviceWifiConfiguration.updateMany({ where: { deviceId, status: { in: [...NON_TERMINAL_WIFI] } }, data: { status: "SUPERSEDED", supersededAt: await repositories.databaseNow(), errorCode: "SUPERSEDED_BY_NEWER_CONFIGURATION" } });
      const secret = parsed.password === undefined ? null : encryptWifiPassword(parsed.password, this.options.encryptionKey);
      const configuration: any = await repositories.deviceWifiConfiguration.create({ data: {
        deviceId: device.id, version, ssid: parsed.ssid,
        security: parsed.password === undefined ? "OPEN" : "WPA_PSK",
        secretCiphertext: secret?.ciphertext ?? null,
        secretNonce: secret?.nonce ?? null,
        secretTag: secret?.tag ?? null,
        secretKeyVersion: secret?.keyVersion ?? null,
        status: "PENDING",
      } });
      await repositories.auditEvent.create({ data: { eventType: "DEVICE_WIFI_CONFIGURATION_CREATED", outcome: "success", actorType: "user", resourceType: "device_wifi_configuration", resourceId: configuration.id, userId, deviceId, ...(requestId ? { requestId } : {}), metadata: {} } });
      await this.#sendWifi(deviceId, configuration);
      return this.publicWifi(configuration);
    });
  }

  async deleteWifi(userId: string, deviceId: string, requestId?: string): Promise<void> {
    const device = await this.#ownedDevice(userId, deviceId);
    await this.options.repositories.deviceWifiConfiguration.deleteMany({ where: { deviceId: device.id } });
    await this.options.repositories.auditEvent.create({ data: { eventType: "DEVICE_WIFI_CONFIGURATION_DELETED", outcome: "success", actorType: "user", resourceType: "device_wifi_configuration", userId, deviceId, ...(requestId ? { requestId } : {}), metadata: {} } });
  }

  async ingestLog(input: unknown, binding?: { deviceId: string; userId: string }): Promise<void> {
    const deviceId = binding?.deviceId ?? (input as any).deviceId;
    const parsed = deviceLogSchema.parse(binding ? (() => { const { event: _event, ...deviceEvent } = input as any; return deviceEvent; })() : (() => { const { deviceId: _deviceId, ...event } = input as any; return event; })());
    const device = await this.#ownedDevice(binding?.userId ?? "", deviceId);
    const nowMs = Date.now();
    const window = this.#logWindows.get(device.id);
    if (!window || nowMs - window.startedAt >= LOG_WINDOW_MS) this.#logWindows.set(device.id, { startedAt: nowMs, count: 1 });
    else if (window.count >= LOG_LIMIT_PER_DEVICE) throw new P9Error("RATE_LIMITED", 429, "Device log rate limit exceeded");
    else window.count += 1;
    const now = await this.options.repositories.databaseNow();
    await this.options.repositories.deviceLog.create({ data: {
      deviceId: device.id, level: parsed.level, code: parsed.code,
      message: redactedMessage(parsed.message), metadata: safeMetadata(parsed.metadata),
      observedAt: asDate(parsed.timestamp, now), expiresAt: new Date(now.getTime() + LOG_RETENTION_MS),
    } });
  }

  async listLogs(userId: string, deviceId: string, limit = 50): Promise<unknown[]> {
    const device = await this.#ownedDevice(userId, deviceId);
    return this.options.repositories.deviceLog.findMany({ where: { deviceId: device.id, expiresAt: { gt: await this.options.repositories.databaseNow() } }, orderBy: [{ observedAt: "desc" }, { id: "desc" }], take: Math.min(limit, 100), select: { id: true, level: true, code: true, message: true, metadata: true, observedAt: true } });
  }

  async ingestTelemetry(input: unknown, binding?: { deviceId: string; userId: string }): Promise<unknown> {
    const deviceId = binding?.deviceId ?? (input as any).deviceId;
    const parsed = deviceTelemetrySchema.parse(binding ? (() => { const { event: _event, ...deviceEvent } = input as any; return deviceEvent; })() : (() => { const { deviceId: _deviceId, ...event } = input as any; return event; })());
    const device = await this.#ownedDevice(binding?.userId ?? "", deviceId);
    const observedAt = await this.options.repositories.databaseNow();
    const batterySupported = parsed.battery_percent !== null && parsed.battery_percent !== undefined;
    const batteryPercent = batterySupported ? parsed.battery_percent! : null;
    return this.options.repositories.deviceTelemetryCurrent.upsert({
      where: { deviceId: device.id },
      create: { device: { connect: { id: device.id } }, wifiConnected: parsed.wifi_connected, wifiRssi: parsed.wifi_rssi ?? null, batterySupported, batteryPercent, firmwareVersion: parsed.firmware_version ?? null, observedAt },
      update: { wifiConnected: parsed.wifi_connected, wifiRssi: parsed.wifi_rssi ?? null, batterySupported, batteryPercent, firmwareVersion: parsed.firmware_version ?? null, observedAt },
    });
  }

  async getTelemetry(userId: string, deviceId: string): Promise<unknown> {
    const device = await this.#ownedDevice(userId, deviceId);
    return this.options.repositories.deviceTelemetryCurrent.findUnique({ where: { deviceId: device.id } });
  }

  async applySettings(binding: { deviceId: string; userId: string }, version: number): Promise<void> {
    await this.#ownedDevice(binding.userId, binding.deviceId);
    await this.options.repositories.deviceSettings.updateMany({ where: { deviceId: binding.deviceId, version }, data: { appliedVersion: version, appliedAt: await this.options.repositories.databaseNow(), lastErrorCode: null } });
  }

  async handleDeviceEvent(binding: { deviceId: string; userId: string }, event: Exclude<InboundEvent, { event: "authenticate" | "audio_playback_done" | "audio_playback_failed" }>): Promise<void> {
    if (event.event === "device_log") return this.ingestLog(event, binding);
    if (event.event === "device_telemetry") { await this.ingestTelemetry(event, binding); return; }
    if (event.event === "device_settings_applied") { await this.applySettings(binding, event.version); return; }
    if (event.event === "wifi_configuration_received") { await this.#wifiReceived(binding, event.configuration_id); return; }
    if (event.event === "wifi_configuration_result") { await this.#wifiResult(binding, event); }
  }

  async #wifiReceived(binding: { deviceId: string; userId: string }, configurationId: string): Promise<void> {
    const row: any = await this.options.repositories.deviceWifiConfiguration.findFirst({ where: { id: configurationId, deviceId: binding.deviceId } });
    if (!row || !NON_TERMINAL_WIFI.includes(row.status)) return;
    await this.options.repositories.deviceWifiConfiguration.update({ where: { id: row.id }, data: { status: "DELIVERED", deliveredAt: await this.options.repositories.databaseNow() } });
  }

  async #wifiResult(binding: { deviceId: string; userId: string }, event: Extract<InboundEvent, { event: "wifi_configuration_result" }>): Promise<void> {
    const row: any = await this.options.repositories.deviceWifiConfiguration.findFirst({ where: { id: event.configuration_id, deviceId: binding.deviceId } });
    if (!row || ["CONNECTED", "ROLLED_BACK", "FAILED", "SUPERSEDED"].includes(row.status)) return;
    const timestamp = await this.options.repositories.databaseNow();
    await this.options.repositories.deviceWifiConfiguration.update({ where: { id: row.id }, data: { status: event.status, ...(event.status === "CONNECTED" ? { connectedAt: timestamp } : event.status === "ROLLED_BACK" ? { rolledBackAt: timestamp } : { failedAt: timestamp }), errorCode: event.reason ?? null } });
  }

  async #ownedDevice(userId: string, deviceId: string, repositories = this.options.repositories): Promise<any> {
    if (!isUuid(deviceId)) throw new P9Error("OWNERSHIP_DENIED", 404, "Device not found");
    const device = await repositories.device.findFirst({ where: { id: deviceId, userId, status: "ACTIVE" }, select: { id: true, userId: true } });
    if (!device) throw new P9Error("OWNERSHIP_DENIED", 404, "Device not found");
    return device;
  }

  async #sendWifi(deviceId: string, configuration: any): Promise<void> {
    const event: any = { event: "wifi_configuration", configuration_id: configuration.id, ssid: configuration.ssid, security: configuration.security };
    if (configuration.security === "WPA_PSK" && configuration.secretCiphertext && configuration.secretNonce && configuration.secretTag && configuration.secretKeyVersion) {
      event.password = decryptWifiPassword({ ciphertext: configuration.secretCiphertext, nonce: configuration.secretNonce, tag: configuration.secretTag, keyVersion: configuration.secretKeyVersion }, this.options.encryptionKey);
    }
    await this.options.deviceEvents.sendToDevice(deviceId, event);
  }
}
