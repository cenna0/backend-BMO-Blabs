import { z } from "zod";
import { isAbsolute, parse, resolve } from "node:path";

export const P9_CANONICAL_TIMEZONE = "Asia/Jakarta" as const;

const booleanString = z
  .enum(["true", "false"])
  .default("false")
  .transform((value) => value === "true");

const optionalPositiveInt = (fallback: number) =>
  z.coerce.number().int().positive().default(fallback);

const avatarUploadReceiveTimeout = z.coerce.number().int().min(1_000).max(120_000).default(30_000);

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

const avatarStoragePathSchema = z.string().transform((value, context) => {
  if (value !== value.trim()) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "AVATAR_STORAGE_DIR cannot contain surrounding whitespace" });
    return z.NEVER;
  }
  if (!isAbsolute(value)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "AVATAR_STORAGE_DIR must be absolute" });
    return z.NEVER;
  }
  const normalized = resolve(value);
  const segments = value.split(/[\\/]+/u);
  if (segments.includes(".") || segments.includes("..")) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "AVATAR_STORAGE_DIR must not contain traversal segments" });
    return z.NEVER;
  }
  if (normalized === parse(normalized).root) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "AVATAR_STORAGE_DIR cannot be a filesystem root" });
    return z.NEVER;
  }
  return normalized;
});

const rawSchema = z.object({
  P9_ENABLED: booleanString,
  DATABASE_URL: z.string().url().optional(),
  P9_JWT_SECRET: z.string().optional(),
  P9_PAIRING_PEPPER: z.string().optional(),
  P9_WIFI_ENCRYPTION_KEY: z.string().optional(),
  P9_PROVIDER_ENCRYPTION_KEY: z.string().optional(),
  SPOTIFY_TOKEN_ENCRYPTION_KEY: z.string().optional(),
  SPOTIFY_CLIENT_ID: z.string().min(1).optional(),
  SPOTIFY_CLIENT_SECRET: z.string().min(1).optional(),
  SPOTIFY_CALLBACK_URL: z.string().url().optional(),
  WHATSAPP_BRIDGE_URL: z.string().url().default("http://127.0.0.1:3001"),
  WHATSAPP_IDENTITY_RESOLVER_URL: z.string().url().default("http://127.0.0.1:3002"),
  WHATSAPP_PAIRING_URL: z.string().url().default("http://127.0.0.1:3003"),
  WHATSAPP_IDENTITY_RESOLVER_TOKEN: z.string().optional(),
  P9_TIMEZONE: z.string().default(P9_CANONICAL_TIMEZONE),
  P9_PRISMA_POOL_SIZE: optionalPositiveInt(5),
  P9_POSTGRES_MAX_CONNECTIONS: optionalPositiveInt(20),
  PUBLIC_BASE_URL: publicBaseUrlSchema.default("http://127.0.0.1:3000"),
  AVATAR_STORAGE_DIR: avatarStoragePathSchema.default("/opt/bmo/data/avatars"),
  BUG_REPORT_STORAGE_DIR: avatarStoragePathSchema.default("/opt/bmo/data/bug-reports"),
  AVATAR_UPLOAD_RECEIVE_TIMEOUT_MS: avatarUploadReceiveTimeout,
  RESEND_API_KEY: z.string().min(1).optional(),
  SUPPORT_NOTIFICATION_EMAIL: z.string().trim().default("rangga@binerlabs.com,cenna@binerlabs.com,wuwu@binerlabs.com,niefa@binerlabs.com").refine(
    (val) => {
      const list = val.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);
      return list.length > 0 && list.every((email) => z.string().email().safeParse(email).success);
    },
    { message: "SUPPORT_NOTIFICATION_EMAIL must contain valid email address(es)" }
  ),
  SUPPORT_FROM_EMAIL: z.string().default("Joy from BinerLabs <joy@binerlabs.com>"),
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
  wifiEncryptionKey?: string | undefined;
  providerEncryptionKey?: string | undefined;
  spotifyTokenEncryptionKey?: string | undefined;
  spotifyClientId?: string | undefined;
  spotifyClientSecret?: string | undefined;
  spotifyCallbackUrl?: string | undefined;
  whatsappBridgeUrl: string;
  whatsappIdentityResolverUrl: string;
  whatsappPairingUrl: string;
  whatsappIdentityResolverToken?: string | undefined;
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
  bugReportStorageDir: string;
  avatarMaxBytes: 5_242_880;
  avatarUploadWindowMs: 900_000;
  avatarUploadUserLimit: 10;
  avatarUploadIpLimit: 20;
  avatarUploadReceiveTimeoutMs: number;
  avatarGcIntervalMs: 3_600_000;
  avatarGcGraceMs: 86_400_000;
  avatarGcScanLimit: 200;
  avatarGcBatchSize: 25;
  recoveryTokenTtlSeconds: 600;
  recoveryMaxAttempts: 5;
  recoveryWindowMs: 900_000;
  recoveryIpLimit: 5;
  recoveryEmailLimit: 3;
  resendApiKey: string;
  supportNotificationEmail: string;
  supportNotificationEmails: string[];
  supportFromEmail: string;
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
      wifiEncryptionKey: undefined,
      providerEncryptionKey: undefined,
      spotifyTokenEncryptionKey: undefined,
      spotifyClientId: undefined,
      spotifyClientSecret: undefined,
      spotifyCallbackUrl: undefined,
      whatsappBridgeUrl: parsed.WHATSAPP_BRIDGE_URL,
      whatsappIdentityResolverUrl: parsed.WHATSAPP_IDENTITY_RESOLVER_URL,
      whatsappPairingUrl: parsed.WHATSAPP_PAIRING_URL,
      whatsappIdentityResolverToken: undefined,
      prismaPoolSize: parsed.P9_PRISMA_POOL_SIZE,
      postgresMaxConnections: parsed.P9_POSTGRES_MAX_CONNECTIONS,
      loginWindowMs: 900_000,
      loginLimit: 5,
      pairingWindowMs: 900_000,
      pairingLimit: 10,
      publicBaseUrl: parsed.PUBLIC_BASE_URL,
      avatarStorageDir: parsed.AVATAR_STORAGE_DIR,
      bugReportStorageDir: parsed.BUG_REPORT_STORAGE_DIR,
      avatarMaxBytes: 5_242_880,
      avatarUploadWindowMs: 900_000,
      avatarUploadUserLimit: 10,
      avatarUploadIpLimit: 20,
      avatarUploadReceiveTimeoutMs: parsed.AVATAR_UPLOAD_RECEIVE_TIMEOUT_MS,
      avatarGcIntervalMs: 3_600_000,
      avatarGcGraceMs: 86_400_000,
      avatarGcScanLimit: 200,
      avatarGcBatchSize: 25,
      recoveryTokenTtlSeconds: 600,
      recoveryMaxAttempts: 5,
      recoveryWindowMs: 900_000,
      recoveryIpLimit: 5,
      recoveryEmailLimit: 3,
      resendApiKey: parsed.RESEND_API_KEY,
      supportNotificationEmail: parsed.SUPPORT_NOTIFICATION_EMAIL,
      supportNotificationEmails: parsed.SUPPORT_NOTIFICATION_EMAIL.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean),
      supportFromEmail: parsed.SUPPORT_FROM_EMAIL,
    };
  }

  return {
    enabled: true,
    databaseUrl: parsed.DATABASE_URL ?? (() => { throw new Error("DATABASE_URL is required when P9 is enabled"); })(),
    jwtSecret: strongSecret("P9_JWT_SECRET", parsed.P9_JWT_SECRET),
    pairingPepper: strongSecret("P9_PAIRING_PEPPER", parsed.P9_PAIRING_PEPPER),
    wifiEncryptionKey: strongSecret("P9_WIFI_ENCRYPTION_KEY", parsed.P9_WIFI_ENCRYPTION_KEY),
    providerEncryptionKey: parsed.P9_PROVIDER_ENCRYPTION_KEY,
    spotifyTokenEncryptionKey: parsed.SPOTIFY_TOKEN_ENCRYPTION_KEY,
    ...(parsed.SPOTIFY_CLIENT_ID === undefined ? {} : { spotifyClientId: parsed.SPOTIFY_CLIENT_ID }),
    ...(parsed.SPOTIFY_CLIENT_SECRET === undefined ? {} : { spotifyClientSecret: parsed.SPOTIFY_CLIENT_SECRET }),
    ...(parsed.SPOTIFY_CALLBACK_URL === undefined ? {} : { spotifyCallbackUrl: parsed.SPOTIFY_CALLBACK_URL }),
    whatsappBridgeUrl: parsed.WHATSAPP_BRIDGE_URL,
    whatsappIdentityResolverUrl: parsed.WHATSAPP_IDENTITY_RESOLVER_URL,
    whatsappPairingUrl: parsed.WHATSAPP_PAIRING_URL,
    ...(parsed.WHATSAPP_IDENTITY_RESOLVER_TOKEN === undefined ? {} : { whatsappIdentityResolverToken: strongSecret("WHATSAPP_IDENTITY_RESOLVER_TOKEN", parsed.WHATSAPP_IDENTITY_RESOLVER_TOKEN) }),
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
    bugReportStorageDir: parsed.BUG_REPORT_STORAGE_DIR,
    avatarMaxBytes: 5_242_880,
    avatarUploadWindowMs: 900_000,
    avatarUploadUserLimit: 10,
    avatarUploadIpLimit: 20,
    avatarUploadReceiveTimeoutMs: parsed.AVATAR_UPLOAD_RECEIVE_TIMEOUT_MS,
    avatarGcIntervalMs: 3_600_000,
    avatarGcGraceMs: 86_400_000,
    avatarGcScanLimit: 200,
    avatarGcBatchSize: 25,
    recoveryTokenTtlSeconds: 600,
    recoveryMaxAttempts: 5,
    recoveryWindowMs: 900_000,
    recoveryIpLimit: 5,
    recoveryEmailLimit: 3,
    resendApiKey: parsed.RESEND_API_KEY,
    supportNotificationEmail: parsed.SUPPORT_NOTIFICATION_EMAIL,
    supportNotificationEmails: parsed.SUPPORT_NOTIFICATION_EMAIL.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean),
    supportFromEmail: parsed.SUPPORT_FROM_EMAIL,
  };
}
