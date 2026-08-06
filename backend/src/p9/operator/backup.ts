import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";

import {
  loadBackupConfig,
  type BackupConfig,
  type LoadBackupConfigOptions,
} from "./backup-config.js";
import { composeArgs, waitForProcess } from "./compose.js";
import { cleanupFinalizedBackupSet, finalizeBackupSet, type FinalizedBackupSet } from "./backup-set.js";

export function prepareBackupDirectory(directory: string | undefined): string {
  if (!directory) throw new Error("P9_BACKUP_DIR is required");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  return directory;
}

function dumpArgs(): string[] {
  return composeArgs([
    "exec", "-T", "postgres", "sh", "-c",
    "set -eu; export PGPASSWORD=$(cat /run/secrets/postgres_password); exec pg_dump --format=custom --no-owner --no-privileges --username=\"$POSTGRES_USER\" --dbname=\"$POSTGRES_DB\"",
  ]);
}

async function executeBackup(config: BackupConfig): Promise<void> {
  const directory = config.directory;
  if (!directory) throw new Error("P9_BACKUP_DIR is required");

  const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const filename = `p9-${config.kind}-${timestamp}.dump.gpg`;
  const outputPath = join(directory, filename);
  const temporaryPath = join(directory, `.${filename}.${randomUUID()}.tmp`);
  const checksumPath = `${outputPath}.sha256`;
  const backupIdentifier = filename.slice(0, -".dump.gpg".length);
  const manifestPath = join(directory, `${backupIdentifier}.manifest.json`);
  let finalized: FinalizedBackupSet | undefined;

  const gpg = spawn("gpg", [
    "--batch",
    "--yes",
    "--pinentry-mode",
    "loopback",
    "--passphrase-file",
    config.passphraseFile,
    "--symmetric",
    "--cipher-algo",
    "AES256",
    "--s2k-cipher-algo",
    "AES256",
    "--s2k-digest",
    "SHA512",
    "--output",
    temporaryPath,
  ], { stdio: ["pipe", "ignore", "ignore"] });
  const dump = spawn("docker", dumpArgs(), { stdio: ["ignore", "pipe", "ignore"] });
  dump.stdout?.pipe(gpg.stdin);

  try {
    await Promise.all([waitForProcess(dump, "pg_dump"), waitForProcess(gpg, "backup encryption")]);
    finalized = await finalizeBackupSet({
      artifactTempPath: temporaryPath,
      artifactPath: outputPath,
      checksumPath,
      manifestPath,
      backupIdentifier,
      timestamp: new Date().toISOString(),
      databaseIdentifier: config.databaseIdentifier,
      postgresMajorVersion: config.postgresMajorVersion,
      migrationState: config.migrationState,
    });
    const candidates = readdirSync(directory)
      .filter((entry) => entry.startsWith(`p9-${config.kind}-`) && entry.endsWith(".dump.gpg"))
      .sort()
      .reverse();
    for (const stale of candidates.slice(config.retention)) {
      unlinkSync(join(directory, stale));
      const staleChecksum = `${stale}.sha256`;
      try { unlinkSync(join(directory, staleChecksum)); } catch { /* already absent */ }
      const staleManifest = `${stale.slice(0, -".dump.gpg".length)}.manifest.json`;
      try { unlinkSync(join(directory, staleManifest)); } catch { /* already absent */ }
    }
    process.stdout.write(`${outputPath}\n${finalized.sha256}\n${manifestPath}\n`);
  } catch (error) {
    if (finalized) cleanupFinalizedBackupSet(finalized.paths);
    try { unlinkSync(temporaryPath); } catch { /* best effort cleanup */ }
    throw error;
  }
}

export interface BackupDependencies {
  loadConfig: (options?: LoadBackupConfigOptions) => BackupConfig;
  prepareDirectory: typeof prepareBackupDirectory;
  execute: (config: BackupConfig) => Promise<void>;
}

const runtimeDependencies: BackupDependencies = {
  loadConfig: loadBackupConfig,
  prepareDirectory: prepareBackupDirectory,
  execute: executeBackup,
};

export async function runBackup(dependencies: BackupDependencies = runtimeDependencies): Promise<void> {
  const config = dependencies.loadConfig({ requireOutputDirectory: true });
  const directory = dependencies.prepareDirectory(config.directory);
  await dependencies.execute({ ...config, directory });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runBackup().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "backup failed"}\n`);
    process.exitCode = 1;
  });
}
