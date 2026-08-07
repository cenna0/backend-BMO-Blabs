import { isAbsolute } from "node:path";

import { createP9Client, disconnectP9Client } from "../db/client.js";
import { parseP9Config } from "../config.js";
import { loadP9DatabaseUrlFromSecret } from "../database-url.js";
import {
  cleanupAcceptanceFixture,
  createAcceptanceFixture,
  fileFixtureStateStore,
  readAcceptancePasswordFile,
  statusAcceptanceFixture,
  type AcceptanceFixtureDatabase,
} from "./acceptance-fixture.js";
import { readAcceptanceCounts } from "./acceptance-evidence.js";
import { validateProtectedFile } from "./protected-file.js";
import { validateRuntimeAcceptancePasswordFile } from "./acceptance-secret.js";
import { validateRestoreDatabaseName } from "./restore-config.js";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function validateWorkerConfiguration(database: string, command: string): void {
  try {
    validateRestoreDatabaseName(database, "bmo");
  } catch {
    throw new Error("acceptance worker requires a safe restore target");
  }
  if (process.env.P9_POSTGRES_DB !== database) throw new Error("acceptance worker database identity mismatch");
  if (process.env.P9_POSTGRES_USER !== "bmo") throw new Error("acceptance worker PostgreSQL user is unsafe");
  if (process.env.P9_ACCEPTANCE_MIGRATIONS_DISABLED !== "true") throw new Error("acceptance worker migrations must be disabled");
  const stateFile = process.env.P9_ACCEPTANCE_STATE_FILE ?? "";
  if (!isAbsolute(stateFile)) throw new Error("acceptance worker state path is unsafe");
  validateProtectedFile(stateFile, { label: "acceptance fixture state file" });
  if (command === "fixture-create") {
    validateRuntimeAcceptancePasswordFile(required("P9_ACCEPTANCE_PASSWORD_FILE"));
  }
  validateProtectedFile(required("P9_DATABASE_PASSWORD_FILE"), { label: "postgres password file" });
}

export async function runAcceptanceWorker(command: string): Promise<void> {
  const database = required("P9_ACCEPTANCE_DATABASE");
  const stateFile = required("P9_ACCEPTANCE_STATE_FILE");
  validateWorkerConfiguration(database, command);
  loadP9DatabaseUrlFromSecret(process.env);
  const client = createP9Client(parseP9Config(process.env));
  const db = client as unknown as AcceptanceFixtureDatabase;
  const stateStore = fileFixtureStateStore(stateFile);
  try {
    if (command === "fixture-create") {
      await createAcceptanceFixture({
        database,
        db,
        stateStore,
        readPassword: async () => readAcceptancePasswordFile(required("P9_ACCEPTANCE_PASSWORD_FILE")),
      });
      process.stdout.write("fixture-created\n");
      return;
    }
    if (command === "fixture-status") {
      const status = await statusAcceptanceFixture(database, db, await stateStore.read());
      process.stdout.write(`${status.present ? "fixture-present" : "fixture-absent"}\n`);
      return;
    }
    if (command === "fixture-cleanup") {
      await cleanupAcceptanceFixture({ database, db, state: await stateStore.read() });
      await stateStore.remove();
      process.stdout.write("fixture-cleaned\n");
      return;
    }
    if (command === "evidence-snapshot") {
      process.stdout.write(`${JSON.stringify(await readAcceptanceCounts(client as never))}\n`);
      return;
    }
    throw new Error("unknown acceptance worker command");
  } finally {
    await disconnectP9Client(client);
  }
}

if (process.argv[1]?.endsWith("acceptance-worker.js")) {
  await runAcceptanceWorker(process.argv[2] ?? "");
}
