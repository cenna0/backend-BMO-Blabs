import { describe, expect, it } from "vitest";

import { parseCreateSchedule, parseSchedulePatch } from "../../src/p9/schedule.validation.js";

describe("schedule validation", () => {
  it("accepts bounded mobile vocabulary and rejects server-owned fields", () => {
    expect(parseCreateSchedule({
      prompt: "Remind me to stand up",
      frequency: "Weekly",
      every: 1,
      repeatDay: "Thursday",
      days: ["Thursday"],
      timeOfDay: "Morning",
      deliveryTargets: ["DEVICE", "MOBILE"],
      deviceId: "00000000-0000-4000-8000-000000000001",
    })).toMatchObject({ frequency: "Weekly", every: 1 });
    expect(() => parseCreateSchedule({ prompt: "x", frequency: "Daily", every: 1, timeOfDay: "Morning", deliveryTargets: ["MOBILE"], userId: "attacker" })).toThrow();
    expect(() => parseCreateSchedule({ prompt: "x".repeat(1_001), frequency: "Daily", every: 1, timeOfDay: "Morning", deliveryTargets: ["MOBILE"] })).toThrow();
  });

  it("enforces frequency-specific fields and nonempty unique targets", () => {
    expect(() => parseCreateSchedule({ prompt: "x", frequency: "Weekly", every: 1, timeOfDay: "Morning", deliveryTargets: ["DEVICE"] })).toThrow();
    expect(() => parseCreateSchedule({ prompt: "x", frequency: "Once", every: 1, date: "2026-02-30", timeOfDay: "Morning", deliveryTargets: ["MOBILE"] })).toThrow();
    expect(() => parseCreateSchedule({ prompt: "x", frequency: "Daily", every: 1, date: "2026-08-15", timeOfDay: "Morning", deliveryTargets: ["MOBILE"] })).toThrow();
    expect(() => parseCreateSchedule({ prompt: "x", frequency: "Daily", every: 1, timeOfDay: "Morning", deliveryTargets: ["MOBILE", "MOBILE"] })).toThrow();
    expect(() => parseCreateSchedule({ prompt: "x", frequency: "Daily", every: 1, timeOfDay: "Morning", deliveryTargets: ["DEVICE"] })).toThrow();
  });

  it("requires version on patches and at least one mutable field", () => {
    expect(parseSchedulePatch({ version: 3, prompt: "Updated" })).toEqual({ version: 3, prompt: "Updated" });
    expect(() => parseSchedulePatch({ prompt: "Updated" })).toThrow();
    expect(() => parseSchedulePatch({ version: 3 })).toThrow();
    expect(() => parseSchedulePatch({ version: 3, status: "PAUSED" })).toThrow();
  });
});
