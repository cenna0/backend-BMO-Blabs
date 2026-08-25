import { describe, expect, it, vi } from "vitest";

const fakeDb = vi.hoisted(() => ({
  $executeRaw: vi.fn().mockResolvedValue(0),
  device: {
    findFirst: vi.fn(),
    update: vi.fn().mockResolvedValue(undefined),
  },
  hardwareEnrollment: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
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
  it("rejects claiming a second active physical BMO for the same user", async () => {
    const repositories = {
      lockUser: vi.fn().mockResolvedValue(undefined),
      device: {
        count: vi.fn().mockResolvedValue(1),
        create: vi.fn(),
      },
    };

    await expect(new DeviceService({} as never, repositories as never).createClaimed({
      userId: "user-1",
      hardwareId: "bmo-002",
      name: "BMO",
      tokenHash: "token-hash",
    })).rejects.toMatchObject({ code: "CONFLICT", status: 409 });

    expect(repositories.device.create).not.toHaveBeenCalled();
  });

  it("clears a revoked default before promoting the replacement", async () => {
    fakeDb.device.findFirst
      .mockResolvedValueOnce({ id: "00000000-0000-0000-0000-000000000001", userId: "user-1", hardwareId: "bmo-001", status: "ACTIVE", settings: { defaultDevice: true } })
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
    expect(fakeDb.hardwareEnrollment.updateMany).toHaveBeenCalledWith({
      where: { hardwareId: "bmo-001", status: "ISSUED" },
      data: { status: "INVALIDATED" },
    });
  });
});
