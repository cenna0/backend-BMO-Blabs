import { z } from "zod";

export const P9_CANONICAL_TIMEZONE = "Asia/Jakarta" as const;

const booleanString = z
  .enum(["true", "false"])
  .default("false")
  .transform((value) => value === "true");

const optionalPositiveInt = (fallback: number) =>
  z.coerce.number().int().positive().default(fallback);

const publicBaseUrlSchema = z.string().transform((value, context) => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "PUBLIC_BASE_URL must be a valid URL" });
    return z.NEVER;
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "PUBLIC_BASE_URL must be an HTTP(S) origin" });
    return z.NEVER;
  }
  return url.origin;
});

const rawSchema = z.object({
  P9_ENABLED: booleanString,
  DATABASE_URL: z.string().url().optional(),
  P9_JWT_SECRET: z.string().optional(),
  P9_PAIRING_PEPPER: z.string().optional(),
  P9_TIMEZONE: z.string().default(P9_CANONICAL_TIMEZONE),
  P9_PRISMA_POOL_SIZE: optionalPositiveInt(5),
  P9_POSTGRES_MAX_CONNECTIONS: optionalPositiveInt(20),
  PUBLIC_BASE_URL: publicBaseUrlSchema.default("http://127.0.0.1:3000"),
  AVATAR_STORAGE_DIR: z.string().min(1).default("/opt/bmo/data/avatars"),
});

const strongSecret = (name: string, value: string | undefined): string => {
  if (!value || Buffer.byteLength(value, "utf8") < 32) {
    throw new Error(`${name} must contain at least 32 bytes`);
  }
  return value;
};

export interface P9Config {
  enabled: boolean;
  databaseUrl?: string;
  jwtSecret?: string;
  pairingPepper?: string;
  canonicalTimezone: typeof P9_CANONICAL_TIMEZONE;
  accessTokenTtlSeconds: 900;
  refreshTokenTtlSeconds: 2_592_000;
  pairingTtlSeconds: 600;
  prismaPoolSize: number;
  postgresMaxConnections: number;
  loginWindowMs: 900_000;
  loginLimit: 5;
  pairingWindowMs: 900_000;
  pairingLimit: 10;
  publicBaseUrl: string;
  avatarStorageDir: string;
  avatarMaxBytes: 5_242_880;
  recoveryTokenTtlSeconds: 600;
  recoveryMaxAttempts: 5;
  recoveryWindowMs: 900_000;
  recoveryIpLimit: 5;
  recoveryEmailLimit: 3;
}

export function parseP9Config(input: Record<string, unknown>): P9Config {
  const parsed = rawSchema.parse(input);
  if (parsed.P9_TIMEZONE !== P9_CANONICAL_TIMEZONE) {
    throw new Error(`P9 timezone is fixed to ${P9_CANONICAL_TIMEZONE}`);
  }
  if (!parsed.P9_ENABLED) {
    return {
      enabled: false,
      canonicalTimezone: P9_CANONICAL_TIMEZONE,
      accessTokenTtlSeconds: 900,
      refreshTokenTtlSeconds: 2_592_000,
      pairingTtlSeconds: 600,
      prismaPoolSize: parsed.P9_PRISMA_POOL_SIZE,
      postgresMaxConnections: parsed.P9_POSTGRES_MAX_CONNECTIONS,
      loginWindowMs: 900_000,
      loginLimit: 5,
      pairingWindowMs: 900_000,
      pairingLimit: 10,
      publicBaseUrl: parsed.PUBLIC_BASE_URL,
      avatarStorageDir: parsed.AVATAR_STORAGE_DIR,
      avatarMaxBytes: 5_242_880,
      recoveryTokenTtlSeconds: 600,
      recoveryMaxAttempts: 5,
      recoveryWindowMs: 900_000,
      recoveryIpLimit: 5,
      recoveryEmailLimit: 3,
    };
  }

  return {
    enabled: true,
    databaseUrl: parsed.DATABASE_URL ?? (() => { throw new Error("DATABASE_URL is required when P9 is enabled"); })(),
    jwtSecret: strongSecret("P9_JWT_SECRET", parsed.P9_JWT_SECRET),
    pairingPepper: strongSecret("P9_PAIRING_PEPPER", parsed.P9_PAIRING_PEPPER),
    canonicalTimezone: P9_CANONICAL_TIMEZONE,
    accessTokenTtlSeconds: 900,
    refreshTokenTtlSeconds: 2_592_000,
    pairingTtlSeconds: 600,
    prismaPoolSize: parsed.P9_PRISMA_POOL_SIZE,
    postgresMaxConnections: parsed.P9_POSTGRES_MAX_CONNECTIONS,
    loginWindowMs: 900_000,
    loginLimit: 5,
    pairingWindowMs: 900_000,
    pairingLimit: 10,
    publicBaseUrl: parsed.PUBLIC_BASE_URL,
    avatarStorageDir: parsed.AVATAR_STORAGE_DIR,
    avatarMaxBytes: 5_242_880,
    recoveryTokenTtlSeconds: 600,
    recoveryMaxAttempts: 5,
    recoveryWindowMs: 900_000,
    recoveryIpLimit: 5,
    recoveryEmailLimit: 3,
  };
}
