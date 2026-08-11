import { describe, expect, it, vi } from "vitest";

import { sha256Hex } from "../../src/p9/crypto.js";
import { RecoveryService } from "../../src/p9/services/recovery.service.js";

interface RecoveryRow {
  id: string;
  userId: string;
  tokenVerifier: string;
  expiresAt: Date;
  usedAt: Date | null;
  attemptCount: number;
  maxAttempts: number;
  lastAttemptAt: Date | null;
}

function fixture() {
  const user = {
    id: "00000000-0000-4000-8000-000000000010",
    dateOfBirth: new Date("2004-05-19T00:00:00.000Z"),
  };
  const recoveries: RecoveryRow[] = [];
  const auditEvents: unknown[] = [];
  const transaction = {
    $executeRaw: vi.fn().mockResolvedValue(1),
    $queryRaw: vi.fn().mockResolvedValue([{ now: new Date("2026-08-11T12:00:30.000Z") }]),
    passwordRecovery: {
      findUnique: vi.fn(async ({ where }: any) => recoveries.find((row) => row.tokenVerifier === where.tokenVerifier) ?? null),
      create: vi.fn(async ({ data }: any) => {
        const row: RecoveryRow = {
          id: `recovery-${recoveries.length + 1}`,
          userId: data.userId,
          tokenVerifier: data.tokenVerifier,
          expiresAt: data.expiresAt,
          usedAt: null,
          attemptCount: 0,
          maxAttempts: data.maxAttempts,
          lastAttemptAt: null,
        };
        recoveries.push(row);
        return row;
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const candidates = recoveries.filter((row) => {
          if (typeof where.id === "string" && row.id !== where.id) return false;
          if (where.userId !== undefined && row.userId !== where.userId) return false;
          if (where.id?.not !== undefined && row.id === where.id.not) return false;
          if (where.usedAt === null && row.usedAt !== null) return false;
          if (where.expiresAt?.gt && row.expiresAt <= where.expiresAt.gt) return false;
          if (where.attemptCount?.lt !== undefined && row.attemptCount >= where.attemptCount.lt) return false;
          return true;
        });
        for (const row of candidates) {
          if (data.usedAt !== undefined) row.usedAt = data.usedAt;
          if (data.lastAttemptAt !== undefined) row.lastAttemptAt = data.lastAttemptAt;
          if (data.attemptCount?.increment) row.attemptCount += data.attemptCount.increment;
        }
        return { count: candidates.length };
      }),
    },
    passwordCredential: { update: vi.fn().mockResolvedValue({}) },
    session: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    refreshToken: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    auditEvent: { create: vi.fn(async (value) => { auditEvents.push(value); return {}; }) },
  };
  const repositories = {
    user: { findUnique: vi.fn().mockResolvedValue(user) },
    passwordRecovery: { findUnique: vi.fn().mockResolvedValue(null) },
    auditEvent: { create: vi.fn(async (value) => { auditEvents.push(value); return {}; }) },
  };
  let locked = false;
  let activeLocks = 0;
  let peakLocks = 0;
  let lockWaits = 0;
  const lockWaiters: Array<() => void> = [];
  const acquireLock = async () => {
    if (locked) {
      lockWaits += 1;
      await new Promise<void>((resolve) => { lockWaiters.push(resolve); });
    } else {
      locked = true;
    }
    activeLocks += 1;
    peakLocks = Math.max(peakLocks, activeLocks);
  };
  const releaseLock = () => {
    activeLocks -= 1;
    const next = lockWaiters.shift();
    if (next) next();
    else locked = false;
  };
  const client = {
    $transaction: async (work: any) => {
      let holdsUserLock = false;
      const lockAwareTransaction = {
        ...transaction,
        $executeRaw: async (...args: unknown[]) => {
          await acquireLock();
          holdsUserLock = true;
          return transaction.$executeRaw(...args);
        },
      };
      try {
        return await work(lockAwareTransaction);
      } finally {
        if (holdsUserLock) releaseLock();
      }
    },
  };
  return {
    auditEvents,
    recoveries,
    repositories,
    transaction,
    lockStats: () => ({ active: activeLocks, peak: peakLocks, waits: lockWaits }),
    service: new RecoveryService(
      client as any,
      repositories as any,
      { ttlSeconds: 600, maxAttempts: 5 },
    ),
    user,
  };
}

describe("password recovery token epochs", () => {
  it("serializes issuance and makes only the newest of two tokens usable without persisting either secret", async () => {
    const f = fixture();
    const [first, second] = await Promise.all([
      f.service.verify({ email: "p@example.com", dateOfBirth: "2004-05-19" }, {
        now: new Date("2026-08-11T12:00:00.000Z"), requestId: "verify-1",
      }),
      f.service.verify({ email: "p@example.com", dateOfBirth: "2004-05-19" }, {
        now: new Date("2026-08-11T12:01:00.000Z"), requestId: "verify-2",
      }),
    ]);

    expect(f.transaction.$executeRaw).toHaveBeenCalledTimes(2);
    expect(f.lockStats()).toMatchObject({ active: 0, peak: 1, waits: 1 });
    expect(f.recoveries).toHaveLength(2);
    const resultsByVerifier = new Map([
      [sha256Hex(first.recoveryToken), first],
      [sha256Hex(second.recoveryToken), second],
    ]);
    const older = resultsByVerifier.get(f.recoveries[0]!.tokenVerifier)!;
    const replacement = resultsByVerifier.get(f.recoveries[1]!.tokenVerifier)!;
    expect(f.recoveries[0]).toMatchObject({ usedAt: expect.any(Date) });
    expect(f.recoveries[1]).toMatchObject({ usedAt: null });
    expect(JSON.stringify({ recoveries: f.recoveries, auditEvents: f.auditEvents })).not.toContain(first.recoveryToken);
    expect(JSON.stringify({ recoveries: f.recoveries, auditEvents: f.auditEvents })).not.toContain(second.recoveryToken);

    await expect(f.service.reset({ recoveryToken: older.recoveryToken, newPassword: "first-replacement-password" }, {
      now: new Date("2026-08-11T12:02:00.000Z"), requestId: "reset-old",
    })).rejects.toMatchObject({ code: "RECOVERY_INVALID" });
    await expect(f.service.reset({ recoveryToken: replacement.recoveryToken, newPassword: "second-replacement-password" }, {
      now: new Date("2026-08-11T12:02:01.000Z"), requestId: "reset-new",
    })).resolves.toBeUndefined();
    await expect(f.service.reset({ recoveryToken: replacement.recoveryToken, newPassword: "replayed-replacement-password" }, {
      now: new Date("2026-08-11T12:02:02.000Z"), requestId: "reset-replay",
    })).rejects.toMatchObject({ code: "RECOVERY_INVALID" });
  });

  it("invalidates every unused sibling after claiming the presented token and audits denial without secrets", async () => {
    const f = fixture();
    const replacement = await f.service.verify({ email: "p@example.com", dateOfBirth: "2004-05-19" }, {
      now: new Date("2026-08-11T12:00:00.000Z"), requestId: "verify-current",
    });
    const siblingToken = "opaque-sibling-token";
    f.recoveries.push({
      id: "recovery-sibling",
      userId: f.user.id,
      tokenVerifier: sha256Hex(siblingToken),
      expiresAt: new Date("2026-08-11T12:10:00.000Z"),
      usedAt: null,
      attemptCount: 0,
      maxAttempts: 5,
      lastAttemptAt: null,
    });

    await f.service.reset({ recoveryToken: replacement.recoveryToken, newPassword: "replacement-password-long" }, {
      now: new Date("2026-08-11T12:03:00.000Z"), requestId: "reset-current",
    });
    expect(f.recoveries.find((row) => row.id === "recovery-sibling")?.usedAt)
      .toEqual(new Date("2026-08-11T12:03:00.000Z"));
    await expect(f.service.reset({ recoveryToken: siblingToken, newPassword: "sibling-password-long" }, {
      now: new Date("2026-08-11T12:03:01.000Z"), requestId: "reset-sibling",
    })).rejects.toMatchObject({ code: "RECOVERY_INVALID" });

    const denial = f.auditEvents.find((event: any) => event.data?.eventType === "PASSWORD_RESET_FAILED") as any;
    expect(denial?.data).toMatchObject({
      eventType: "PASSWORD_RESET_FAILED",
      outcome: "denied",
      requestId: "reset-sibling",
    });
    expect(JSON.stringify(denial)).not.toContain(siblingToken);
    expect(JSON.stringify(denial)).not.toContain("2004-05-19");
    expect(JSON.stringify(denial)).not.toContain("p@example.com");
  });

  it("uses the post-lock database clock unless a deterministic test clock is explicit", async () => {
    const f = fixture();
    const issued = await f.service.verify({ email: "p@example.com", dateOfBirth: "2004-05-19" }, {
      requestId: "db-clock",
    });
    expect(f.transaction.$queryRaw).toHaveBeenCalledOnce();
    expect(issued.expiresAt).toEqual(new Date("2026-08-11T12:10:30.000Z"));
    expect(f.transaction.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      f.transaction.$queryRaw.mock.invocationCallOrder[0]!,
    );
  });
});
