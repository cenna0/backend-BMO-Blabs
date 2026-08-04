import { describe, expect, it } from "vitest";

import { sanitizeAuditMetadata } from "../../src/p9/services/audit.service.js";

describe("P9 audit redaction", () => {
  it("removes secrets and private content while retaining safe metadata", () => {
    expect(
      sanitizeAuditMetadata({
        outcome: "success",
        email: "person@example.com",
        password: "do-not-store",
        passwordHash: "do-not-store",
        accessToken: "do-not-store",
        refreshToken: "do-not-store",
        invitationSecret: "do-not-store",
        pairingCode: "123456",
        message: "private content",
        requestId: "req-123",
        count: 2,
      }),
    ).toEqual({
      outcome: "success",
      email: "person@example.com",
      requestId: "req-123",
      count: 2,
    });
  });

  it("rejects oversized and nested metadata instead of serializing secrets", () => {
    expect(sanitizeAuditMetadata({ nested: { password: "secret" }, array: ["private"] })).toEqual({});
    expect(sanitizeAuditMetadata({ note: "a".repeat(1000) })).toEqual({});
  });
});
