import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import {
  BackupConfigError,
  loadBackupConfig,
  type BackupConfig,
  type LoadBackupConfigOptions,
} from "./backup-config.js";

export function runBackupConfigPreflight(options: LoadBackupConfigOptions = {}): BackupConfig {
  return loadBackupConfig(options);
}

function main(): void {
  try {
    runBackupConfigPreflight({ env: process.env });
    process.stdout.write("P9.1 backup configuration preflight passed.\n");
  } catch (error: unknown) {
    process.stderr.write(`${error instanceof BackupConfigError ? error.message : "backup configuration preflight failed"}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
