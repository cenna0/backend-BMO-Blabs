import { describe, expect, it } from "vitest";

import {
  buildRestoreEvidenceQueries,
  validateApplicationEvidence,
} from "../../src/p9/operator/restore-evidence.js";

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
});
