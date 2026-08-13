import { describe, expect, it, vi } from "vitest";

import { P9Repositories } from "../../src/p9/db/repositories.js";

describe("schedule due-run PostgreSQL boundary", () => {
  it("materializes unique due occurrences using the DB clock", async () => {
    const query = vi.fn().mockResolvedValue([{ id: "run", scheduleId: "schedule", dueAt: new Date(), userId: "user", targetDeviceId: null, recurrence: {}, payload: {} }]);
    const repositories = new P9Repositories({ $queryRaw: query } as any);
    const rows = await repositories.materializeDueScheduleRuns({ limit: 10, missedAfterMs: 300_000 });
    expect(rows).toHaveLength(1);
    expect(String(query.mock.calls[0]?.[0]?.[0])).toContain("clock_timestamp()");
    expect(String(query.mock.calls[0]?.[0]?.join(""))).toContain('ON CONFLICT ("scheduleId", "dueAt") DO UPDATE');
  });

  it("atomically claims eligible runs with expiring leases", async () => {
    const query = vi.fn().mockResolvedValue([{ id: "run" }]);
    const repositories = new P9Repositories({ $queryRaw: query } as any);
    expect(await repositories.claimScheduleRuns({ workerId: "worker-1", limit: 4, leaseMs: 30_000 })).toEqual([{ id: "run" }]);
    const sql = String(query.mock.calls[0]?.[0]?.[0]) + String(query.mock.calls[0]?.[0]?.join(""));
    expect(sql).toContain("FOR UPDATE OF run SKIP LOCKED");
    expect(sql).toContain("leaseExpiresAt");
    expect(sql).toContain("retryAt");
  });

  it("claims proactive items atomically and excludes another active item per device", async () => {
    const query = vi.fn().mockResolvedValue([{ id: "delivery" }]);
    const repositories = new P9Repositories({ $queryRaw: query } as any);
    expect(await repositories.claimProactiveDelivery({ deliveryId: "00000000-0000-4000-8000-000000000001" })).toEqual([{ id: "delivery" }]);
    const sql = String(query.mock.calls[0]?.[0]?.join(""));
    expect(sql).toContain("FOR UPDATE SKIP LOCKED");
    expect(sql).toContain("active.status IN ('READY', 'DELIVERING')");
    expect(sql).toContain("clock_timestamp()");
  });

  it("materializes overdue occurrences as missed with a terminal deadline code", async () => {
    const query = vi.fn().mockResolvedValue([{ id: "run" }]);
    const repositories = new P9Repositories({ $queryRaw: query } as any);
    await repositories.materializeMissedScheduleRuns({ limit: 10, missedAfterMs: 300_000 });
    const sql = String(query.mock.calls[0]?.[0]?.join(""));
    expect(sql).toContain("DELIVERY_DEADLINE_EXCEEDED");
    expect(sql).toContain("clock_timestamp()");
    expect(sql).toContain("FOR UPDATE SKIP LOCKED");
  });
});
