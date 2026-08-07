import { describe, expect, it } from "vitest";

import {
  classifyAcceptanceDelta,
  emptyAcceptanceCounts,
  type AcceptanceCounts,
} from "../../src/p9/operator/acceptance-evidence.js";

function counts(overrides: Partial<AcceptanceCounts> = {}): AcceptanceCounts {
  return { ...emptyAcceptanceCounts(), ...overrides };
}

describe("P9 restored-target acceptance mutation evidence", () => {
  it("categorizes the four-row synthetic fixture creation delta", () => {
    const before = counts();
    const after = counts({ User: 1, PasswordCredential: 1, AuthIdentity: 1, UserSettings: 1 });

    expect(classifyAcceptanceDelta("fixture-create", before, after)).toMatchObject({
      phase: "fixture-create",
      ok: true,
      delta: expect.objectContaining({ User: 1, PasswordCredential: 1, AuthIdentity: 1, UserSettings: 1 }),
      unexpected: [],
    });
  });

  it("categorizes one real login session, refresh token, and success audit", () => {
    const before = counts({ User: 1, PasswordCredential: 1, AuthIdentity: 1, UserSettings: 1 });
    const after = counts({ User: 1, PasswordCredential: 1, AuthIdentity: 1, UserSettings: 1, Session: 1, RefreshToken: 1, AuditEvent: 1 });

    expect(classifyAcceptanceDelta("login", before, after).ok).toBe(true);
  });

  it("requires cleanup to return every tracked aggregate to the pre-fixture baseline", () => {
    const before = counts({ User: 1, PasswordCredential: 1, AuthIdentity: 1, UserSettings: 1, Session: 1, RefreshToken: 1, AuditEvent: 1 });

    expect(classifyAcceptanceDelta("cleanup", before, counts()).ok).toBe(true);
  });

  it("rejects an unexpected mutation in any tracked table", () => {
    const before = counts();
    const after = counts({ User: 1, Device: 1 });
    const result = classifyAcceptanceDelta("fixture-create", before, after);

    expect(result.ok).toBe(false);
    expect(result.unexpected.some((entry) => entry.startsWith("Device:+1"))).toBe(true);
  });
});
