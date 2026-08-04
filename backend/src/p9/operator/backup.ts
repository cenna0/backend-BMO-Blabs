import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream, chmodSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { spawn } from "node:child_process";

import { composeArgs, waitForProcess } from "./compose.js";

type BackupKind = "daily" | "weekly";

const kind = process.env.P9_BACKUP_KIND === "weekly" ? "weekly" : "daily";
const retention: Record<BackupKind, number> = { daily: 7, weekly: 4 };
const backupDir = resolve(process.env.P9_BACKUP_DIR ?? "");
const passphraseFile = process.env.P9_BACKUP_PASSPHRASE_FILE;

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
    chmodSync(temporaryPath, 0o600);
    renameSync(temporaryPath, outputPath);
    const hash = await new Promise<string>((resolveHash, reject) => {
      const digest = createHash("sha256");
      const stream = createReadStream(outputPath);
      stream.on("data", (chunk) => digest.update(chunk));
      stream.once("error", reject);
      stream.once("end", () => resolveHash(digest.digest("hex")));
    });
    const checksumTemporaryPath = `${checksumPath}.${randomUUID()}.tmp`;
    writeFileSync(checksumTemporaryPath, `${hash}  ${basename(outputPath)}\n`, { mode: 0o600 });
    renameSync(checksumTemporaryPath, checksumPath);
    const candidates = readdirSync(config.directory)
      .filter((entry) => entry.startsWith(`p9-${kind}-`) && entry.endsWith(".dump.gpg"))
      .sort()
      .reverse();
    for (const stale of candidates.slice(retention[kind])) {
      unlinkSync(join(config.directory, stale));
      const staleChecksum = `${stale}.sha256`;
      try { unlinkSync(join(config.directory, staleChecksum)); } catch { /* already absent */ }
    }
    process.stdout.write(`${outputPath}\n${hash}\n`);
  } catch (error) {
    try { unlinkSync(temporaryPath); } catch { /* best effort cleanup */ }
    throw error;
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : "backup failed"}\n`);
  process.exitCode = 1;
});
