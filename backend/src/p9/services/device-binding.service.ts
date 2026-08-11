import { safeDigestEqual, sha256Hex } from "../crypto.js";
import type { P9Repositories } from "../db/repositories.js";

export interface ApplicationDeviceBinding {
  deviceId: string;
  userId: string;
  hardwareId: string;
}

export class DeviceBindingService {
  constructor(private readonly repositories: P9Repositories) {}

  async resolve(hardwareId: string, deviceToken: string): Promise<ApplicationDeviceBinding | null> {
    const device = await this.repositories.device.findFirst({
      where: { hardwareId, status: "ACTIVE" },
      select: { id: true, userId: true, hardwareId: true, tokenHash: true },
    });
    if (!device || !safeDigestEqual(device.tokenHash, sha256Hex(deviceToken))) return null;
    return { deviceId: device.id, userId: device.userId, hardwareId: device.hardwareId };
  }
}
