import { describe, expect, it, vi } from "vitest";

import { P9Error } from "../../src/p9/errors.js";
import { ScheduleService } from "../../src/p9/services/schedule.service.js";

const userId = "00000000-0000-4000-8000-000000000001";
const scheduleId = "00000000-0000-4000-8000-000000000002";
const deviceId = "00000000-0000-4000-8000-000000000003";

function record(overrides: Record<string, unknown> = {}) {
  return { id: scheduleId, userId, targetDeviceId: deviceId, status: "ACTIVE", timezone: "Asia/Jakarta", recurrence: { frequency: "Daily", every: 1, timeOfDay: "Morning" }, payload: { prompt: "Stand", deliveryTargets: ["DEVICE"] }, nextRunAt: new Date("2026-08-14T02:00:00Z"), version: 1, cancelledAt: null, completedAt: null, createdAt: new Date("2026-08-13T00:00:00Z"), updatedAt: new Date("2026-08-13T00:00:00Z"), ...overrides };
}

function fixture(current = record()) {
  let value = current;
  const repositories: any = {
    databaseNow: vi.fn().mockResolvedValue(new Date("2026-08-13T00:00:00Z")),
    device: { findFirst: vi.fn().mockResolvedValue({ id: deviceId }) },
    schedule: {
      create: vi.fn(async ({ data }: any) => ({ ...record(), ...data })),
      findFirst: vi.fn(async () => value),
      findMany: vi.fn().mockResolvedValue([value]),
      updateMany: vi.fn(async ({ where, data }: any) => {
        if (where.version !== value.version || (typeof where.status === "string" ? where.status !== value.status : where.status?.in && !where.status.in.includes(value.status))) return { count: 0 };
        value = { ...value, ...data, version: value.version + 1 }; return { count: 1 };
      }),
    },
    scheduleRun: { findMany: vi.fn().mockResolvedValue([]) },
    auditEvent: { create: vi.fn().mockResolvedValue({}) },
  };
  repositories.$queryRaw = vi.fn().mockResolvedValue([{ now: new Date("2026-08-13T00:00:00Z") }]);
  const client: any = { $transaction: vi.fn(async (fn: any) => fn(repositories)) };
  return { service: new ScheduleService({ client, repositories, mobileEvents: { sendToUser: vi.fn() } }), repositories, get value() { return value; } };
}

describe("ScheduleService", () => {
  it("validates target device ownership and persists normalized schedule", async () => {
    const f = fixture();
    const created = await f.service.create(userId, { prompt: "Stand", frequency: "Daily", every: 1, timeOfDay: "Morning", deliveryTargets: ["DEVICE"], deviceId }, "request-1");
    expect(created).toMatchObject({ timezone: "Asia/Jakarta", status: "ACTIVE", statusLabel: "MONITORING" });
    expect(f.repositories.device.findFirst).toHaveBeenCalledWith({ where: { id: deviceId, userId, status: "ACTIVE" }, select: { id: true } });
    expect(f.repositories.auditEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ requestId: "request-1", userId, resourceType: "schedule" }) });
  });

  it("rejects stale concurrent mutations and illegal transitions", async () => {
    const f = fixture();
    await f.service.pause(userId, scheduleId, 1);
    await expect(f.service.pause(userId, scheduleId, 1)).rejects.toMatchObject({ code: "CONFLICT", status: 409 } satisfies Partial<P9Error>);
    await expect(f.service.resume(userId, scheduleId, 1)).rejects.toMatchObject({ code: "CONFLICT" } satisfies Partial<P9Error>);
  });

  it("uses updatedAt/id deterministic pagination and owner-scopes run queries", async () => {
    const f = fixture();
    await f.service.list(userId, { limit: 20, cursor: "2026-08-13T00:00:00.000Z|00000000-0000-4000-8000-000000000009" });
    expect(f.repositories.schedule.findMany).toHaveBeenCalledWith(expect.objectContaining({ orderBy: [{ updatedAt: "desc" }, { id: "asc" }], take: 21 }));
    await f.service.listRuns(userId, { limit: 10, scheduleId });
    expect(f.repositories.scheduleRun.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { schedule: { userId }, scheduleId } }));
  });

  it("advances recurring schedules and completes one-shot schedules conditionally", async () => {
    const daily = fixture();
    await daily.service.advanceOccurrence(scheduleId, new Date("2026-08-14T02:00:00Z"), { frequency: "Daily", every: 1, timeOfDay: "Morning" });
    expect(daily.repositories.schedule.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ nextRunAt: new Date("2026-08-14T02:00:00Z") }), data: expect.objectContaining({ nextRunAt: new Date("2026-08-15T02:00:00Z") }) }));
    const once = fixture(record({ recurrence: { frequency: "Once", every: 1, date: "2026-08-14", timeOfDay: "Morning" } }));
    await once.service.advanceOccurrence(scheduleId, new Date("2026-08-14T02:00:00Z"), { frequency: "Once", every: 1, date: "2026-08-14", timeOfDay: "Morning" });
    expect(once.repositories.schedule.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "COMPLETED", nextRunAt: null }) }));
  });
});
