import { createHash } from "node:crypto";
import { createReadStream, readFileSync, statSync } from "node:fs";
import { basename, resolve } from "node:path";
import { spawn } from "node:child_process";

import { composeArgs, runCompose, waitForProcess } from "./compose.js";

const targetDatabase = process.env.P9_RESTORE_DATABASE;
const primaryDatabase = process.env.P9_POSTGRES_DB ?? "bmo";
const passphraseFile = process.env.P9_BACKUP_PASSPHRASE_FILE;
const backupPath = process.argv[2] ? resolve(process.argv[2]) : undefined;

function validateDatabaseName(value: string): void {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(value)) throw new Error("P9_RESTORE_DATABASE must be a safe PostgreSQL identifier");
}

async function checksum(path: string): Promise<string> {
  return await new Promise<string>((resolveHash, reject) => {
    const digest = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("data", (chunk) => digest.update(chunk));
    stream.once("error", reject);
    stream.once("end", () => resolveHash(digest.digest("hex")));
  });
}

async function prepareTarget(): Promise<void> {
  const shell = `set -eu; export PGPASSWORD=$(cat /run/secrets/postgres_password); if [ "$(psql -Atqc "SELECT 1 FROM pg_database WHERE datname = '${targetDatabase}'" -U "$POSTGRES_USER" -d "$POSTGRES_DB")" = "1" ]; then echo target database already exists >&2; exit 2; fi; createdb -U "$POSTGRES_USER" '${targetDatabase}'`;
  await runCompose(composeArgs(["exec", "-T", "postgres", "sh", "-c", shell]));
}

async function main(): Promise<void> {
  if (!backupPath) throw new Error("usage: npm run p9:restore -- /path/to/backup.dump.gpg");
  if (!targetDatabase) throw new Error("P9_RESTORE_DATABASE is required and must be a fresh database");
  if (targetDatabase === primaryDatabase) throw new Error("restore target must not be the primary database");
  validateDatabaseName(targetDatabase);
  if (!passphraseFile) throw new Error("P9_BACKUP_PASSPHRASE_FILE is required");
  if ((statSync(passphraseFile).mode & 0o077) !== 0) throw new Error("backup passphrase file must not be group/world accessible");
  const expected = readFileSync(`${backupPath}.sha256`, "utf8").trim().split(/\s+/)[0];
  const actual = await checksum(backupPath);
  if (!expected || expected !== actual) throw new Error("backup checksum validation failed");

  await prepareTarget();
  const decrypt = spawn("gpg", ["--batch", "--yes", "--pinentry-mode", "loopback", "--passphrase-file", passphraseFile, "--decrypt", backupPath], { stdio: ["ignore", "pipe", "ignore"] });
  const restoreShell = `set -eu; export PGPASSWORD=$(cat /run/secrets/postgres_password); exec pg_restore --format=custom --no-owner --no-privileges --exit-on-error --username="$POSTGRES_USER" --dbname='${targetDatabase}'`;
  const restore = spawn("docker", composeArgs(["exec", "-T", "postgres", "sh", "-c", restoreShell]), { stdio: ["pipe", "ignore", "ignore"] });
  decrypt.stdout?.pipe(restore.stdin);
  await Promise.all([waitForProcess(decrypt, "backup decryption"), waitForProcess(restore, "pg_restore")]);
  process.stdout.write(`${basename(backupPath)} restored to ${targetDatabase}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : "restore failed"}\n`);
  process.exitCode = 1;
});
