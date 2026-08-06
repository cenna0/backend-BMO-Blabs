import {
  accessSync,
  constants,
  lstatSync,
  readdirSync,
  type Stats,
} from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

import {
  loadBackupConfig,
  type BackupConfigFs,
  type LoadBackupConfigOptions,
} from "./backup-config.js";
import { validateBackupSet, type BackupManifest } from "./backup-manifest.js";

export const RESTORE_STAGING_ROOT = "/opt/bmo/p9.1-restore-tests";
export const RESTORE_INCOMING_DIRECTORY = "incoming";
export const RESTORE_FILE_MODE = 0o600;
export const RESTORE_DIRECTORY_MODE = 0o700;
export const RESTORE_TARGET_PREFIX = "bmo_restore_";
export const RESTORE_COMPOSE_PROJECT = "bmo-p9-1";

const BACKUP_SET_FILE_NAMES = ["artifact", "checksum", "manifest"] as const;
const SAFE_BACKUP_IDENTIFIER = /^p9-(?:daily|weekly)-[a-z0-9-]{1,110}$/i;
const SAFE_RESTORE_DATABASE = /^bmo_restore_[a-z0-9_]{1,50}$/;

export interface RestoreConfig {
  setDirectory: string;
  backupIdentifier: string;
  artifactPath: string;
  checksumPath: string;
  manifestPath: string;
  passphraseFile: string;
  postgresPasswordFile: string;
  targetDatabase: string;
  primaryDatabase: string;
  postgresMajorVersion: number;
  migrationState: string;
  manifest: BackupManifest;
  composeFile: string;
  composeProject: string;
  composeEnvFile: string;
}

interface RestoreStats {
  isFile(): boolean;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
  mode: number;
  uid: number;
  gid: number;
  size: number;
}

export interface RestoreConfigOptions extends Omit<LoadBackupConfigOptions, "fs"> {
  env?: NodeJS.ProcessEnv;
  protectedFs?: BackupConfigFs;
  restoreStagingRoot?: string;
}

export class RestoreConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RestoreConfigError";
  }
}

const runtimeFs = {
  lstatSync: (path: string): Stats => lstatSync(path),
  readdirSync: (path: string): string[] => readdirSync(path),
  accessSync,
};

function fail(message: string): never {
  throw new RestoreConfigError(message);
}

function runtimeUid(): number {
  if (typeof process.getuid !== "function") fail("restore runtime user is unavailable");
  return process.getuid();
}

function runtimeGid(): number {
  if (typeof process.getgid !== "function") fail("restore runtime group is unavailable");
  return process.getgid();
}

function validateDirectoryMetadata(
  path: string,
  label: string,
  expectedUid: number,
  expectedGid: number,
): void {
  let metadata: RestoreStats;
  try {
    metadata = runtimeFs.lstatSync(path);
  } catch {
    fail(`${label} is unavailable`);
  }
  if (metadata.isSymbolicLink()) fail(`${label} must not be a symlink`);
  if (!metadata.isDirectory()) fail(`${label} must be a directory`);
  if (metadata.uid !== expectedUid || metadata.gid !== expectedGid) {
    fail(`${label} ownership is unsafe`);
  }
  if ((metadata.mode & 0o7777) !== RESTORE_DIRECTORY_MODE) {
    fail(`${label} permissions are unsafe`);
  }
}

function validateStagedFile(path: string, label: string, expectedUid: number, expectedGid: number): void {
  let metadata: RestoreStats;
  try {
    metadata = runtimeFs.lstatSync(path);
  } catch {
    fail(`${label} is missing`);
  }
  if (metadata.isSymbolicLink()) fail(`${label} must not be a symlink`);
  if (!metadata.isFile() || metadata.size <= 0) fail(`${label} must be a non-empty regular file`);
  if (metadata.uid !== expectedUid || metadata.gid !== expectedGid) {
    fail(`${label} ownership is unsafe`);
  }
  if ((metadata.mode & 0o7777) !== RESTORE_FILE_MODE) {
    fail(`${label} permissions are unsafe`);
  }
  try {
    runtimeFs.accessSync(path, constants.R_OK);
  } catch {
    fail(`${label} is unreadable`);
  }
}

function validateBackupIdentifier(value: string): void {
  if (!SAFE_BACKUP_IDENTIFIER.test(value)) fail("restore backup identifier is invalid");
}

export function validateRestoreDatabaseName(value: string, primaryDatabase: string): void {
  if (!SAFE_RESTORE_DATABASE.test(value)) fail("P9_RESTORE_DATABASE is not a safe disposable database identifier");
  if (value === primaryDatabase) fail("restore target must not be the primary database");
}

function requiredEnvironmentValue(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) fail(`${name} is required`);
  return value;
}

function stagedFilePaths(setDirectory: string, backupIdentifier: string) {
  const artifactPath = join(setDirectory, `${backupIdentifier}.dump.gpg`);
  return {
    artifactPath,
    checksumPath: `${artifactPath}.sha256`,
    manifestPath: join(setDirectory, `${backupIdentifier}.manifest.json`),
  };
}

export async function loadRestoreConfig(
  requestedSetDirectory: string,
  options: RestoreConfigOptions = {},
): Promise<RestoreConfig> {
  if (!isAbsolute(requestedSetDirectory)) fail("restore staged set path must be absolute");
  const setDirectory = resolve(requestedSetDirectory);
  const stagingRoot = resolve(options.restoreStagingRoot ?? RESTORE_STAGING_ROOT);
  const incomingDirectory = join(stagingRoot, RESTORE_INCOMING_DIRECTORY);

  if (dirname(setDirectory) !== incomingDirectory) {
    fail("restore staged set must be directly under the dedicated incoming directory");
  }

  const backupIdentifier = basename(setDirectory);
  validateBackupIdentifier(backupIdentifier);

  const expectedUid = options.runtimeUid ?? runtimeUid();
  const expectedGid = options.runtimeGid ?? runtimeGid();
  validateDirectoryMetadata(stagingRoot, "restore staging root", expectedUid, expectedGid);
  validateDirectoryMetadata(incomingDirectory, "restore incoming directory", expectedUid, expectedGid);
  validateDirectoryMetadata(setDirectory, "restore staged set", expectedUid, expectedGid);

  let names: string[];
  try {
    names = runtimeFs.readdirSync(setDirectory).sort();
  } catch {
    fail("restore staged set cannot be inventoried");
  }
  const paths = stagedFilePaths(setDirectory, backupIdentifier);
  const expectedNames = [basename(paths.artifactPath), basename(paths.checksumPath), basename(paths.manifestPath)].sort();
  if (names.length !== expectedNames.length || names.some((name, index) => name !== expectedNames[index])) {
    fail("restore staged set must contain exactly the encrypted artifact, checksum sidecar, and manifest");
  }

  validateStagedFile(paths.artifactPath, "restore encrypted artifact", expectedUid, expectedGid);
  validateStagedFile(paths.checksumPath, "restore checksum sidecar", expectedUid, expectedGid);
  validateStagedFile(paths.manifestPath, "restore manifest", expectedUid, expectedGid);

  let manifest: BackupManifest;
  try {
    manifest = await validateBackupSet(paths);
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : "validation failed";
    fail(`restore exact backup set validation failed: ${detail}`);
  }

  const env = options.env ?? process.env;
  const backupConfigOptions: LoadBackupConfigOptions = {
    env,
    runtimeUid: expectedUid,
    runtimeGid: expectedGid,
    requireOutputDirectory: false,
  };
  if (options.protectedFs) backupConfigOptions.fs = options.protectedFs;
  const backupConfig = loadBackupConfig(backupConfigOptions);
  const primaryDatabase = env.P9_POSTGRES_DB ?? "bmo";
  const targetDatabase = requiredEnvironmentValue(env, "P9_RESTORE_DATABASE");
  validateRestoreDatabaseName(targetDatabase, primaryDatabase);
  const composeProject = requiredEnvironmentValue(env, "P9_COMPOSE_PROJECT");
  if (composeProject !== RESTORE_COMPOSE_PROJECT) fail("restore Compose project is not the isolated candidate project");
  const composeEnvFile = requiredEnvironmentValue(env, "P9_COMPOSE_ENV_FILE");
  if (!isAbsolute(composeEnvFile)) fail("P9_COMPOSE_ENV_FILE must be an absolute path");

  if (manifest.databaseIdentifier !== primaryDatabase) {
    fail("restore manifest database identifier does not match the configured primary database");
  }
  if (manifest.postgresMajorVersion !== backupConfig.postgresMajorVersion) {
    fail("restore manifest PostgreSQL major version does not match configuration");
  }
  if (manifest.creationResult !== "success") fail("restore manifest does not describe a successful backup");
  if (manifest.migrationState !== backupConfig.migrationState && backupConfig.migrationState !== "not-verified") {
    fail("restore manifest migration state does not match configuration");
  }

  const config: RestoreConfig = {
    setDirectory,
    backupIdentifier,
    ...paths,
    passphraseFile: backupConfig.passphraseFile,
    postgresPasswordFile: backupConfig.postgresPasswordFile,
    targetDatabase,
    primaryDatabase,
    postgresMajorVersion: manifest.postgresMajorVersion,
    migrationState: manifest.migrationState,
    manifest,
    composeFile: env.P9_COMPOSE_FILE ?? "../p9.1-compose.yml",
    composeProject,
    composeEnvFile,
  };
  return config;
}

export function stagedSetFileNames(backupIdentifier: string): string[] {
  validateBackupIdentifier(backupIdentifier);
  const paths = stagedFilePaths(".", backupIdentifier);
  return [basename(paths.artifactPath), basename(paths.checksumPath), basename(paths.manifestPath)];
}

export const restoreBackupSetFileKinds = BACKUP_SET_FILE_NAMES;
