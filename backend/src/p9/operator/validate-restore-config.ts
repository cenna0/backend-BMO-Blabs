import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import { loadRestoreConfig, RestoreConfigError } from "./restore-config.js";

async function main(): Promise<void> {
  const directory = process.argv[2];
  if (!directory) throw new RestoreConfigError("usage: npm run p9:restore:validate-config -- /opt/bmo/p9.1-restore-tests/incoming/<backup-id>");
  await loadRestoreConfig(directory, { env: process.env });
  process.stdout.write("P9.1 restore configuration preflight passed.\n");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof RestoreConfigError ? error.message : "restore configuration preflight failed"}\n`);
    process.exitCode = 1;
  });
}
