import { z } from "zod";

import { P9_CANONICAL_TIMEZONE } from "./config.js";

const emailSchema = z.string().trim().min(3).max(320).email();

const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

const quietHoursSchema = z
  .object({
    start: timeSchema,
    end: timeSchema,
    timezone: z.string().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.timezone !== undefined && value.timezone !== P9_CANONICAL_TIMEZONE) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `timezone is fixed to ${P9_CANONICAL_TIMEZONE}`,
        path: ["timezone"],
      });
    }
  });

const userSettingsSchema = z
  .object({
    language: z.string().trim().min(2).max(16).optional(),
    responseLength: z.enum(["brief", "standard", "detailed"]).optional(),
    automaticMemoryCandidates: z.boolean().optional(),
  })
  .strict();

const deviceSettingsSchema = z
  .object({
    displayName: z.string().trim().min(1).max(120).nullable().optional(),
    defaultDevice: z.boolean().optional(),
    playbackVolume: z.number().int().min(0).max(100).optional(),
    quietHours: quietHoursSchema.nullable().optional(),
    notificationBehavior: z.enum(["all", "important", "none"]).optional(),
    voiceProfileId: z.literal("prudence").optional(),
    speechSpeed: z.number().min(0.85).max(1.15).optional(),
    enabled: z.boolean().optional(),
  })
  .strict();

export interface QuietHours {
  start: string;
  end: string;
  timezone: typeof P9_CANONICAL_TIMEZONE;
}

export function normalizeEmail(value: string): string {
  const normalized = emailSchema.parse(value).normalize("NFKC").toLowerCase();
  return emailSchema.parse(normalized);
}

export function isUuid(value: string): boolean {
  return z.string().uuid().safeParse(value).success;
}

export function parseQuietHours(value: unknown): QuietHours | null {
  if (value === null || value === undefined) return null;
  const parsed = quietHoursSchema.parse(value);
  return {
    start: parsed.start,
    end: parsed.end,
    timezone: P9_CANONICAL_TIMEZONE,
  };
}

export function parseUserSettings(value: unknown): z.infer<typeof userSettingsSchema> {
  return userSettingsSchema.parse(value);
}

export function parseDeviceSettings(value: unknown): z.infer<typeof deviceSettingsSchema> {
  const parsed = deviceSettingsSchema.parse(value);
  return {
    ...parsed,
    quietHours: parsed.quietHours === undefined ? undefined : parseQuietHours(parsed.quietHours),
  };
}
