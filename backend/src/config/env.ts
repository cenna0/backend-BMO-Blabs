import { z } from "zod";

const booleanString = z
  .enum(["true", "false"])
  .default("false")
  .transform((value) => value === "true");

const positiveInt = (fallback: number) =>
  z.coerce.number().int().positive().default(fallback);

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    BACKEND_HOST: z.string().min(1).default("0.0.0.0"),
    BACKEND_PORT: positiveInt(3_000),
    PUBLIC_BASE_URL: z.string().url(),
    DEVICE_ID: z.string().min(1),
    DEVICE_TOKEN: z.string().min(16),
    TEMP_AUDIO_DIR: z.string().min(1),
    TEMP_AUDIO_TTL_SECONDS: positiveInt(300),
    MAX_AUDIO_BYTES: positiveInt(3_145_728),
    MAX_AUDIO_DURATION_SECONDS: positiveInt(60),
    HARDWARE_TEST_MODE: booleanString,
    HARDWARE_TEST_MP3_PATH: z.string().min(1),
    WS_AUTH_TIMEOUT_MS: positiveInt(5_000),
    WS_HEARTBEAT_INTERVAL_MS: positiveInt(60_000),
    WS_MAX_MISSED_PONGS: positiveInt(2),
    WS_MAX_MESSAGE_BYTES: positiveInt(8_192),
  })
  .superRefine((value, context) => {
    if (value.NODE_ENV === "production" && value.HARDWARE_TEST_MODE) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "HARDWARE_TEST_MODE cannot be enabled when NODE_ENV=production",
        path: ["HARDWARE_TEST_MODE"],
      });
    }
  });

export type BackendConfig = z.infer<typeof envSchema>;

export function parseEnv(input: Record<string, unknown>): BackendConfig {
  return envSchema.parse(input);
}
