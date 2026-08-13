import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

import {
  decodeMemoryCursor,
  encodeMemoryCursor,
  parseAcceptCandidate,
  parseMemoryList,
  parseMemoryPatch,
  parseMemorySettingsPatch,
  parseSummaryFeedback,
} from "../../src/p9/memory.validation.js";

describe("memory validation", () => {
  it("accepts only the exact memory settings body", () => {
    expect(parseMemorySettingsPatch({ automaticMemoryCandidates: false })).toEqual({ automaticMemoryCandidates: false });
    expect(() => parseMemorySettingsPatch({})).toThrow();
    expect(() => parseMemorySettingsPatch({ automaticMemoryCandidates: true, userId: "attacker" })).toThrow();
  });

  it("bounds list, patch, action, and feedback input", () => {
    expect(parseMemoryList({ limit: "25" })).toEqual({ limit: 25 });
    expect(() => parseMemoryList({ limit: "101" })).toThrow();
    expect(() => parseMemoryPatch({ idempotencyKey: randomUUID() })).toThrow();
    expect(parseAcceptCandidate({ idempotencyKey: randomUUID() })).toHaveProperty("idempotencyKey");
    expect(() => parseSummaryFeedback({ idempotencyKey: randomUUID(), feedback: "x".repeat(501) })).toThrow();
  });

  it("round-trips opaque deterministic cursors and rejects malformed values", () => {
    const value = { at: new Date("2026-08-12T08:00:00.123Z"), id: "00000000-0000-4000-8000-000000000001" };
    expect(decodeMemoryCursor(encodeMemoryCursor(value))).toEqual(value);
    expect(() => decodeMemoryCursor("not-a-cursor")).toThrow();
  });
});
