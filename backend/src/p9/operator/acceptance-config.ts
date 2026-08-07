import { lstatSync } from "node:fs";
import { isAbsolute } from "node:path";

import { validateRestoreDatabaseName } from "./restore-config.js";
import { validateProtectedFile, type ProtectedFileFs, type ProtectedFileStats } from "./protected-file.js";

export const ACCEPTANCE_NETWORK = "bmo-p9-1_p9_private" as const;
export const ACCEPTANCE_PROJECT = "bmo-p9-1-restore-acceptance" as const;
export const ACCEPTANCE_CONTAINER = "bmo-p9-1-restore-acceptance-runtime" as const;
export const ACCEPTANCE_POSTGRES_CONTAINER = "bmo-p9-1-postgres-1" as const;
export const ACCEPTANCE_BIND_HOST = "127.0.0.1" as const;
export const ACCEPTANCE_INTERNAL_PORT = 3010 as const;
export const ACCEPTANCE_PASSWORD_FILE_MODE = 0o600 as const;

export interface AcceptanceConfigFs extends ProtectedFileFs {}

export interface AcceptanceConfig {
  database: string;
  primaryDatabase: "bmo";
  port: number;
  bindHost: typeof ACCEPTANCE_BIND_HOST;
  network: typeof ACCEPTANCE_NETWORK;
  project: typeof ACCEPTANCE_PROJECT;
  container: typeof ACCEPTANCE_CONTAINER;
  postgresContainer: typeof ACCEPTANCE_POSTGRES_CONTAINER;
  image: string;
  codeDirectory: string;
  internalPort: typeof ACCEPTANCE_INTERNAL_PORT;
  migrationsDisabled: true;
  postgresUser: "bmo";
  postgresPasswordFile: string;
  canonicalAcceptancePasswordFile: string;
  runtimeEnvFile: string;
}

export interface AcceptanceConfigOptions {
  env?: NodeJS.ProcessEnv;
  fs?: AcceptanceConfigFs;
  runtimeUid?: number;
  runtimeGid?: number;
}

export class AcceptanceConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AcceptanceConfigError";
  }
}

function fail(message: string): never {
  throw new AcceptanceConfigError(message);
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) fail(`${name} is required`);
  return value;
}

function requiredAbsolute(env: NodeJS.ProcessEnv, name: string): string {
  const value = required(env, name);
  if (!isAbsolute(value)) fail(`${name} must be an absolute path`);
  return value;
}

function validateIdentity(value: string, name: string, expected: string): void {
  if (value !== expected) fail(`${name} is not the dedicated acceptance identity`);
}

function validateCodeDirectory(path: string, fs: AcceptanceConfigFs | undefined): void {
  let metadata: ProtectedFileStats & { isDirectory(): boolean };
  try {
    metadata = (fs?.lstatSync(path) ?? lstatSync(path)) as ProtectedFileStats & { isDirectory(): boolean };
  } catch {
    fail("P9_ACCEPTANCE_CODE_DIR is unavailable");
  }
  if (metadata.isSymbolicLink() || !("isDirectory" in metadata) || typeof metadata.isDirectory !== "function" || !metadata.isDirectory()) {
    fail("P9_ACCEPTANCE_CODE_DIR must be a regular directory");
  }
}

export function loadAcceptanceConfig(options: AcceptanceConfigOptions = {}): AcceptanceConfig {
  const env = options.env ?? process.env;
  const fs = options.fs;
  const database = required(env, "P9_ACCEPTANCE_DATABASE");
  try {
    validateRestoreDatabaseName(database, "bmo");
  } catch {
    fail("P9_ACCEPTANCE_DATABASE is not a safe disposable restore database");
  }

  const rawPort = required(env, "P9_ACCEPTANCE_PORT");
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) fail("P9_ACCEPTANCE_PORT is invalid");

  if (required(env, "P9_ACCEPTANCE_BIND_HOST") !== ACCEPTANCE_BIND_HOST) {
    fail("P9_ACCEPTANCE_BIND_HOST must be 127.0.0.1");
  }
  if (required(env, "P9_ACCEPTANCE_NETWORK") !== ACCEPTANCE_NETWORK) {
    fail("P9_ACCEPTANCE_NETWORK must be the isolated candidate network");
  }
  validateIdentity(required(env, "P9_ACCEPTANCE_PROJECT"), "P9_ACCEPTANCE_PROJECT", ACCEPTANCE_PROJECT);
  validateIdentity(required(env, "P9_ACCEPTANCE_CONTAINER"), "P9_ACCEPTANCE_CONTAINER", ACCEPTANCE_CONTAINER);
  validateIdentity(required(env, "P9_ACCEPTANCE_POSTGRES_CONTAINER"), "P9_ACCEPTANCE_POSTGRES_CONTAINER", ACCEPTANCE_POSTGRES_CONTAINER);

  const image = required(env, "P9_ACCEPTANCE_IMAGE");
  if (/(production|main|bmo-production|bmo-p9-1-backend-1)/i.test(image)) fail("P9_ACCEPTANCE_IMAGE is not an isolated candidate image");
  const codeDirectory = requiredAbsolute(env, "P9_ACCEPTANCE_CODE_DIR");
  validateCodeDirectory(codeDirectory, fs);
  if (required(env, "P9_ACCEPTANCE_MIGRATIONS_DISABLED") !== "true") {
    fail("P9_ACCEPTANCE_MIGRATIONS_DISABLED must be true");
  }
  if (required(env, "P9_POSTGRES_USER") !== "bmo") fail("P9_POSTGRES_USER must be bmo");

  const postgresPasswordFile = requiredAbsolute(env, "P9_POSTGRES_PASSWORD_FILE");
  const canonicalAcceptancePasswordFile = requiredAbsolute(env, "P9_ACCEPTANCE_PASSWORD_FILE");
  const runtimeEnvFile = requiredAbsolute(env, "P9_ACCEPTANCE_RUNTIME_ENV_FILE");
  for (const [path, label] of [
    [postgresPasswordFile, "PostgreSQL password file"],
    [canonicalAcceptancePasswordFile, "canonical acceptance password file"],
    [runtimeEnvFile, "acceptance runtime environment file"],
  ] as const) {
    try {
      const protectedFileOptions = {
        ...(fs === undefined ? {} : { fs }),
        ...(options.runtimeUid === undefined ? {} : { expectedUid: options.runtimeUid }),
        ...(options.runtimeGid === undefined ? {} : { expectedGid: options.runtimeGid }),
        mode: ACCEPTANCE_PASSWORD_FILE_MODE,
        label,
      };
      validateProtectedFile(path, protectedFileOptions);
    } catch (error) {
      fail(error instanceof Error ? error.message : `${label} is unsafe`);
    }
  }

  return {
    database,
    primaryDatabase: "bmo",
    port,
    bindHost: ACCEPTANCE_BIND_HOST,
    network: ACCEPTANCE_NETWORK,
    project: ACCEPTANCE_PROJECT,
    container: ACCEPTANCE_CONTAINER,
    postgresContainer: ACCEPTANCE_POSTGRES_CONTAINER,
    image,
    codeDirectory,
    internalPort: ACCEPTANCE_INTERNAL_PORT,
    migrationsDisabled: true,
    postgresUser: "bmo",
    postgresPasswordFile,
    canonicalAcceptancePasswordFile,
    runtimeEnvFile,
  };
}
