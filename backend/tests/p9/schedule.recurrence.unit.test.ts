import { describe, expect, it } from "vitest";

import { normalizeSchedule, nextOccurrence } from "../../src/p9/schedule.recurrence.js";

describe("Jakarta schedule recurrence", () => {
  it("maps presentation periods to documented Jakarta instants", () => {
    const normalized = normalizeSchedule({ prompt: "x", frequency: "Once", every: 1, date: "2026-08-15", timeOfDay: "Morning", deliveryTargets: ["MOBILE"] });
    expect(normalized.nextRunAt.toISOString()).toBe("2026-08-15T02:00:00.000Z");
    expect(normalized.recurrence).toEqual({ frequency: "Once", every: 1, timeOfDay: "Morning", date: "2026-08-15" });
    expect(normalized.timezone).toBe("Asia/Jakarta");
  });

  it("advances daily and weekly recurrences deterministically", () => {
    expect(nextOccurrence(
      { frequency: "Daily", every: 2, timeOfDay: "Afternoon" },
      new Date("2026-08-13T07:00:00.000Z"),
    )?.toISOString()).toBe("2026-08-15T06:00:00.000Z");
    expect(nextOccurrence(
      { frequency: "Weekly", every: 1, timeOfDay: "Evening", days: ["Thursday", "Saturday"], repeatDay: "Thursday" },
      new Date("2026-08-13T12:00:00.000Z"),
    )?.toISOString()).toBe("2026-08-15T11:00:00.000Z");
  });

  it("returns no next occurrence after a one-shot instant", () => {
    const recurrence = { frequency: "Once" as const, every: 1, timeOfDay: "Evening" as const, date: "2026-08-15" };
    expect(nextOccurrence(recurrence, new Date("2026-08-15T11:00:00.000Z"))).toBeNull();
  });

  it("honors multi-week gaps after the final selected day", () => {
    expect(nextOccurrence(
      { frequency: "Weekly", every: 2, timeOfDay: "Morning", days: ["Thursday", "Saturday"], repeatDay: "Thursday" },
      new Date("2026-08-15T02:00:00.000Z"),
    )?.toISOString()).toBe("2026-08-27T02:00:00.000Z");
  });
});
