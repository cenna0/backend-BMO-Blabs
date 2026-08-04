import { describe, expect, it } from "vitest";

import { isPairingCode, publicPairingStatus } from "../../src/p9/services/pairing.service.js";

describe("P9 pairing primitives", () => {
  it("accepts only six numeric digits", () => {
    expect(isPairingCode("012345")).toBe(true);
    expect(isPairingCode("12345")).toBe(false);
    expect(isPairingCode("1234567")).toBe(false);
    expect(isPairingCode("12a456")).toBe(false);
  });

  it("projects pairing state without exposing hashes or codes", () => {
    expect(publicPairingStatus({ id: "pair-1", status: "ISSUED", expiresAt: new Date("2026-08-04T00:00:00.000Z"), attemptCount: 1 })).toEqual({
      id: "pair-1",
      status: "issued",
      expiresAt: "2026-08-04T00:00:00.000Z",
      attemptCount: 1,
    });
  });
});
