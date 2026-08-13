import { describe, expect, it, vi } from "vitest";

import { decryptWifiPassword, encryptWifiPassword } from "../../src/p9/device-additions.crypto.js";
import { DeviceAdditionsService } from "../../src/p9/services/device-additions.service.js";

const userId = "00000000-0000-4000-8000-000000000010";
const deviceId = "00000000-0000-4000-8000-000000000020";
const configId = "00000000-0000-4000-8000-000000000030";
const key = Buffer.alloc(32, 7);

describe("device additions crypto", () => {
  it("round-trips a Wi-Fi password without storing plaintext", () => {
    const encrypted = encryptWifiPassword("super-secret", key);
    expect(encrypted.ciphertext).not.toContain("super-secret");
    expect(decryptWifiPassword(encrypted, key)).toBe("super-secret");
  });

  it("rejects tampered ciphertext", () => {
    const encrypted = encryptWifiPassword("super-secret", key);
    encrypted.ciphertext = Buffer.from("tampered").toString("base64url");
    expect(() => decryptWifiPassword(encrypted, key)).toThrow();
  });
});

describe("device additions service", () => {
  function makeService(overrides: Record<string, unknown> = {}) {
    const repositories = {
      device: { findFirst: vi.fn().mockResolvedValue({ id: deviceId, userId, status: "ACTIVE" }), update: vi.fn() },
      deviceWifiConfiguration: {
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([]),
        create: vi.fn().mockImplementation(({ data }) => ({ id: configId, ...data, updatedAt: new Date("2026-08-13T00:00:00.000Z") })),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        update: vi.fn().mockResolvedValue(undefined),
        deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      deviceTelemetryCurrent: {
        findUnique: vi.fn().mockResolvedValue(null),
        upsert: vi.fn().mockResolvedValue({
          deviceId,
          wifiConnected: true,
          wifiRssi: -57,
          batterySupported: false,
          batteryPercent: null,
          firmwareVersion: "1.2.3",
          observedAt: new Date("2026-08-13T00:00:00.000Z"),
        }),
      },
      deviceLog: { create: vi.fn().mockResolvedValue({ id: "log-1" }), findMany: vi.fn().mockResolvedValue([]) },
      auditEvent: { create: vi.fn().mockResolvedValue(undefined) },
      databaseNow: vi.fn().mockResolvedValue(new Date("2026-08-13T00:00:00.000Z")),
      lockUser: vi.fn().mockResolvedValue(undefined),
      ...overrides,
    };
    const service = new DeviceAdditionsService({
      client: { $transaction: vi.fn(async (work: (transaction: unknown) => Promise<unknown>) => work({ ...repositories, $executeRaw: vi.fn(), $queryRaw: vi.fn().mockResolvedValue([{ now: new Date("2026-08-13T00:00:00.000Z") }]) })) } as never,
      repositories: repositories as never,
      encryptionKey: key,
      deviceEvents: { sendToDevice: vi.fn().mockResolvedValue(false) },
    });
    return { service, repositories };
  }

  it("does not expose a protected Wi-Fi secret in its public projection", () => {
    const { service } = makeService();
    expect(service.publicWifi({
      id: configId,
      ssid: "Home WiFi",
      security: "WPA_PSK",
      secretCiphertext: "cipher",
      secretNonce: "nonce",
      secretTag: "tag",
      secretKeyVersion: 1,
      status: "PENDING",
      updatedAt: new Date("2026-08-13T00:00:00.000Z"),
    })).toEqual({
      configurationId: configId,
      ssid: "Home WiFi",
      security: "WPA_PSK",
      hasPassword: true,
      status: "PENDING",
      updatedAt: "2026-08-13T00:00:00.000Z",
    });
  });

  it("supports open Wi-Fi without creating secret material", async () => {
    const { service, repositories } = makeService();
    await service.putWifi(userId, deviceId, { ssid: "Cafe Guest" }, "request-1");
    expect(repositories.deviceWifiConfiguration.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ security: "OPEN", secretCiphertext: null, secretNonce: null, secretTag: null, secretKeyVersion: null }),
    }));
  });

  it("rejects an owner operation for an inactive or foreign device", async () => {
    const { service } = makeService({ device: { findFirst: vi.fn().mockResolvedValue(null) } });
    await expect(service.getWifi(userId, deviceId)).rejects.toMatchObject({ code: "OWNERSHIP_DENIED", status: 404 });
  });

  it("sanitizes device log secrets and bounds message data", async () => {
    const { service, repositories } = makeService();
    await service.ingestLog({ deviceId, level: "WARN", code: "WIFI_CONNECT_FAILED", message: "password=do-not-store", metadata: { password: "do-not-store", firmware_version: "1.2.3" } });
    expect(repositories.deviceLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ message: "password=[REDACTED]", metadata: JSON.stringify({ firmware_version: "1.2.3" }) }),
    }));
    expect(JSON.stringify(repositories.deviceLog.create.mock.calls)).not.toContain("do-not-store");
  });

  it("keeps unsupported battery telemetry nullable", async () => {
    const { service, repositories } = makeService();
    await service.ingestTelemetry({ deviceId, wifi_connected: true, wifi_rssi: -57, battery_percent: null, firmware_version: "1.2.3" });
    expect(repositories.deviceTelemetryCurrent.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ batterySupported: false, batteryPercent: null }),
      update: expect.objectContaining({ batterySupported: false, batteryPercent: null }),
    }));
  });

  it("deletes stored Wi-Fi metadata without deleting the physical device", async () => {
    const { service, repositories } = makeService();
    await service.deleteWifi(userId, deviceId, "request-2");
    expect(repositories.deviceWifiConfiguration.deleteMany).toHaveBeenCalledWith({ where: { deviceId } });
    expect(repositories.device.update).not.toHaveBeenCalled();
  });
});
