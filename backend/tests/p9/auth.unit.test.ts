import { describe, expect, it } from "vitest";

import { publicUser } from "../../src/p9/services/user.service.js";

describe("P9 safe user projection", () => {
  it("does not expose credentials, identities, or secret-bearing fields", () => {
    expect(
      publicUser({
        id: "user-1",
        email: "person@example.com",
        displayName: null,
        createdAt: new Date("2026-08-04T00:00:00.000Z"),
        passwordCredential: { passwordHash: "hash" },
        identities: [{ provider: "password", providerSubject: "subject" }],
      }),
    ).toEqual({
      id: "user-1",
      email: "person@example.com",
      displayName: null,
      createdAt: "2026-08-04T00:00:00.000Z",
    });
  });
});
