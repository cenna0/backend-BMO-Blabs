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
import { ACCEPTANCE_RUNTIME_STATE_FILE, validateRuntimeAcceptanceStateFile } from "./acceptance-state.js";
import { validateRuntimeAcceptancePasswordFile } from "./acceptance-secret.js";
import { validateRestoreDatabaseName } from "./restore-config.js";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export function validateAcceptanceWorkerConfiguration(env: NodeJS.ProcessEnv, command: string): void {
  const database = env.P9_ACCEPTANCE_DATABASE;
  if (!database) throw new Error("P9_ACCEPTANCE_DATABASE is required");
  try {
    validateRestoreDatabaseName(database, "bmo");
  } catch {
    throw new Error("acceptance worker requires a safe restore target");
  }
  if (env.P9_POSTGRES_DB !== database) throw new Error("acceptance worker database identity mismatch");
  if (env.P9_POSTGRES_USER !== "bmo") throw new Error("acceptance worker PostgreSQL user is unsafe");
  if (env.P9_ACCEPTANCE_MIGRATIONS_DISABLED !== "true") throw new Error("acceptance worker migrations must be disabled");
  const stateFile = env.P9_ACCEPTANCE_STATE_FILE ?? "";
  if (command === "fixture-create" || command === "fixture-status" || command === "fixture-cleanup") {
    if (!isAbsolute(stateFile) || stateFile !== ACCEPTANCE_RUNTIME_STATE_FILE) throw new Error("acceptance worker state path is unsafe");
    validateRuntimeAcceptanceStateFile(stateFile);
  }
  if (command === "fixture-create") {
    validateRuntimeAcceptancePasswordFile(required("P9_ACCEPTANCE_PASSWORD_FILE"));
  }
  if (!env.DATABASE_URL) throw new Error("acceptance worker database URL handoff is unavailable");
}

export async function runAcceptanceWorker(command: string): Promise<void> {
  const database = required("P9_ACCEPTANCE_DATABASE");
  const stateFile = process.env.P9_ACCEPTANCE_STATE_FILE ?? "";
  validateAcceptanceWorkerConfiguration(process.env, command);
  loadP9DatabaseUrlFromSecret(process.env);
  const client = createP9Client(parseP9Config(process.env));
  const db = client as unknown as AcceptanceFixtureDatabase;
  const stateStore = stateFile ? fileFixtureStateStore(stateFile) : undefined;
  try {
    if (command === "fixture-create") {
      if (!stateStore) throw new Error("acceptance fixture state is unavailable");
      const pending = await stateStore.read();
      if (pending.userId !== null) throw new Error("acceptance fixture state already contains a created user");
      await createAcceptanceFixture({
        database,
        runId: pending.runId,
        db,
        stateStore,
        readPassword: async () => readAcceptancePasswordFile(required("P9_ACCEPTANCE_PASSWORD_FILE")),
      });
      process.stdout.write(`${JSON.stringify({ state: await stateStore.read() })}\n`);
      return;
    }
    if (command === "fixture-status") {
      if (!stateStore) throw new Error("acceptance fixture state is unavailable");
      const status = await statusAcceptanceFixture(database, db, await stateStore.read());
      process.stdout.write(`${status.present ? "fixture-present" : "fixture-absent"}\n`);
      return;
    }
    if (command === "fixture-cleanup") {
      if (!stateStore) throw new Error("acceptance fixture state is unavailable");
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

export async function main(command = process.argv[2] ?? ""): Promise<number> {
  try {
    await runAcceptanceWorker(command);
    return 0;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "acceptance worker failed"}\n`);
    return 1;
  }
}
