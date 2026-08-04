import { describe, expect, it } from "vitest";

import {
  normalizeEmail,
  parseDeviceSettings,
  parseQuietHours,
  parseUserSettings,
} from "../../src/p9/validation.js";

describe("P9 validation", () => {
  it("normalizes email for uniqueness without preserving whitespace/case", () => {
    expect(normalizeEmail("  Alice@Example.COM ")).toBe("alice@example.com");
    expect(() => normalizeEmail("not-an-email")).toThrow();
  });

  it("parses quiet hours as fixed-time Asia/Jakarta values", () => {
    expect(parseQuietHours({ start: "22:00", end: "06:00" })).toEqual({
      start: "22:00",
      end: "06:00",
      timezone: "Asia/Jakarta",
    });
    expect(() => parseQuietHours({ start: "25:00", end: "06:00" })).toThrow();
    expect(() => parseQuietHours({ start: "22:00", end: "06:00", timezone: "UTC" })).toThrow(
      /Asia\/Jakarta/,
    );
  });

  it("enforces safe user and device setting ranges", () => {
    expect(parseUserSettings({ language: "id", responseLength: "detailed", automaticMemoryCandidates: false })).toEqual({
      language: "id",
      responseLength: "detailed",
      automaticMemoryCandidates: false,
    });
    expect(parseDeviceSettings({ playbackVolume: 0, speechSpeed: 0.85, voiceProfileId: "prudence" })).toMatchObject({
      playbackVolume: 0,
      speechSpeed: 0.85,
      voiceProfileId: "prudence",
    });
    expect(() => parseDeviceSettings({ playbackVolume: 101 })).toThrow();
    expect(() => parseDeviceSettings({ speechSpeed: 1.2 })).toThrow();
    expect(() => parseDeviceSettings({ voiceProfileId: "other" })).toThrow();
  });
});
