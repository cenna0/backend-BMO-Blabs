import type { PrismaClient } from "../../generated/prisma/client.js";
import { createPairingCode, keyedDigest, safeDigestEqual } from "../crypto.js";
import { withP9Transaction } from "../db/client.js";
import { P9Repositories } from "../db/repositories.js";
import { P9Error } from "../errors.js";
import { publicDevice, DeviceService } from "./device.service.js";
import { AuditService } from "./audit.service.js";
import { isUuid } from "../validation.js";

export function isPairingCode(value: string): boolean {
  return /^\d{6}$/.test(value);
}

export function publicPairingStatus(pairing: {
  id: string;
  status: string;
  expiresAt: Date;
  attemptCount: number;
}) {
  return {
    id: pairing.id,
    status: pairing.status.toLowerCase(),
    expiresAt: pairing.expiresAt.toISOString(),
    attemptCount: pairing.attemptCount,
  };
}

interface PairingServiceOptions {
  client: PrismaClient;
  repositories: P9Repositories;
  pepper: string;
  ttlSeconds: number;
}

export interface PairingClaimInput {
  pairingId: string;
  code: string;
  hardwareId: string;
  deviceName: string;
  deviceCredential: string;
}

export class PairingService {
  constructor(private readonly options: PairingServiceOptions) {}

  async issue(userId: string, requestId?: string) {
    const now = new Date();
    const code = createPairingCode();
    const expiresAt = new Date(now.getTime() + this.options.ttlSeconds * 1_000);
    return withP9Transaction(this.options.client, async (transaction) => {
      const repositories = new P9Repositories(transaction);
      await repositories.lockUser(userId);
      const active = await repositories.devicePairing.findMany({ where: { userId, status: "ISSUED" }, select: { id: true } });
      if (active.length > 0) {
        await repositories.devicePairing.updateMany({ where: { id: { in: active.map((entry) => entry.id) }, status: "ISSUED" }, data: { status: "INVALIDATED", invalidatedAt: now } });
        for (const previous of active) {
          await new AuditService(repositories).record({
            eventType: "PAIRING_INVALIDATED",
            outcome: "success",
            actorType: "user",
            resourceType: "pairing",
            resourceId: previous.id,
            userId,
            ...(requestId === undefined ? {} : { context: { requestId } }),
          });
        }
      }
      const pairing = await repositories.devicePairing.create({
        data: {
          userId,
          codeHash: keyedDigest(code, this.options.pepper),
          status: "ISSUED",
          expiresAt,
        },
      });
      await new AuditService(repositories).record({
        eventType: "PAIRING_REQUESTED",
        outcome: "success",
        actorType: "user",
        resourceType: "pairing",
        resourceId: pairing.id,
        userId,
        ...(requestId === undefined ? {} : { context: { requestId } }),
      });
      return { id: pairing.id, code, expiresAt };
    });
  }

  async status(userId: string, pairingId: string): Promise<ReturnType<typeof publicPairingStatus>> {
    if (!isUuid(pairingId)) throw new P9Error("PAIRING_INVALID", 404, "Pairing not found");
    const pairing = await this.options.repositories.devicePairing.findFirst({ where: { id: pairingId, userId } });
    if (!pairing) throw new P9Error("PAIRING_INVALID", 404, "Pairing not found");
    if (pairing.status === "ISSUED" && pairing.expiresAt <= new Date()) {
      const updated = await this.options.repositories.devicePairing.updateMany({ where: { id: pairingId, status: "ISSUED" }, data: { status: "EXPIRED" } });
      if (updated.count === 1) {
        await new AuditService(this.options.repositories).record({ eventType: "PAIRING_EXPIRED", outcome: "success", actorType: "system", resourceType: "pairing", resourceId: pairingId, userId });
      }
      return publicPairingStatus({ ...pairing, status: "EXPIRED" });
    }
    return publicPairingStatus(pairing);
  }

  async revoke(userId: string, pairingId: string, requestId?: string): Promise<void> {
    if (!isUuid(pairingId)) throw new P9Error("PAIRING_INVALID", 404, "Pairing not found");
    const updated = await this.options.repositories.devicePairing.updateMany({ where: { id: pairingId, userId, status: "ISSUED" }, data: { status: "REVOKED", revokedAt: new Date() } });
    if (updated.count !== 1) throw new P9Error("PAIRING_INVALID", 404, "Pairing not found");
    await new AuditService(this.options.repositories).record({
      eventType: "PAIRING_REVOKED",
      outcome: "success",
      actorType: "user",
      resourceType: "pairing",
      resourceId: pairingId,
      userId,
      ...(requestId === undefined ? {} : { context: { requestId } }),
    });
  }

  async claim(userId: string, input: PairingClaimInput, requestId?: string) {
    if (!isUuid(input.pairingId) || !isPairingCode(input.code) || input.hardwareId.trim().length < 1 || input.hardwareId.length > 128 || input.deviceName.trim().length < 1 || input.deviceName.length > 120 || input.deviceCredential.length < 16 || input.deviceCredential.length > 256) {
      throw new P9Error("PAIRING_INVALID", 400, "Pairing is not valid");
    }
    try {
      const result = await withP9Transaction(this.options.client, async (transaction) => {
        const repositories = new P9Repositories(transaction);
        await repositories.lockUser(userId);
        const pairing = await repositories.devicePairing.findFirst({ where: { id: input.pairingId, userId } });
        if (!pairing) throw new P9Error("PAIRING_INVALID", 404, "Pairing is not valid");
        const now = new Date();
        if (pairing.status !== "ISSUED") throw new P9Error("PAIRING_INVALID", 409, "Pairing is not valid");
        if (pairing.expiresAt <= now) {
          await repositories.devicePairing.updateMany({ where: { id: pairing.id, status: "ISSUED" }, data: { status: "EXPIRED" } });
          await new AuditService(repositories).record({ eventType: "PAIRING_EXPIRED", outcome: "success", actorType: "system", resourceType: "pairing", resourceId: pairing.id, userId, ...(requestId === undefined ? {} : { context: { requestId } }) });
          return { kind: "rejected" as const };
        }
        if (pairing.attemptCount >= pairing.maxAttempts) {
          await repositories.devicePairing.updateMany({ where: { id: pairing.id, status: "ISSUED" }, data: { status: "FAILED" } });
          await new AuditService(repositories).record({ eventType: "PAIRING_FAILED", outcome: "denied", actorType: "user", resourceType: "pairing", resourceId: pairing.id, userId, ...(requestId === undefined ? {} : { context: { requestId } }), metadata: { attempts: pairing.attemptCount } });
          return { kind: "rejected" as const };
        }

        const digest = keyedDigest(input.code, this.options.pepper);
        if (!safeDigestEqual(digest, pairing.codeHash)) {
          const attempted = await repositories.devicePairing.updateMany({ where: { id: pairing.id, status: "ISSUED", attemptCount: { lt: pairing.maxAttempts } }, data: { attemptCount: { increment: 1 }, lastAttemptAt: now } });
          const nextAttemptCount = pairing.attemptCount + 1;
          if (attempted.count === 1 && nextAttemptCount >= pairing.maxAttempts) {
            await repositories.devicePairing.updateMany({ where: { id: pairing.id, status: "ISSUED" }, data: { status: "FAILED" } });
          }
          await new AuditService(repositories).record({ eventType: "PAIRING_FAILED", outcome: "denied", actorType: "user", resourceType: "pairing", resourceId: pairing.id, userId, ...(requestId === undefined ? {} : { context: { requestId } }), metadata: { attempts: nextAttemptCount } });
          return { kind: "rejected" as const };
        }

        const claimed = await repositories.devicePairing.updateMany({ where: { id: pairing.id, userId, status: "ISSUED", codeHash: digest, expiresAt: { gt: now }, attemptCount: { lt: pairing.maxAttempts } }, data: { status: "CLAIMED", claimedAt: now } });
        if (claimed.count !== 1) throw new P9Error("PAIRING_INVALID", 409, "Pairing is not valid");
        const device = await new DeviceService(this.options.client, repositories).createClaimed({ userId, hardwareId: input.hardwareId, name: input.deviceName, deviceCredential: input.deviceCredential }, repositories);
        await repositories.devicePairing.update({ where: { id: pairing.id }, data: { deviceId: device.id } });
        await new AuditService(repositories).record({ eventType: "PAIRING_CLAIMED", outcome: "success", actorType: "user", resourceType: "device", resourceId: device.id, userId, deviceId: device.id, ...(requestId === undefined ? {} : { context: { requestId } }) });
        return { kind: "success" as const, device: publicDevice(device) };
      });
      if (result.kind === "rejected") throw new P9Error("PAIRING_INVALID", 409, "Pairing is not valid");
      return result.device;
    } catch (error) {
      if (error instanceof P9Error) throw error;
      await new AuditService(this.options.repositories).record({ eventType: "PAIRING_FAILED", outcome: "failure", actorType: "user", resourceType: "pairing", resourceId: input.pairingId, userId, ...(requestId === undefined ? {} : { context: { requestId } }) }).catch(() => undefined);
      throw new P9Error("PAIRING_INVALID", 409, "Pairing is not valid");
    }
  }
}
