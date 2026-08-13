import { z } from "zod";

const uuid = z.string().uuid();
const day = z.enum(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]);
const timeOfDay = z.enum(["Morning", "Afternoon", "Evening"]);
const deliveryTarget = z.enum(["DEVICE", "MOBILE"]);

const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).refine((value) => {
  const [year, month, date] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year!, month! - 1, date));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month! - 1 && parsed.getUTCDate() === date;
}, "Invalid calendar date");

const common = {
  prompt: z.string().trim().min(1).max(1_000),
  every: z.number().int().min(1).max(365),
  timeOfDay,
  deliveryTargets: z.array(deliveryTarget).min(1).max(2).refine((targets) => new Set(targets).size === targets.length),
  deviceId: uuid.optional(),
};

const createSchema = z.union([
  z.object({ ...common, frequency: z.literal("Daily") }).strict(),
  z.object({
    ...common,
    frequency: z.literal("Weekly"),
    repeatDay: day,
    days: z.array(day).min(1).max(7).refine((days) => new Set(days).size === days.length),
  }).strict().refine((value) => value.days.includes(value.repeatDay), { path: ["repeatDay"] }),
  z.object({ ...common, frequency: z.literal("Once"), date: calendarDate }).strict(),
]).superRefine((value, context) => {
  if (value.deliveryTargets.includes("DEVICE") !== (value.deviceId !== undefined)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["deviceId"], message: "DEVICE target requires exactly one deviceId" });
  }
});

const patchSchema = z.object({
  version: z.number().int().min(1),
  prompt: common.prompt.optional(),
  frequency: z.enum(["Daily", "Weekly", "Once"]).optional(),
  every: common.every.optional(),
  repeatDay: day.optional(),
  days: z.array(day).min(1).max(7).refine((days) => new Set(days).size === days.length).optional(),
  timeOfDay: timeOfDay.optional(),
  date: calendarDate.optional(),
  deliveryTargets: common.deliveryTargets.optional(),
  deviceId: uuid.nullable().optional(),
}).strict().refine((value) => Object.keys(value).some((key) => key !== "version"), "At least one mutable field is required");

export type CreateScheduleInput = z.infer<typeof createSchema>;
export type SchedulePatchInput = z.infer<typeof patchSchema>;

export function parseCreateSchedule(value: unknown): CreateScheduleInput {
  return createSchema.parse(value);
}

export function parseSchedulePatch(value: unknown): SchedulePatchInput {
  return patchSchema.parse(value);
}

export const scheduleVersionSchema = z.object({ version: z.number().int().min(1) }).strict();
