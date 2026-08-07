import { describe, expect, it } from "vitest";

import {
  buildRestoreEvidenceQueries,
  validateApplicationEvidence,
} from "../../src/p9/operator/restore-evidence.js";

interface PairingFixture {
  status: string;
  userId: string;
  deviceId: string | null;
}

interface DeviceFixture {
  id: string;
  userId: string;
}

function pairing(status: string, deviceId: string | null, userId = "user-a"): PairingFixture {
  return { status, userId, deviceId };
}

function countBrokenPopulatedReferences(pairings: PairingFixture[], devices: DeviceFixture[]): number {
  return pairings.filter((entry) => entry.deviceId !== null && !devices.some((device) => device.id === entry.deviceId && device.userId === entry.userId)).length;
}

function countLegacyOrphans(pairings: PairingFixture[], devices: DeviceFixture[]): number {
  return pairings.filter((entry) => !devices.some((device) => device.id === entry.deviceId)).length;
}

function realShapeFixture(): { pairings: PairingFixture[]; devices: DeviceFixture[] } {
  const claimed = Array.from({ length: 12 }, (_, index) => pairing("CLAIMED", `device-${index}`, `user-${index}`));
  return {
    pairings: [
      ...Array.from({ length: 5 }, () => pairing("ISSUED", null)),
      ...Array.from({ length: 9 }, () => pairing("FAILED", null)),
      pairing("EXPIRED", null),
      ...Array.from({ length: 4 }, () => pairing("INVALIDATED", null)),
      ...claimed,
    ],
    devices: claimed.map((entry) => ({ id: entry.deviceId as string, userId: entry.userId })),
  };
}

describe("P9 restore evidence helpers", () => {
  it("defines read-only sanitized queries for every acceptance evidence category", () => {
    const queries = buildRestoreEvidenceQueries();
    const text = queries.map((query) => query.sql).join("\n");

    expect(queries.map((query) => query.name)).toEqual(expect.arrayContaining([
      "migrations",
      "schema",
      "entity-counts",
      "orphan-checks",
      "argon2id-password-format",
      "lifecycle-states",
      "settings-invariants",
      "audit-summary",
    ]));
    expect(text).not.toMatch(/password\s*[:=]\s*[^\s)]/i);
    expect(text).not.toMatch(/postgres(?:ql)?:\/\/[^\s]+/i);
    expect(text).toContain("passwordHash");
    expect(text).toContain("metadata::text");
    expect(text).toContain('DISTINCT "eventType"');
    expect(text).not.toContain("synthetic");
    for (const entity of [
      "User", "PasswordCredential", "AuthIdentity", "Invitation", "Session", "RefreshToken",
      "Device", "DevicePairing", "UserSettings", "DeviceSettings", "AuditEvent",
    ]) {
      expect(text).toContain(`FROM "${entity}"`);
    }
  });

  it("accepts only successful application/login/readiness evidence", () => {
    expect(validateApplicationEvidence({ loginStatus: 200, meStatus: 200, opsReadyStatus: 200 })).toEqual({
      loginStatus: 200,
      meStatus: 200,
      opsReadyStatus: 200,
    });
    expect(() => validateApplicationEvidence({ loginStatus: 401, meStatus: 200, opsReadyStatus: 200 })).toThrow();
    expect(() => validateApplicationEvidence({ loginStatus: 200, meStatus: 500, opsReadyStatus: 200 })).toThrow();
  });

  it("counts only broken populated pairing references using composite ownership", () => {
    const orphanQuery = buildRestoreEvidenceQueries().find((query) => query.name === "orphan-checks")?.sql ?? "";

    expect(orphanQuery).toContain('p."deviceId" IS NOT NULL');
    expect(orphanQuery).toContain('d."userId" = p."userId"');
    expect(orphanQuery).not.toContain('LEFT JOIN "Device" d ON d.id = p."deviceId" WHERE d.id IS NULL');
    expect(orphanQuery).toContain('(SELECT COUNT(*)::int FROM "Device" d LEFT JOIN "User" u ON u.id = d."userId" WHERE u.id IS NULL) AS "orphanDevices"');
    expect(orphanQuery).toContain('(SELECT COUNT(*)::int FROM "Device" d LEFT JOIN "User" u ON u.id = d."userId" WHERE u.id IS NULL) AS "orphanOwnership"');
  });

  it("does not count a NULL ISSUED pairing as broken", () => {
    expect(countBrokenPopulatedReferences([pairing("ISSUED", null)], [])).toBe(0);
  });

  it("does not count a NULL FAILED pairing as broken", () => {
    expect(countBrokenPopulatedReferences([pairing("FAILED", null)], [])).toBe(0);
  });

  it("does not count NULL EXPIRED or INVALIDATED pairings as broken", () => {
    expect(countBrokenPopulatedReferences([
      pairing("EXPIRED", null),
      pairing("INVALIDATED", null),
    ], [])).toBe(0);
  });

  it("does not count a CLAIMED pairing with a matching composite device", () => {
    expect(countBrokenPopulatedReferences(
      [pairing("CLAIMED", "device-1", "user-a")],
      [{ id: "device-1", userId: "user-a" }],
    )).toBe(0);
  });

  it("counts a populated pairing whose device is missing", () => {
    expect(countBrokenPopulatedReferences([pairing("CLAIMED", "missing-device")], [])).toBe(1);
  });

  it("counts a populated pairing whose device owner does not match", () => {
    expect(countBrokenPopulatedReferences(
      [pairing("CLAIMED", "device-1", "user-a")],
      [{ id: "device-1", userId: "user-b" }],
    )).toBe(1);
  });

  it("matches the real 31-pairing shape with zero broken populated references", () => {
    const { pairings, devices } = realShapeFixture();

    expect(pairings).toHaveLength(31);
    expect(pairings.filter((entry) => entry.deviceId === null)).toHaveLength(19);
    expect(pairings.filter((entry) => entry.deviceId !== null)).toHaveLength(12);
    expect(countBrokenPopulatedReferences(pairings, devices)).toBe(0);
  });

  it("shows the legacy NULL-sensitive query would report 19", () => {
    const { pairings, devices } = realShapeFixture();

    expect(countLegacyOrphans(pairings, devices)).toBe(19);
  });
});
