import type { PrismaClient } from "../../generated/prisma/client.js";
import { sha256Hex } from "../crypto.js";
import { withP9Transaction } from "../db/client.js";
import { P9Repositories } from "../db/repositories.js";
import { P9Error } from "../errors.js";
import { isUuid } from "../validation.js";
import type { SafeDevice } from "../types.js";
import { AuditService } from "./audit.service.js";

export interface ClaimedDeviceInput {
  userId: string;
  hardwareId: string;
  name: string;
  deviceCredential: string;
}

export function publicDevice(device: {
  id: string;
  hardwareId: string;
  name: string;
  status: string;
  pairedAt: Date | null;
  lastSeenAt: Date | null;
}): SafeDevice {
  return {
    id: device.id,
    hardwareId: device.hardwareId,
    name: device.name,
    status: device.status,
    pairedAt: device.pairedAt?.toISOString() ?? null,
    lastSeenAt: device.lastSeenAt?.toISOString() ?? null,
  };
}

export class DeviceService {
  constructor(private readonly client: PrismaClient, private readonly repositories: P9Repositories) {}

  async list(userId: string): Promise<SafeDevice[]> {
    const devices = await this.repositories.device.findMany({ where: { userId }, orderBy: { createdAt: "asc" } });
    return devices.map(publicDevice);
  }

  async get(userId: string, deviceId: string): Promise<SafeDevice> {
    if (!isUuid(deviceId)) throw new P9Error("OWNERSHIP_DENIED", 404, "Device not found");
    const device = await this.repositories.device.findFirst({ where: { id: deviceId, userId } });
    if (!device) throw new P9Error("OWNERSHIP_DENIED", 404, "Device not found");
    return publicDevice(device);
  }

  async createClaimed(input: ClaimedDeviceInput, repositories = this.repositories) {
    await repositories.lockUser(input.userId);
    const activeCount = await repositories.device.count({ where: { userId: input.userId, status: "ACTIVE" } });
    const device = await repositories.device.create({
      data: {
        userId: input.userId,
        hardwareId: input.hardwareId,
        name: input.name,
        tokenHash: sha256Hex(input.deviceCredential),
        status: "ACTIVE",
        pairedAt: new Date(),
        settings: { create: { displayName: input.name, defaultDevice: activeCount === 0 } },
      },
    });
    return device;
  }

  async unpair(userId: string, deviceId: string, requestId?: string): Promise<void> {
    if (!isUuid(deviceId)) throw new P9Error("OWNERSHIP_DENIED", 404, "Device not found");
    await withP9Transaction(this.client, async (transaction) => {
      const repositories = new P9Repositories(transaction);
      await repositories.lockUser(userId);
      const device = await repositories.device.findFirst({ where: { id: deviceId, userId, status: "ACTIVE" }, include: { settings: true } });
      if (!device) throw new P9Error("OWNERSHIP_DENIED", 404, "Device not found");
      const now = new Date();
      await repositories.device.update({ where: { id: deviceId }, data: { status: "REVOKED", revokedAt: now } });
      await repositories.session.updateMany({ where: { clientDeviceId: deviceId, revokedAt: null }, data: { revokedAt: now, revokedReason: "device_unpaired" } });
      await repositories.refreshToken.updateMany({ where: { session: { clientDeviceId: deviceId }, revokedAt: null }, data: { revokedAt: now } });
      await repositories.devicePairing.updateMany({ where: { deviceId, status: "ISSUED" }, data: { status: "REVOKED", revokedAt: now } });
      if (device.settings?.defaultDevice) {
        await repositories.deviceSettings.update({ where: { deviceId }, data: { defaultDevice: false } });
        const replacement = await repositories.device.findFirst({ where: { userId, status: "ACTIVE", id: { not: deviceId } }, orderBy: { createdAt: "asc" } });
        if (replacement) await repositories.deviceSettings.update({ where: { deviceId: replacement.id }, data: { defaultDevice: true } });
      }
      await new AuditService(repositories).record({
        eventType: "DEVICE_UNPAIRED",
        outcome: "success",
        actorType: "user",
        resourceType: "device",
        resourceId: deviceId,
        userId,
        deviceId,
        ...(requestId === undefined ? {} : { context: { requestId } }),
      });
    });
  }
}
