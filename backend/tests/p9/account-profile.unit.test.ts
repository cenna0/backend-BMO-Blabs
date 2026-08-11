import { describe, expect, it } from "vitest";

import {
  parseDateOfBirth,
  parsePersonalizationPatch,
  parseProfilePatch,
  parseRegistration,
} from "../../src/p9/validation.js";

describe("Phase 2B account validation", () => {
  it("accepts an exact non-future calendar DOB and normalizes self-service registration", () => {
    expect(parseRegistration({
      email: " Person@Example.COM ",
      password: "correct horse battery staple",
      displayName: " Person ",
      dateOfBirth: "2004-02-29",
    }, new Date("2026-08-11T12:00:00.000Z"))).toMatchObject({
      email: "person@example.com",
      displayName: "Person",
      dateOfBirth: new Date("2004-02-29T00:00:00.000Z"),
    });
  });

  it.each(["2004-02-30", "2004-2-09", "not-a-date", "2026-08-12"])(
    "rejects invalid or future DOB %s",
    (dateOfBirth) => {
      expect(() => parseDateOfBirth(dateOfBirth, new Date("2026-08-11T12:00:00.000Z"))).toThrow();
    },
  );

  it("rejects missing DOB, short password, and unknown registration ownership fields", () => {
    expect(() => parseRegistration({ email: "p@example.com", password: "short" })).toThrow();
    expect(() => parseRegistration({
      email: "person@example.com",
      password: "correct horse battery staple",
      dateOfBirth: "2004-05-19",
      userId: "attacker-selected",
    })).toThrow();
  });

  it("normalizes username and implements bounded nullable display-name semantics", () => {
    expect(parseProfilePatch({ username: "  User.Name_1 ", displayName: null })).toEqual({
      username: "user.name_1",
      displayName: null,
    });
    expect(() => parseProfilePatch({})).toThrow();
    expect(() => parseProfilePatch({ username: "no spaces" })).toThrow();
    expect(() => parseProfilePatch({ username: "ab" })).toThrow();
    expect(() => parseProfilePatch({ userId: "other" })).toThrow();
  });

  it("accepts only bounded canonical personalization fields and requires a patch", () => {
    expect(parsePersonalizationPatch({ warmth: "warm", fastAnswers: true })).toEqual({
      warmth: "warm",
      fastAnswers: true,
    });
    expect(() => parsePersonalizationPatch({})).toThrow();
    expect(() => parsePersonalizationPatch({ warmth: "x".repeat(33) })).toThrow();
    expect(() => parsePersonalizationPatch({ customInstructions: "x".repeat(4001) })).toThrow();
    expect(() => parsePersonalizationPatch({ userId: "other" })).toThrow();
  });
});
