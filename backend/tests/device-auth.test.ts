import { describe, expect, it } from "vitest";

import { deviceTokenMatches } from "../src/utils/device-auth.js";

describe("deviceTokenMatches", () => {
  it("accepts an exact token", () => {
    expect(deviceTokenMatches("correct-device-secret", "correct-device-secret")).toBe(true);
  });

  it("rejects wrong tokens regardless of input length", () => {
    expect(deviceTokenMatches("wrong-device-secret", "correct-device-secret")).toBe(false);
    expect(deviceTokenMatches("short", "correct-device-secret")).toBe(false);
  });
});
