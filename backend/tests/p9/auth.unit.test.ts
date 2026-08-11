import { describe, expect, it } from "vitest";

import { publicUser } from "../../src/p9/services/user.service.js";

describe("P9 safe user projection", () => {
  it("does not expose credentials, identities, or secret-bearing fields", () => {
    const userRecord = {
      id: "user-1",
      email: "person@example.com",
      displayName: null,
      username: "person",
      avatarKey: "4f37e5f8-a53a-4d18-8f9a-7b6e5cb8c003",
      dateOfBirth: new Date("2004-05-19T00:00:00.000Z"),
      createdAt: new Date("2026-08-04T00:00:00.000Z"),
      passwordCredential: { passwordHash: "hash" },
      identities: [{ provider: "password", providerSubject: "subject" }],
    };

    expect(publicUser(userRecord, "https://api.example.com/")).toEqual({
      id: "user-1",
      email: "person@example.com",
      displayName: null,
      username: "person",
      avatarUrl: "https://api.example.com/media/avatars/4f37e5f8-a53a-4d18-8f9a-7b6e5cb8c003.webp",
      createdAt: "2026-08-04T00:00:00.000Z",
    });
    expect(JSON.stringify(publicUser(userRecord, "https://api.example.com"))).not.toContain("dateOfBirth");
  });
});
