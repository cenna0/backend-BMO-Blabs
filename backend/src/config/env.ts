import { z } from "zod";

import { parseP9Config, type P9Config } from "../p9/config.js";

const booleanString = z
  .enum(["true", "false"])
  .default("false")
  .transform((value) => value === "true");

const positiveInt = (fallback: number) =>
  z.coerce.number().int().positive().default(fallback);

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    BACKEND_HOST: z.string().min(1).default("127.0.0.1"),
    BACKEND_PORT: positiveInt(3_000),
    PUBLIC_BASE_URL: z.string().url(),
    DEVICE_ID: z.string().min(1),
    DEVICE_TOKEN: z.string().min(16),
    TEMP_AUDIO_DIR: z.string().min(1),
    TEMP_AUDIO_TTL_SECONDS: positiveInt(300),
    TEMP_AUDIO_CLEANUP_INTERVAL_SECONDS: positiveInt(30),
    REQUEST_TOMBSTONE_TTL_SECONDS: positiveInt(600),
    MAX_REQUEST_STORE_ENTRIES: positiveInt(1_000),
    MAX_AUDIO_BYTES: positiveInt(3_145_728),
    MAX_AUDIO_DURATION_SECONDS: positiveInt(60),
    HARDWARE_TEST_MODE: booleanString,
    HARDWARE_TEST_MP3_PATH: z.string().min(1).optional(),
    AUDIO_SERVICE_URL: z.string().url().default("http://127.0.0.1:8001"),
    INTERNAL_SERVICE_TOKEN: z.string().min(16).default("local-internal-token"),
    AUDIO_SERVICE_STT_TIMEOUT_MS: positiveInt(90_000),
    AUDIO_SERVICE_TTS_TIMEOUT_MS: positiveInt(180_000),
    HERMES_API_URL: z.string().url().default("http://127.0.0.1:8642"),
    HERMES_API_KEY: z.string().min(1).default("local-hermes-key"),
    HERMES_MODEL: z.string().min(1).default("hermes-agent"),
    HERMES_CONVERSATION: z.string().min(1).default("bmo-001"),
    HERMES_SOFT_TIMEOUT_MS: positiveInt(30_000),
    HERMES_HARD_TIMEOUT_MS: positiveInt(180_000),
    READINESS_PROBE_TIMEOUT_MS: positiveInt(2_000),
    TOTAL_PIPELINE_TIMEOUT_MS: positiveInt(300_000),
    WS_AUTH_TIMEOUT_MS: positiveInt(5_000),
    WS_HEARTBEAT_INTERVAL_MS: positiveInt(60_000),
    WS_MAX_MISSED_PONGS: positiveInt(2),
    WS_MAX_MESSAGE_BYTES: positiveInt(8_192),
  })
  .superRefine((value, context) => {
    if (value.HARDWARE_TEST_MODE && !value.HARDWARE_TEST_MP3_PATH) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "HARDWARE_TEST_MP3_PATH is required when HARDWARE_TEST_MODE=true",
        path: ["HARDWARE_TEST_MP3_PATH"],
      });
    }
    if (value.NODE_ENV === "production" && value.HARDWARE_TEST_MODE) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "HARDWARE_TEST_MODE cannot be enabled when NODE_ENV=production",
        path: ["HARDWARE_TEST_MODE"],
      });
    }
    if (value.NODE_ENV === "production") {
      if (value.BACKEND_HOST !== "127.0.0.1") {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "BACKEND_HOST must be 127.0.0.1 in production",
          path: ["BACKEND_HOST"],
        });
      }
      const unsafeSecrets: Array<[keyof typeof value, string]> = [
        ["DEVICE_TOKEN", value.DEVICE_TOKEN],
        ["INTERNAL_SERVICE_TOKEN", value.INTERNAL_SERVICE_TOKEN],
        ["HERMES_API_KEY", value.HERMES_API_KEY],
      ];
      for (const [key, secret] of unsafeSecrets) {
        if (
          secret.length < 24 ||
          secret.toLowerCase().includes("test") ||
          secret.toLowerCase().includes("local") ||
          secret === "local-internal-token" ||
          secret === "local-hermes-key" ||
          secret === "test-device-secret" ||
          secret === "replace-me" ||
          secret.startsWith("replace-with-")
        ) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: "unsafe production secret placeholder is not allowed",
            path: [key],
          });
        }
      }
    }
  });

export type BackendConfig = z.infer<typeof envSchema> & { p9: P9Config };

export function parseEnv(input: Record<string, unknown>): BackendConfig {
  return { ...envSchema.parse(input), p9: parseP9Config(input) };
}
