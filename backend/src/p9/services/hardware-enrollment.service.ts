import type { PrismaClient } from "../../generated/prisma/client.js";

import { createPairingCode, keyedDigest } from "../crypto.js";
import { withP9Transaction } from "../db/client.js";
import { P9Repositories } from "../db/repositories.js";
import { P9Error } from "../errors.js";
import { AuditService } from "./audit.service.js";
import { DeviceService, publicDevice } from "./device.service.js";
import type { PairingCompletedEvent } from "../../websocket/events.js";

const DEFAULT_DEVICE_NAME = "BMO";
const MAX_CODE_COLLISION_RETRIES = 8;
const HARDWARE_REISSUE_COOLDOWN_MS = 5_000;
const HARDWARE_REISSUE_WINDOW_MS = 15 * 60 * 1_000;
const HARDWARE_REISSUE_LIMIT = 6;

export function isPairingCode(value: string): boolean {
  return /^\d{6}$/u.test(value);
}

export interface HardwareEnrollmentEventSender {
  send(hardwareId: string, event: PairingCompletedEvent): Promise<boolean> | boolean;
}

interface HardwareEnrollmentServiceOptions {
  client: PrismaClient;
  pepper: string;
  ttlSeconds: number;
  hardwareEvents?: HardwareEnrollmentEventSender;
}

export interface HardwareEnrollmentIssueInput {
  hardwareId: string;
  tokenHash: string;
}

export interface PairingClaimInput {
  code: string;
}

function isUniqueConstraint(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

export class HardwareEnrollmentService {
  constructor(private readonly options: HardwareEnrollmentServiceOptions) {}

  setHardwareEventSender(sender: HardwareEnrollmentEventSender): void {
    this.options.hardwareEvents = sender;
  }

  async issueForHardware(input: HardwareEnrollmentIssueInput) {
    for (let attempt = 0; attempt < MAX_CODE_COLLISION_RETRIES; attempt += 1) {
      const code = createPairingCode();
      try {
        return await withP9Transaction(this.options.client, async (transaction) => {
          const repositories = new P9Repositories(transaction);
          await repositories.lockHardwareEnrollment(input.hardwareId);
          const now = await repositories.databaseNow();
          const activeDevice = await repositories.device.findFirst({
            where: { hardwareId: input.hardwareId, status: { in: ["PENDING", "ACTIVE"] } },
            select: { id: true },
          });
          if (activeDevice) return null;
          const recentSince = new Date(now.getTime() - HARDWARE_REISSUE_WINDOW_MS);
          const recentCount = await repositories.hardwareEnrollment.count({
            where: { hardwareId: input.hardwareId, createdAt: { gte: recentSince } },
          });
          const latest = await repositories.hardwareEnrollment.findFirst({
            where: { hardwareId: input.hardwareId },
            orderBy: { createdAt: "desc" },
            select: { createdAt: true, codeHash: true },
          });
          if (recentCount >= HARDWARE_REISSUE_LIMIT || (latest && now.getTime() - latest.createdAt.getTime() < HARDWARE_REISSUE_COOLDOWN_MS)) {
            throw new P9Error("RATE_LIMITED", 429, "Pairing is temporarily rate limited");
          }

          const codeHash = keyedDigest(code, this.options.pepper);
          if (latest?.codeHash === codeHash) throw new Error("PAIRING_CODE_COLLISION");
          await repositories.hardwareEnrollment.updateMany({
            where: { hardwareId: input.hardwareId, status: "ISSUED" },
            data: { status: "INVALIDATED" },
          });
          await repositories.hardwareEnrollment.updateMany({
            where: { codeHash, status: "ISSUED", expiresAt: { lte: now } },
            data: { status: "EXPIRED" },
          });
          const collision = await repositories.hardwareEnrollment.findFirst({
            where: { codeHash, status: "ISSUED" },
            select: { id: true },
          });
          if (collision) throw new Error("PAIRING_CODE_COLLISION");

          const expiresAt = new Date(now.getTime() + this.options.ttlSeconds * 1_000);
          const enrollment = await repositories.hardwareEnrollment.create({
            data: {
              hardwareId: input.hardwareId,
              tokenHash: input.tokenHash,
              codeHash,
              status: "ISSUED",
              expiresAt,
            },
          });
          await new AuditService(repositories).record({
            eventType: "HARDWARE_ENROLLMENT_ISSUED",
            outcome: "success",
            actorType: "system",
            resourceType: "hardware_enrollment",
            resourceId: enrollment.id,
            metadata: { hardwareId: input.hardwareId, expiresAt: expiresAt.toISOString() },
          });
          return { hardwareId: input.hardwareId, code, expiresAt };
        });
      } catch (error) {
        if (error instanceof Error && error.message === "PAIRING_CODE_COLLISION") continue;
        if (isUniqueConstraint(error)) continue;
        throw error;
      }
    }
    throw new P9Error("SERVICE_UNAVAILABLE", 503, "Pairing temporarily unavailable");
  }

  async claim(userId: string, input: PairingClaimInput, requestId?: string) {
    if (!isPairingCode(input.code)) {
      throw new P9Error("INVALID_INPUT", 400, "Invalid pairing code");
    }

    const result = await withP9Transaction(this.options.client, async (transaction) => {
      const repositories = new P9Repositories(transaction);
      const codeHash = keyedDigest(input.code, this.options.pepper);
      const candidate = await repositories.hardwareEnrollment.findFirst({
        where: { codeHash, status: "ISSUED" },
      });
      if (!candidate) return { kind: "INVALID" as const };

      await repositories.lockHardwareEnrollment(candidate.hardwareId);
      const now = await repositories.databaseNow();
      const enrollment = await repositories.hardwareEnrollment.findFirst({
        where: { id: candidate.id, status: "ISSUED" },
      });
      if (!enrollment || enrollment.expiresAt <= now) {
        if (enrollment) {
          await repositories.hardwareEnrollment.updateMany({
            where: { id: enrollment.id, status: "ISSUED" },
            data: { status: "EXPIRED" },
          });
        }
        return { kind: "INVALID" as const };
      }

      const claimed = await repositories.hardwareEnrollment.updateMany({
        where: { id: enrollment.id, status: "ISSUED", expiresAt: { gt: now } },
        data: { status: "CLAIMED", claimedAt: now, claimedUserId: userId },
      });
      if (claimed.count !== 1) {
        return { kind: "INVALID" as const };
      }

      const device = await new DeviceService(this.options.client, repositories).createClaimed({
        userId,
        hardwareId: enrollment.hardwareId,
        tokenHash: enrollment.tokenHash,
        name: DEFAULT_DEVICE_NAME,
      }, repositories);
      await repositories.hardwareEnrollment.update({
        where: { id: enrollment.id },
        data: { claimedDeviceId: device.id },
      });
      await new AuditService(repositories).record({
        eventType: "HARDWARE_ENROLLMENT_CLAIMED",
        outcome: "success",
        actorType: "user",
        resourceType: "device",
        resourceId: device.id,
        userId,
        deviceId: device.id,
        ...(requestId === undefined ? {} : { context: { requestId } }),
      });
      return { kind: "CLAIMED" as const, hardwareId: enrollment.hardwareId, device: publicDevice(device) };
    });

    if (result.kind === "INVALID") {
      throw new P9Error("PAIRING_CODE_INVALID_OR_EXPIRED", 409, "Pairing code is invalid or expired");
    }

    try {
      await this.options.hardwareEvents?.send(result.hardwareId, { event: "pairing_completed", status: "ok" });
    } catch {
      // The durable Device binding is authoritative; the hardware will recover on reconnect.
    }
    return result.device;
  }
}
