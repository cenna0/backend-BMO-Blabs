import type { DeliverySource } from "../../generated/prisma/client.js";
import type { P9Repositories } from "../db/repositories.js";
import { P9Error } from "../errors.js";
import type { MobileOutboundEvent } from "../websocket/mobile-events.js";

const BASELINE_DEADLINE_MS = 5 * 60 * 1_000;

export interface ProactiveDeviceSender {
  isUserVoiceBusy(deviceId: string): Promise<boolean>;
  offer(delivery: { id: string; userId: string; deviceId: string; source: DeliverySource }): Promise<
    | { status: "accepted"; receiptId?: string }
    | { status: "retry"; errorCode: string }
  >;
}

interface MobileEvents { sendToUser(userId: string, event: MobileOutboundEvent): number }

export interface EnqueueProactiveDelivery {
  userId: string;
  deviceId?: string;
  source: DeliverySource;
  sourceResourceType: string;
  sourceResourceId: string;
  idempotencyKey: string;
  expiresAt?: Date;
}

export class ProactiveDeliveryService {
  constructor(private readonly options: { repositories: P9Repositories; mobileEvents: MobileEvents; sender?: ProactiveDeviceSender }) {}

  async enqueue(input: EnqueueProactiveDelivery): Promise<any> {
    const existing = await this.options.repositories.proactiveDelivery.findUnique({ where: { userId_idempotencyKey: { userId: input.userId, idempotencyKey: input.idempotencyKey } } });
    if (existing) {
      if (existing.source !== input.source || existing.sourceResourceId !== input.sourceResourceId || existing.deviceId !== (input.deviceId ?? null)) throw new P9Error("CONFLICT", 409, "Idempotency key was already used");
      return existing;
    }
    if (input.deviceId) {
      const ownedDevice = await this.options.repositories.device.findFirst({ where: { id: input.deviceId, userId: input.userId, status: "ACTIVE" }, select: { id: true } });
      if (!ownedDevice) throw new P9Error("OWNERSHIP_DENIED", 404, "Device not found");
    }
    const now = await this.options.repositories.databaseNow();
    let delivery: any;
    try {
      delivery = await this.options.repositories.proactiveDelivery.create({ data: {
        userId: input.userId, ...(input.deviceId ? { deviceId: input.deviceId } : {}), source: input.source,
        sourceResourceType: input.sourceResourceType, sourceResourceId: input.sourceResourceId,
        idempotencyKey: input.idempotencyKey, expiresAt: input.expiresAt ?? new Date(now.getTime() + BASELINE_DEADLINE_MS),
      } });
    } catch (error) {
      if (!(typeof error === "object" && error !== null && "code" in error && error.code === "P2002")) throw error;
      delivery = await this.options.repositories.proactiveDelivery.findUnique({ where: { userId_idempotencyKey: { userId: input.userId, idempotencyKey: input.idempotencyKey } } });
      if (!delivery || delivery.source !== input.source || delivery.sourceResourceId !== input.sourceResourceId || delivery.deviceId !== (input.deviceId ?? null)) throw new P9Error("CONFLICT", 409, "Idempotency key was already used");
    }
    this.#emit(delivery);
    return delivery;
  }

  async expireStale(): Promise<number> {
    const now = await this.options.repositories.databaseNow();
    const stale: any[] = await this.options.repositories.proactiveDelivery.findMany({
      where: { status: { in: ["PENDING", "READY", "DELIVERING"] }, expiresAt: { lte: now } }, orderBy: [{ expiresAt: "asc" }, { id: "asc" }], take: 100,
    });
    let expired = 0;
    for (const delivery of stale) {
      const changed = await this.options.repositories.proactiveDelivery.updateMany({ where: { id: delivery.id, status: delivery.status }, data: { status: "EXPIRED", errorCode: "DELIVERY_EXPIRED" } });
      if (changed.count !== 1) continue;
      expired += 1; this.#emit({ ...delivery, status: "EXPIRED", errorCode: "DELIVERY_EXPIRED" });
    }
    return expired;
  }

  async processOnce(): Promise<{ claimed: number; delivered: number; pendingPhysical: number }> {
    await this.expireStale();
    const pending: any[] = await this.options.repositories.proactiveDelivery.findMany({
      where: { status: "PENDING", expiresAt: { gt: await this.options.repositories.databaseNow() } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 100,
    });
    if (!this.options.sender) return { claimed: 0, delivered: 0, pendingPhysical: pending.length };
    let claimed = 0; let delivered = 0; let pendingPhysical = 0; const devices = new Set<string>();
    for (const delivery of pending) {
      if (!delivery.deviceId || devices.has(delivery.deviceId) || await this.options.sender.isUserVoiceBusy(delivery.deviceId)) { pendingPhysical += 1; continue; }
      devices.add(delivery.deviceId);
      const claimedRows: any[] = await this.options.repositories.claimProactiveDelivery({ deliveryId: delivery.id });
      const claimedDelivery = claimedRows[0];
      if (!claimedDelivery) continue;
      claimed += 1;
      const attemptNumber = claimedDelivery.attemptCount;
      const outcome = await this.options.sender.offer({ id: delivery.id, userId: delivery.userId, deviceId: delivery.deviceId, source: delivery.source });
      if (outcome.status === "retry") {
        await this.options.repositories.deliveryAttempt.create({ data: { deliveryId: delivery.id, userId: delivery.userId, deviceId: delivery.deviceId, attemptNumber, status: "FAILED", channel: "PHYSICAL_ESP", errorCode: outcome.errorCode } });
        await this.options.repositories.proactiveDelivery.update({ where: { id: delivery.id }, data: { status: "PENDING", errorCode: outcome.errorCode } });
        this.#emit({ ...delivery, status: "PENDING", attemptCount: attemptNumber, errorCode: outcome.errorCode });
        pendingPhysical += 1;
        continue;
      }
      await this.options.repositories.deliveryAttempt.create({ data: { deliveryId: delivery.id, userId: delivery.userId, deviceId: delivery.deviceId, attemptNumber, status: "SENT", channel: "PHYSICAL_ESP", ...(outcome.receiptId ? { receiptId: outcome.receiptId } : {}), sentAt: await this.options.repositories.databaseNow() } });
      await this.options.repositories.proactiveDelivery.update({ where: { id: delivery.id }, data: { status: "DELIVERING", errorCode: null } });
      this.#emit({ ...delivery, status: "DELIVERING", attemptCount: attemptNumber, errorCode: null });
      delivered += 1;
    }
    return { claimed, delivered, pendingPhysical };
  }

  #emit(delivery: any): void {
    if (!delivery.deviceId) return;
    this.options.mobileEvents.sendToUser(delivery.userId, { event: "proactive_delivery_status", deviceId: delivery.deviceId, deliveryId: delivery.id, source: delivery.source, status: delivery.status, errorCode: delivery.errorCode ?? null });
  }
}
