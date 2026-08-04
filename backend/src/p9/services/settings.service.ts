import { Prisma, type PrismaClient } from "../../generated/prisma/client.js";
import { withP9Transaction } from "../db/client.js";
import { P9Repositories } from "../db/repositories.js";
import { P9Error } from "../errors.js";
import { isUuid, parseDeviceSettings, parseUserSettings, type QuietHours } from "../validation.js";
import { AuditService } from "./audit.service.js";

const responseLengthFromDatabase = (value: string): "brief" | "standard" | "detailed" => value.toLowerCase() as "brief" | "standard" | "detailed";

export function publicUserSettings(settings: {
  language: string;
  responseLength: string;
  automaticMemoryCandidates: boolean;
  timezone: string;
}) {
  return {
    language: settings.language,
    responseLength: responseLengthFromDatabase(settings.responseLength),
    automaticMemoryCandidates: settings.automaticMemoryCandidates,
    timezone: settings.timezone,
  };
}

export function publicDeviceSettings(settings: {
  displayName: string | null;
  defaultDevice: boolean;
  playbackVolume: number;
  quietHours: unknown;
  notificationBehavior: string;
  voiceProfileId: string;
  speechSpeed: number;
  enabled: boolean;
}) {
  return {
    displayName: settings.displayName,
    defaultDevice: settings.defaultDevice,
    playbackVolume: settings.playbackVolume,
    quietHours: settings.quietHours as QuietHours | null,
    notificationBehavior: settings.notificationBehavior.toLowerCase(),
    voiceProfileId: "prudence",
    speechSpeed: settings.speechSpeed,
    enabled: settings.enabled,
    timezone: "Asia/Jakarta" as const,
    voice: { model: "en_GB-semaine-medium" as const, speaker: "prudence" as const, speakerId: 0 as const },
  };
}

export class SettingsService {
  constructor(
    private readonly client: PrismaClient,
    private readonly repositories: P9Repositories,
  ) {}

  async getUserSettings(userId: string) {
    const settings = await this.repositories.userSettings.findUnique({ where: { userId } });
    if (!settings) throw new P9Error("DATABASE_UNAVAILABLE", 500, "Settings unavailable");
    return publicUserSettings(settings);
  }

  async updateUserSettings(userId: string, input: unknown, requestId?: string) {
    const parsed = parseUserSettings(input);
    return withP9Transaction(this.client, async (transaction) => {
      const repositories = new P9Repositories(transaction);
      await repositories.lockUser(userId);
      const current = await repositories.userSettings.findUnique({ where: { userId } });
      if (!current) throw new P9Error("OWNERSHIP_DENIED", 404, "Settings not found");
      const updated = await repositories.userSettings.update({
        where: { userId },
        data: {
          ...(parsed.language === undefined ? {} : { language: parsed.language }),
          ...(parsed.responseLength === undefined ? {} : { responseLength: parsed.responseLength.toUpperCase() as "BRIEF" | "STANDARD" | "DETAILED" }),
          ...(parsed.automaticMemoryCandidates === undefined ? {} : { automaticMemoryCandidates: parsed.automaticMemoryCandidates }),
          timezone: "Asia/Jakarta",
        },
      });
      await new AuditService(repositories).record({
        eventType: "USER_SETTINGS_CHANGED",
        outcome: "success",
        actorType: "user",
        resourceType: "user_settings",
        resourceId: updated.id,
        userId,
        ...(requestId === undefined ? {} : { context: { requestId } }),
        metadata: { count: Object.keys(parsed).length },
      });
      return publicUserSettings(updated);
    });
  }

  async getDeviceSettings(userId: string, deviceId: string) {
    if (!isUuid(deviceId)) throw new P9Error("OWNERSHIP_DENIED", 404, "Device not found");
    const device = await this.repositories.device.findFirst({ where: { id: deviceId, userId, status: "ACTIVE" }, include: { settings: true } });
    if (!device?.settings) throw new P9Error("OWNERSHIP_DENIED", 404, "Device not found");
    return publicDeviceSettings(device.settings);
  }

  async updateDeviceSettings(userId: string, deviceId: string, input: unknown, requestId?: string) {
    if (!isUuid(deviceId)) throw new P9Error("OWNERSHIP_DENIED", 404, "Device not found");
    const parsed = parseDeviceSettings(input);
    return withP9Transaction(this.client, async (transaction) => {
      const repositories = new P9Repositories(transaction);
      await repositories.lockUser(userId);
      const device = await repositories.device.findFirst({ where: { id: deviceId, userId, status: "ACTIVE" }, include: { settings: true } });
      if (!device?.settings) throw new P9Error("OWNERSHIP_DENIED", 404, "Device not found");

      const activeDevices = await repositories.device.findMany({ where: { userId, status: "ACTIVE" }, select: { id: true } });
      if (parsed.defaultDevice === true) {
        await repositories.deviceSettings.updateMany({ where: { deviceId: { in: activeDevices.map((entry) => entry.id) } }, data: { defaultDevice: false } });
      }

      let defaultDevice = parsed.defaultDevice;
      if (parsed.defaultDevice === false && device.settings.defaultDevice) {
        const replacement = activeDevices.find((entry) => entry.id !== deviceId);
        if (replacement) {
          await repositories.deviceSettings.update({ where: { deviceId: replacement.id }, data: { defaultDevice: true } });
        } else {
          defaultDevice = true;
        }
      }
      const updated = await repositories.deviceSettings.update({
        where: { deviceId },
        data: {
          ...(parsed.displayName === undefined ? {} : { displayName: parsed.displayName }),
          ...(defaultDevice === undefined ? {} : { defaultDevice }),
          ...(parsed.playbackVolume === undefined ? {} : { playbackVolume: parsed.playbackVolume }),
          ...(parsed.quietHours === undefined ? {} : { quietHours: parsed.quietHours === null ? Prisma.JsonNull : parsed.quietHours }),
          ...(parsed.notificationBehavior === undefined ? {} : { notificationBehavior: parsed.notificationBehavior.toUpperCase() as "ALL" | "IMPORTANT" | "NONE" }),
          ...(parsed.voiceProfileId === undefined ? {} : { voiceProfileId: "prudence" }),
          ...(parsed.speechSpeed === undefined ? {} : { speechSpeed: parsed.speechSpeed }),
          ...(parsed.enabled === undefined ? {} : { enabled: parsed.enabled }),
        },
      });
      await new AuditService(repositories).record({
        eventType: "DEVICE_SETTINGS_CHANGED",
        outcome: "success",
        actorType: "user",
        resourceType: "device_settings",
        resourceId: updated.id,
        userId,
        deviceId,
        ...(requestId === undefined ? {} : { context: { requestId } }),
        metadata: { count: Object.keys(parsed).length },
      });
      return publicDeviceSettings(updated);
    });
  }
}
