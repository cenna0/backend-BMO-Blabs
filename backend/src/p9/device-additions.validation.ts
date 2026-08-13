import { z } from "zod";

const ssid = z.string().trim().min(1).max(32);
const password = z.string().min(8).max(63);

export const wifiPutSchema = z.object({ ssid, password: password.optional() }).strict();
export type WifiPutInput = z.infer<typeof wifiPutSchema>;

export const deviceLogSchema = z.object({
  level: z.enum(["DEBUG", "INFO", "WARN", "ERROR"]),
  code: z.string().trim().min(1).max(64).regex(/^[A-Z0-9_]+$/u),
  message: z.string().min(1).max(1_000),
  timestamp: z.string().datetime({ offset: true }).nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
}).strict();

export const deviceTelemetrySchema = z.object({
  wifi_connected: z.boolean(),
  wifi_rssi: z.number().int().min(-127).max(0).nullable().optional(),
  battery_percent: z.number().int().min(0).max(100).nullable().optional(),
  firmware_version: z.string().trim().min(1).max(64).optional(),
}).strict();

export const deviceSettingsAppliedSchema = z.object({
  event: z.literal("device_settings_applied"),
  version: z.number().int().positive(),
}).strict();
