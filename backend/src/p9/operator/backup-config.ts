import { accessSync, constants, lstatSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export const BACKUP_PASSPHRASE_FILE_ENV = "P9_BACKUP_PASSPHRASE_FILE";
export const CANONICAL_BACKUP_MATERIAL_PATH =
  "/opt/bmo/secrets/p9.1/backup/backup-encryption-material-v1";
export const BACKUP_MATERIAL_MODE = 0o440;
export const BACKUP_MATERIAL_MINIMUM_LENGTH = 16;

export interface BackupConfig {
  directory: string | undefined;
  passphraseFile: string;
  kind: "daily" | "weekly";
  retention: number;
  databaseIdentifier: string;
  postgresMajorVersion: number;
  migrationState: string;
}

export interface BackupConfigFs {
  lstatSync(path: string): BackupMaterialStats;
  accessSync(path: string, mode?: number): void;
  readFileSync(path: string, encoding: BufferEncoding): string;
}

export interface BackupMaterialStats {
  isFile(): boolean;
  isSymbolicLink(): boolean;
  mode: number;
  uid: number;
  gid: number;
}

export interface LoadBackupConfigOptions {
  env?: NodeJS.ProcessEnv;
  fs?: BackupConfigFs;
  runtimeGid?: number;
  requireOutputDirectory?: boolean;
}

export class BackupConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackupConfigError";
  }
}

const runtimeFs: BackupConfigFs = {
  lstatSync,
  accessSync,
  readFileSync: (path, encoding) => readFileSync(path, { encoding }),
};

function fail(message: string): never {
  throw new BackupConfigError(message);
}

function runtimeGroupId(): number {
  if (typeof process.getgid !== "function") fail("backup runtime group is unavailable");
  return process.getgid();
}

export function loadBackupConfig(options: LoadBackupConfigOptions = {}): BackupConfig {
  const env = options.env ?? process.env;
  const fs = options.fs ?? runtimeFs;
  const requireOutputDirectory = options.requireOutputDirectory ?? false;

  if (requireOutputDirectory && !env.P9_BACKUP_DIR) {
    fail("P9_BACKUP_DIR is required");
  }

  const passphraseFile = env[BACKUP_PASSPHRASE_FILE_ENV];
  if (!passphraseFile) fail("P9_BACKUP_PASSPHRASE_FILE is required");
  if (passphraseFile !== CANONICAL_BACKUP_MATERIAL_PATH) {
    fail("backup encryption material path is not canonical");
  }

  let metadata: BackupMaterialStats;
  try {
    metadata = fs.lstatSync(passphraseFile);
  } catch {
    fail("backup encryption material is unavailable");
  }

  if (metadata.isSymbolicLink()) fail("backup encryption material must not be a symlink");
  if (!metadata.isFile()) fail("backup encryption material must be a regular file");
  if (metadata.uid !== 0 || metadata.gid !== (options.runtimeGid ?? runtimeGroupId())) {
    fail("backup encryption material ownership is unsafe");
  }
  if ((metadata.mode & 0o7777) !== BACKUP_MATERIAL_MODE) {
    fail("backup encryption material permissions are unsafe");
  }

  try {
    fs.accessSync(passphraseFile, constants.R_OK);
  } catch {
    fail("backup encryption material is unreadable");
  }

  let material: string;
  try {
    material = fs.readFileSync(passphraseFile, "utf8");
  } catch {
    fail("backup encryption material is unreadable");
  }
  if (material.trim().length === 0) fail("backup encryption material is empty");
  if (material.trim().length < BACKUP_MATERIAL_MINIMUM_LENGTH) {
    fail("backup encryption material is too weak");
  }

  const kind = env.P9_BACKUP_KIND === "weekly" ? "weekly" : "daily";
  return {
    directory: requireOutputDirectory && env.P9_BACKUP_DIR ? resolve(env.P9_BACKUP_DIR) : undefined,
    passphraseFile,
    kind,
    retention: kind === "weekly" ? 4 : 7,
    databaseIdentifier: env.P9_POSTGRES_DB ?? "bmo",
    postgresMajorVersion: Number(env.P9_POSTGRES_MAJOR_VERSION ?? "16"),
    migrationState: env.P9_BACKUP_MIGRATION_STATE ?? "not-verified",
  };
}
