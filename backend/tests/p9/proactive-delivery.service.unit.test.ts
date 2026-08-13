import { describe, expect, it, vi } from "vitest";

import { ProactiveDeliveryService } from "../../src/p9/services/proactive-delivery.service.js";

const userId = "00000000-0000-4000-8000-000000000001";
const deviceId = "00000000-0000-4000-8000-000000000002";
const resourceId = "00000000-0000-4000-8000-000000000003";

function fixture(sender?: any) {
  let delivery: any;
  const repositories: any = {
    databaseNow: vi.fn().mockResolvedValue(new Date("2026-08-13T00:00:00Z")),
    claimProactiveDelivery: vi.fn(async ({ deliveryId }: any) => {
      if (!delivery || delivery.id !== deliveryId || delivery.status !== "PENDING") return [];
      delivery = { ...delivery, status: "DELIVERING", attemptCount: delivery.attemptCount + 1, errorCode: null };
      return [delivery];
    }),
    device: { findFirst: vi.fn().mockResolvedValue({ id: deviceId }) },
    proactiveDelivery: {
      findUnique: vi.fn(async () => delivery),
      create: vi.fn(async ({ data }: any) => (delivery = { id: "00000000-0000-4000-8000-000000000004", status: "PENDING", attemptCount: 0, errorCode: null, ...data, createdAt: new Date("2026-08-13T00:00:00Z") })),
      findMany: vi.fn(async ({ where }: any) => {
        if (!delivery) return [];
        const now = new Date("2026-08-13T00:00:00Z");
        if (where.expiresAt?.lte && delivery.expiresAt > now) return [];
        if (where.expiresAt?.gt && delivery.expiresAt <= now) return [];
        if (typeof where.status === "string" && delivery.status !== where.status) return [];
        if (where.status?.in && !where.status.in.includes(delivery.status)) return [];
        return [delivery];
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        if (!delivery || where.id !== delivery.id || where.status && where.status !== delivery.status) return { count: 0 };
        delivery = { ...delivery, ...data, attemptCount: typeof data.attemptCount === "object" ? delivery.attemptCount + 1 : data.attemptCount ?? delivery.attemptCount }; return { count: 1 };
      }),
      update: vi.fn(async ({ data }: any) => (delivery = { ...delivery, ...data })),
    },
    deliveryAttempt: { create: vi.fn().mockResolvedValue({}) },
  };
  const mobileEvents = { sendToUser: vi.fn() };
  return { service: new ProactiveDeliveryService({ repositories, mobileEvents, ...(sender ? { sender } : {}) }), repositories, mobileEvents, get delivery() { return delivery; } };
}

describe("generic proactive delivery", () => {
  it.each(["CHAT", "SCHEDULE", "WHATSAPP"] as const)("enqueues %s through one durable idempotent path", async (source) => {
    const f = fixture();
    const first = await f.service.enqueue({ userId, deviceId, source, sourceResourceType: source.toLowerCase(), sourceResourceId: resourceId, idempotencyKey: `${source}:key` });
    const replay = await f.service.enqueue({ userId, deviceId, source, sourceResourceType: source.toLowerCase(), sourceResourceId: resourceId, idempotencyKey: `${source}:key` });
    expect(first.id).toBe(replay.id);
    expect(f.repositories.proactiveDelivery.create).toHaveBeenCalledTimes(1);
    expect(first.expiresAt.toISOString()).toBe("2026-08-13T00:05:00.000Z");
  });

  it("remains pending without a physical sender and does not claim playback", async () => {
    const f = fixture();
    await f.service.enqueue({ userId, deviceId, source: "SCHEDULE", sourceResourceType: "schedule_run", sourceResourceId: resourceId, idempotencyKey: "schedule:key" });
    expect(await f.service.processOnce()).toEqual({ claimed: 0, delivered: 0, pendingPhysical: 1 });
    expect(f.delivery.status).toBe("PENDING");
    expect(f.repositories.deliveryAttempt.create).not.toHaveBeenCalled();
  });

  it("serializes per device, honors user voice priority, and records sender retry", async () => {
    const sender = { isUserVoiceBusy: vi.fn().mockResolvedValueOnce(true).mockResolvedValue(false), offer: vi.fn().mockResolvedValue({ status: "retry", errorCode: "DEVICE_OFFLINE" }) };
    const f = fixture(sender);
    await f.service.enqueue({ userId, deviceId, source: "CHAT", sourceResourceType: "chat_message", sourceResourceId: resourceId, idempotencyKey: "chat:key" });
    expect(await f.service.processOnce()).toMatchObject({ claimed: 0, pendingPhysical: 1 });
    expect(await f.service.processOnce()).toMatchObject({ claimed: 1, delivered: 0 });
    expect(f.delivery).toMatchObject({ status: "PENDING", errorCode: "DEVICE_OFFLINE", attemptCount: 1 });
    expect(f.repositories.deliveryAttempt.create).toHaveBeenCalledWith({ data: expect.objectContaining({ channel: "PHYSICAL_ESP", status: "FAILED", attemptNumber: 1 }) });
  });

  it("expires stale items and emits mobile status only", async () => {
    const f = fixture();
    await f.service.enqueue({ userId, deviceId, source: "WHATSAPP", sourceResourceType: "whatsapp_delivery", sourceResourceId: resourceId, idempotencyKey: "wa:key", expiresAt: new Date("2026-08-12T23:59:00Z") });
    expect(await f.service.expireStale()).toBe(1);
    expect(f.delivery.status).toBe("EXPIRED");
    expect(f.mobileEvents.sendToUser).toHaveBeenLastCalledWith(userId, expect.objectContaining({ event: "proactive_delivery_status", status: "EXPIRED" }));
  });

  it("represents mobile-only delivery durably without inventing a device identifier", async () => {
    const f = fixture();
    const result = await f.service.enqueue({ userId, source: "SCHEDULE", sourceResourceType: "schedule_run", sourceResourceId: resourceId, idempotencyKey: "mobile:key" });
    expect(result.deviceId).toBeUndefined();
    expect(result.status).toBe("PENDING");
    expect(f.mobileEvents.sendToUser).not.toHaveBeenCalled();
  });

  it("recovers an idempotent create race after the database unique constraint wins", async () => {
    const f = fixture();
    f.repositories.proactiveDelivery.create.mockRejectedValueOnce({ code: "P2002" });
    f.repositories.proactiveDelivery.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "race", userId, deviceId, source: "CHAT", sourceResourceId: resourceId });
    await expect(f.service.enqueue({ userId, deviceId, source: "CHAT", sourceResourceType: "chat", sourceResourceId: resourceId, idempotencyKey: "race:key" })).resolves.toMatchObject({ id: "race" });
  });
});
