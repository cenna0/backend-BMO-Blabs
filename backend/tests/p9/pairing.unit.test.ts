import { describe, expect, it } from "vitest";

import { isPairingCode } from "../../src/p9/services/hardware-enrollment.service.js";

describe("P9 pairing primitives", () => {
  it("accepts only six numeric digits", () => {
    expect(isPairingCode("012345")).toBe(true);
    expect(isPairingCode("12345")).toBe(false);
    expect(isPairingCode("1234567")).toBe(false);
    expect(isPairingCode("12a456")).toBe(false);
  });
});
