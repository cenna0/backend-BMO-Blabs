import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";

import { composeArgs, waitForProcess } from "./compose.js";
import { cleanupFinalizedBackupSet, finalizeBackupSet, type FinalizedBackupSet } from "./backup-set.js";

type BackupKind = "daily" | "weekly";

const kind = process.env.P9_BACKUP_KIND === "weekly" ? "weekly" : "daily";
const retention: Record<BackupKind, number> = { daily: 7, weekly: 4 };
const backupDir = resolve(process.env.P9_BACKUP_DIR ?? "");
const passphraseFile = process.env.P9_BACKUP_PASSPHRASE_FILE;
const databaseIdentifier = process.env.P9_POSTGRES_DB ?? "bmo";
const postgresMajorVersion = Number(process.env.P9_POSTGRES_MAJOR_VERSION ?? "16");
const migrationState = process.env.P9_BACKUP_MIGRATION_STATE ?? "not-verified";

function requireConfig(): { directory: string; passphrase: string } {
  if (!process.env.P9_BACKUP_DIR) throw new Error("P9_BACKUP_DIR is required");
  if (!passphraseFile) throw new Error("P9_BACKUP_PASSPHRASE_FILE is required");
  const mode = statSync(passphraseFile).mode & 0o077;
  if (mode !== 0) throw new Error("backup passphrase file must not be group/world accessible");
  const passphrase = readFileSync(passphraseFile, "utf8").trim();
  if (passphrase.length < 16) throw new Error("backup passphrase must contain at least 16 characters");
  mkdirSync(backupDir, { recursive: true, mode: 0o700 });
  chmodSync(backupDir, 0o700);
  return { directory: backupDir, passphrase };
}

function dumpArgs(): string[] {
  return composeArgs([
    "exec", "-T", "postgres", "sh", "-c",
    "set -eu; export PGPASSWORD=$(cat /run/secrets/postgres_password); exec pg_dump --format=custom --no-owner --no-privileges --username=\"$POSTGRES_USER\" --dbname=\"$POSTGRES_DB\"",
  ]);
}

async function main(): Promise<void> {
  const config = requireConfig();
  const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const filename = `p9-${kind}-${timestamp}.dump.gpg`;
  const outputPath = join(config.directory, filename);
  const temporaryPath = join(config.directory, `.${filename}.${randomUUID()}.tmp`);
  const checksumPath = `${outputPath}.sha256`;
  const backupIdentifier = filename.slice(0, -".dump.gpg".length);
  const manifestPath = join(config.directory, `${backupIdentifier}.manifest.json`);
  let finalized: FinalizedBackupSet | undefined;

  const gpg = spawn("gpg", [
    "--batch",
    "--yes",
    "--pinentry-mode",
    "loopback",
    "--passphrase-file",
    passphraseFile!,
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
      databaseIdentifier,
      postgresMajorVersion,
      migrationState,
    });
    const candidates = readdirSync(config.directory)
      .filter((entry) => entry.startsWith(`p9-${kind}-`) && entry.endsWith(".dump.gpg"))
      .sort()
      .reverse();
    for (const stale of candidates.slice(retention[kind])) {
      unlinkSync(join(config.directory, stale));
      const staleChecksum = `${stale}.sha256`;
      try { unlinkSync(join(config.directory, staleChecksum)); } catch { /* already absent */ }
      const staleManifest = `${stale.slice(0, -".dump.gpg".length)}.manifest.json`;
      try { unlinkSync(join(config.directory, staleManifest)); } catch { /* already absent */ }
    }
    process.stdout.write(`${outputPath}\n${finalized.sha256}\n${manifestPath}\n`);
  } catch (error) {
    if (finalized) cleanupFinalizedBackupSet(finalized.paths);
    try { unlinkSync(temporaryPath); } catch { /* best effort cleanup */ }
    throw error;
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : "backup failed"}\n`);
  process.exitCode = 1;
});
