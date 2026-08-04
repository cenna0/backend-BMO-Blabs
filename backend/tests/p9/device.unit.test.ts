import { describe, expect, it, vi } from "vitest";

const fakeDb = vi.hoisted(() => ({
  $executeRaw: vi.fn().mockResolvedValue(0),
  device: {
    findFirst: vi.fn(),
    update: vi.fn().mockResolvedValue(undefined),
  },
  session: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
  refreshToken: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
  devicePairing: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
  deviceSettings: { update: vi.fn().mockResolvedValue(undefined) },
  auditEvent: { create: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock("../../src/p9/db/client.js", () => ({
  withP9Transaction: async (_client: unknown, callback: (db: typeof fakeDb) => Promise<unknown>) => callback(fakeDb),
}));

import { DeviceService } from "../../src/p9/services/device.service.js";

describe("P9 device ownership lifecycle", () => {
  it("clears a revoked default before promoting the replacement", async () => {
    fakeDb.device.findFirst
      .mockResolvedValueOnce({ id: "00000000-0000-0000-0000-000000000001", userId: "user-1", status: "ACTIVE", settings: { defaultDevice: true } })
      .mockResolvedValueOnce({ id: "00000000-0000-0000-0000-000000000002", userId: "user-1", status: "ACTIVE" });

    await new DeviceService({} as never, {} as never).unpair("user-1", "00000000-0000-0000-0000-000000000001", "request-1");

    expect(fakeDb.deviceSettings.update).toHaveBeenCalledWith({
      where: { deviceId: "00000000-0000-0000-0000-000000000001" },
      data: { defaultDevice: false },
    });
    expect(fakeDb.deviceSettings.update).toHaveBeenCalledWith({
      where: { deviceId: "00000000-0000-0000-0000-000000000002" },
      data: { defaultDevice: true },
    });
  });
});
