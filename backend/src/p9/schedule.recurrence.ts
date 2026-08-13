import type { CreateScheduleInput } from "./schedule.validation.js";

export const SCHEDULE_TIMEZONE = "Asia/Jakarta" as const;
const JAKARTA_OFFSET_MS = 7 * 60 * 60 * 1_000;
const HOURS = { Morning: 9, Afternoon: 13, Evening: 18 } as const;
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

export type ScheduleRecurrence =
  | { frequency: "Daily"; every: number; timeOfDay: keyof typeof HOURS }
  | { frequency: "Weekly"; every: number; repeatDay: typeof DAYS[number]; days: typeof DAYS[number][]; timeOfDay: keyof typeof HOURS }
  | { frequency: "Once"; every: number; date: string; timeOfDay: keyof typeof HOURS };

function localParts(instant: Date): { year: number; month: number; date: number; day: number } {
  const local = new Date(instant.getTime() + JAKARTA_OFFSET_MS);
  return { year: local.getUTCFullYear(), month: local.getUTCMonth(), date: local.getUTCDate(), day: local.getUTCDay() };
}

function jakartaInstant(year: number, month: number, date: number, period: keyof typeof HOURS): Date {
  return new Date(Date.UTC(year, month, date, HOURS[period]) - JAKARTA_OFFSET_MS);
}

function dateStringInstant(date: string, period: keyof typeof HOURS): Date {
  const [year, month, dayOfMonth] = date.split("-").map(Number);
  return jakartaInstant(year!, month! - 1, dayOfMonth!, period);
}

export function nextOccurrence(recurrence: ScheduleRecurrence, after: Date): Date | null {
  if (recurrence.frequency === "Once") {
    const due = dateStringInstant(recurrence.date, recurrence.timeOfDay);
    return due.getTime() > after.getTime() ? due : null;
  }
  const local = localParts(after);
  if (recurrence.frequency === "Daily") {
    let due = jakartaInstant(local.year, local.month, local.date, recurrence.timeOfDay);
    if (due.getTime() <= after.getTime()) due = new Date(due.getTime() + recurrence.every * 86_400_000);
    return due;
  }
  const selected = recurrence.days.map((value) => DAYS.indexOf(value)).sort((a, b) => a - b);
  const todayAtPeriod = jakartaInstant(local.year, local.month, local.date, recurrence.timeOfDay);
  const laterThisWeek = selected.find((selectedDay) => selectedDay > local.day || (selectedDay === local.day && todayAtPeriod.getTime() > after.getTime()));
  const delta = laterThisWeek === undefined
    ? recurrence.every * 7 - local.day + selected[0]!
    : laterThisWeek - local.day;
  const candidateLocal = new Date(Date.UTC(local.year, local.month, local.date + delta));
  return jakartaInstant(candidateLocal.getUTCFullYear(), candidateLocal.getUTCMonth(), candidateLocal.getUTCDate(), recurrence.timeOfDay);
}

export function normalizeSchedule(input: CreateScheduleInput, after = new Date()): {
  timezone: typeof SCHEDULE_TIMEZONE;
  recurrence: ScheduleRecurrence;
  payload: { prompt: string; deliveryTargets: Array<"DEVICE" | "MOBILE"> };
  targetDeviceId: string | null;
  nextRunAt: Date;
} {
  const recurrence: ScheduleRecurrence = input.frequency === "Weekly"
    ? { frequency: input.frequency, every: input.every, repeatDay: input.repeatDay, days: input.days, timeOfDay: input.timeOfDay }
    : input.frequency === "Once"
      ? { frequency: input.frequency, every: input.every, date: input.date, timeOfDay: input.timeOfDay }
      : { frequency: input.frequency, every: input.every, timeOfDay: input.timeOfDay };
  const nextRunAt = nextOccurrence(recurrence, after);
  if (!nextRunAt) throw new Error("Schedule has no future occurrence");
  return {
    timezone: SCHEDULE_TIMEZONE,
    recurrence,
    payload: { prompt: input.prompt, deliveryTargets: input.deliveryTargets },
    targetDeviceId: input.deviceId ?? null,
    nextRunAt,
  };
}
