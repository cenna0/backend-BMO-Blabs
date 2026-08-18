import { describe, expect, it, vi } from "vitest";

import * as crypto from "../../src/p9/crypto.js";
import { keyedDigest, sha256Hex } from "../../src/p9/crypto.js";
import { P9Error } from "../../src/p9/errors.js";
import { HardwareEnrollmentService } from "../../src/p9/services/hardware-enrollment.service.js";

const pepper = "pairing-pepper";
const token = "physical-device-token";
const now = new Date("2026-08-18T12:00:00.000Z");
const enrollment = {
  id: "enrollment-1",
  hardwareId: "bmo-001",
  tokenHash: sha256Hex(token),
  codeHash: keyedDigest("123456", pepper),
  status: "ISSUED",
  expiresAt: new Date("2026-08-18T12:10:00.000Z"),
  claimedAt: null,
  claimedUserId: null,
  claimedDeviceId: null,
  createdAt: now,
  updatedAt: now,
};

function fixture() {
  const hardwareEnrollment = {
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    count: vi.fn().mockResolvedValue(0),
    findFirst: vi.fn().mockResolvedValue(enrollment),
    create: vi.fn().mockResolvedValue(enrollment),
    update: vi.fn().mockResolvedValue(enrollment),
  };
  const device = {
    count: vi.fn().mockResolvedValue(0),
    findFirst: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({
      id: "device-1",
      userId: "user-1",
      hardwareId: "bmo-001",
      name: "BMO",
      status: "ACTIVE",
      pairedAt: now,
      lastSeenAt: null,
    }),
  };
  const transaction = {
    $executeRaw: vi.fn().mockResolvedValue(0),
    $queryRaw: vi.fn().mockResolvedValue([{ now }]),
    hardwareEnrollment,
    device,
    auditEvent: { create: vi.fn().mockResolvedValue({}) },
  };
  const client = {
    $transaction: vi.fn(async (work: (value: typeof transaction) => Promise<unknown>) => work(transaction)),
  };
  const hardwareEvents = { send: vi.fn().mockResolvedValue(true) };
  const service = new HardwareEnrollmentService({
    client: client as never,
    pepper,
    ttlSeconds: 600,
    hardwareEvents,
  });
  return { service, client, transaction, hardwareEnrollment, device, hardwareEvents };
}

describe("hardware enrollment service", () => {
  it("issues a durable enrollment from a trusted token digest without storing the raw token or code", async () => {
    const f = fixture();
    f.hardwareEnrollment.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    const result = await f.service.issueForHardware({ hardwareId: "bmo-001", tokenHash: sha256Hex(token) });
    expect(result).not.toBeNull();
    if (!result) throw new Error("expected enrollment");

    expect(result.code).toMatch(/^\d{6}$/);
    expect(f.hardwareEnrollment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        hardwareId: "bmo-001",
        tokenHash: sha256Hex(token),
        status: "ISSUED",
        expiresAt: expect.any(Date),
      }),
    });
    const createData = f.hardwareEnrollment.create.mock.calls[0]?.[0].data as Record<string, unknown>;
    expect(createData.codeHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(createData.codeHash).not.toBe(result.code);
    expect(JSON.stringify(createData)).not.toContain(token);
    expect(f.hardwareEnrollment.updateMany).toHaveBeenCalledWith({
      where: { hardwareId: "bmo-001", status: "ISSUED" },
      data: { status: "INVALIDATED" },
    });
  });

  it("does not issue a replacement when an active binding wins the race", async () => {
    const f = fixture();
    f.device.findFirst.mockResolvedValue({ id: "device-1" });

    await expect(f.service.issueForHardware({ hardwareId: "bmo-001", tokenHash: sha256Hex(token) }))
      .resolves.toBeNull();
    expect(f.hardwareEnrollment.create).not.toHaveBeenCalled();
  });

  it("treats both pending and active devices as enrollment blockers", async () => {
    const f = fixture();
    f.device.findFirst.mockResolvedValue({ id: "pending-device", status: "PENDING" });

    await expect(f.service.issueForHardware({ hardwareId: "bmo-001", tokenHash: sha256Hex(token) }))
      .resolves.toBeNull();
    expect(f.device.findFirst).toHaveBeenCalledWith({
      where: { hardwareId: "bmo-001", status: { in: ["PENDING", "ACTIVE"] } },
      select: { id: true },
    });
    expect(f.hardwareEnrollment.create).not.toHaveBeenCalled();
  });

  it("reclaims an expired issued code hash before collision handling", async () => {
    const f = fixture();
    let expiredRowIsVisible = true;
    const expiredRow = {
      ...enrollment,
      id: "expired-collision",
      expiresAt: new Date("2026-08-18T11:59:59.000Z"),
    };
    f.hardwareEnrollment.findFirst.mockImplementation(async (args: { where?: { codeHash?: string } }) => {
      if (args.where?.codeHash) return expiredRowIsVisible ? expiredRow : null;
      return null;
    });
    f.hardwareEnrollment.updateMany.mockImplementation(async (args: { where?: { codeHash?: string } }) => {
      if (args.where?.codeHash) expiredRowIsVisible = false;
      return { count: 1 };
    });

    const result = await f.service.issueForHardware({ hardwareId: "bmo-001", tokenHash: sha256Hex(token) });

    expect(result).not.toBeNull();
    expect(f.hardwareEnrollment.updateMany).toHaveBeenCalledWith({
      where: {
        codeHash: expect.any(String),
        status: "ISSUED",
        expiresAt: { lte: now },
      },
      data: { status: "EXPIRED" },
    });
    expect(f.hardwareEnrollment.create).toHaveBeenCalledTimes(1);
  });

  it("does not treat claimed or invalidated rows as active code collisions", async () => {
    const f = fixture();
    const collisionQueries: unknown[] = [];
    f.hardwareEnrollment.findFirst.mockImplementation(async (args: { where?: { codeHash?: string; status?: string } }) => {
      if (args.where?.codeHash) {
        collisionQueries.push(args.where);
        return null;
      }
      return null;
    });

    const result = await f.service.issueForHardware({ hardwareId: "bmo-001", tokenHash: sha256Hex(token) });

    expect(result).not.toBeNull();
    expect(collisionQueries).toEqual([{ codeHash: expect.any(String), status: "ISSUED" }]);
    expect(f.hardwareEnrollment.create).toHaveBeenCalledTimes(1);
  });

  it("retries a code collision without exposing or persisting the colliding code", async () => {
    const f = fixture();
    f.hardwareEnrollment.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "collision" })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    const result = await f.service.issueForHardware({ hardwareId: "bmo-001", tokenHash: sha256Hex(token) });
    expect(result).not.toBeNull();
    if (!result) throw new Error("expected enrollment");

    expect(result.code).toMatch(/^\d{6}$/u);
    expect(f.client.$transaction).toHaveBeenCalledTimes(2);
    expect(f.hardwareEnrollment.create).toHaveBeenCalledTimes(1);
  });

  it("rate-limits hardware reissue without adding per-enrollment attempt state", async () => {
    const f = fixture();
    f.hardwareEnrollment.count.mockResolvedValue(6);

    await expect(f.service.issueForHardware({ hardwareId: "bmo-001", tokenHash: sha256Hex(token) }))
      .rejects.toMatchObject({ code: "RATE_LIMITED", status: 429 } satisfies Partial<P9Error>);
    expect(f.hardwareEnrollment.create).not.toHaveBeenCalled();
  });

  it("enforces the five-second hardware reissue cooldown deterministically", async () => {
    const f = fixture();
    f.hardwareEnrollment.findFirst.mockResolvedValue({ createdAt: now });

    await expect(f.service.issueForHardware({ hardwareId: "bmo-001", tokenHash: sha256Hex(token) }))
      .rejects.toMatchObject({ code: "RATE_LIMITED", status: 429 } satisfies Partial<P9Error>);
    expect(f.hardwareEnrollment.create).not.toHaveBeenCalled();
  });

  it("retries a replacement when generation repeats the immediately previous code", async () => {
    const f = fixture();
    const previous = {
      ...enrollment,
      createdAt: new Date(now.getTime() - 10_000),
      codeHash: keyedDigest("123456", pepper),
    };
    f.hardwareEnrollment.findFirst.mockImplementation(async (args: { where?: { codeHash?: string } }) => {
      if (args.where?.codeHash) return null;
      return previous;
    });
    const createPairingCode = vi.spyOn(crypto, "createPairingCode")
      .mockReturnValueOnce("123456")
      .mockReturnValueOnce("654321");

    const result = await f.service.issueForHardware({ hardwareId: "bmo-001", tokenHash: sha256Hex(token) });

    expect(result).toMatchObject({ code: "654321" });
    expect(createPairingCode).toHaveBeenCalledTimes(2);
    const invalidations = f.hardwareEnrollment.updateMany.mock.calls.filter(
      ([args]) => "hardwareId" in (args as { where: Record<string, unknown> }).where,
    );
    expect(invalidations).toHaveLength(1);
    expect(f.hardwareEnrollment.updateMany).toHaveBeenCalledWith({
      where: { hardwareId: "bmo-001", status: "ISSUED" },
      data: { status: "INVALIDATED" },
    });
    createPairingCode.mockRestore();
  });

  it("claims using only the server-owned enrollment identity and not Mobile credentials", async () => {
    const f = fixture();
    const device = await f.service.claim("user-1", { code: "123456" }, "request-1");

    expect(device).toMatchObject({ id: "device-1", hardwareId: "bmo-001", name: "BMO" });
    expect(f.device.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "user-1",
        hardwareId: "bmo-001",
        tokenHash: sha256Hex(token),
        name: "BMO",
      }),
    });
    expect(f.hardwareEvents.send).toHaveBeenCalledWith("bmo-001", {
      event: "pairing_completed",
      status: "ok",
    });
  });

  it("uses database time obtained after the hardware lock for the expiry boundary", async () => {
    const f = fixture();
    const beforeLock = new Date("2026-08-18T12:00:00.000Z");
    const afterLock = new Date("2026-08-18T12:00:01.000Z");
    const boundaryEnrollment = {
      ...enrollment,
      expiresAt: new Date("2026-08-18T12:00:00.500Z"),
    };
    let clockCalls = 0;
    f.transaction.$queryRaw.mockImplementation(async () => {
      clockCalls += 1;
      return [{ now: clockCalls === 1 ? afterLock : beforeLock }];
    });
    f.transaction.$executeRaw.mockImplementation(async () => {
      expect(clockCalls).toBe(0);
      return 0;
    });
    f.hardwareEnrollment.findFirst.mockResolvedValue(boundaryEnrollment);

    await expect(f.service.claim("user-1", { code: "123456" }, "request-1"))
      .rejects.toMatchObject({
        code: "PAIRING_CODE_INVALID_OR_EXPIRED",
        status: 409,
      } satisfies Partial<P9Error>);
    expect(clockCalls).toBe(1);
    expect(f.device.create).not.toHaveBeenCalled();
  });

  it("rejects unknown codes with the generic conflict code", async () => {
    const f = fixture();
    f.hardwareEnrollment.findFirst.mockResolvedValue(null);

    await expect(f.service.claim("user-1", { code: "999999" }, "request-1"))
      .rejects.toMatchObject({
        code: "PAIRING_CODE_INVALID_OR_EXPIRED",
        status: 409,
      } satisfies Partial<P9Error>);
  });

  it("expires an old enrollment and keeps the error generic", async () => {
    const f = fixture();
    let committed = false;
    let persistedStatus = "ISSUED";
    f.client.$transaction.mockImplementation(async (work: (value: typeof f.transaction) => Promise<unknown>) => {
      const result = await work(f.transaction);
      committed = true;
      return result;
    });
    f.hardwareEnrollment.updateMany.mockImplementation(async () => {
      persistedStatus = "EXPIRED";
      return { count: 1 };
    });
    f.hardwareEnrollment.findFirst
      .mockResolvedValueOnce({ ...enrollment, expiresAt: new Date("2026-08-18T11:59:59.000Z") })
      .mockResolvedValueOnce({ ...enrollment, expiresAt: new Date("2026-08-18T11:59:59.000Z") });

    await expect(f.service.claim("user-1", { code: "123456" }))
      .rejects.toMatchObject({ code: "PAIRING_CODE_INVALID_OR_EXPIRED", status: 409 } satisfies Partial<P9Error>);
    expect(f.hardwareEnrollment.updateMany).toHaveBeenCalledWith({
      where: { id: "enrollment-1", status: "ISSUED" },
      data: { status: "EXPIRED" },
    });
    expect(committed).toBe(true);
    expect(persistedStatus).toBe("EXPIRED");
  });
});
