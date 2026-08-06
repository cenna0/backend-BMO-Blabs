import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

import {
  composeArgs,
  composeEnvironment,
  type ComposeSelection,
  runCompose,
  runComposeOutput,
  sanitizeChildOutput,
  validateComposeConfiguration,
  waitForProcess,
} from "./compose.js";
import {
  loadRestoreConfig,
  type RestoreConfig,
} from "./restore-config.js";

export class RestoreOperationError extends Error {
  constructor(
    message: string,
    public readonly category: string,
  ) {
    super(message);
    this.name = "RestoreOperationError";
  }
}

export interface RestoreDependencies {
  loadConfig: (directory: string) => Promise<RestoreConfig>;
  validateCompose: (config: RestoreConfig) => Promise<void>;
  authenticateArtifact: (config: RestoreConfig) => Promise<void>;
  assertTargetAbsent: (config: RestoreConfig) => Promise<void>;
  createTarget: (config: RestoreConfig) => Promise<void>;
  streamRestore: (config: RestoreConfig) => Promise<void>;
  cleanupTarget: (config: RestoreConfig) => Promise<void>;
}

export interface RunRestoreOptions {
  directory?: string;
  dependencies?: RestoreDependencies;
}

function sanitizedError(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  return sanitizeChildOutput(error.message) || fallback;
}

function composeSelection(config: RestoreConfig): ComposeSelection {
  return {
    composeFile: config.composeFile,
    projectName: config.composeProject,
    envFile: config.composeEnvFile,
  };
}

function restoreComposeArgs(config: RestoreConfig, command: string[]): string[] {
  const selection = composeSelection(config);
  return composeArgs(command, config.composeFile, selection);
}

function postgresShell(config: RestoreConfig, operation: string): string {
  const target = config.targetDatabase;
  if (operation === "check") {
    return `set -eu; export PGPASSWORD="$(cat /run/secrets/postgres_password)"; if [ "$(psql -Atqc "SELECT 1 FROM pg_database WHERE datname = '${target}'" -U "$POSTGRES_USER" -d "$POSTGRES_DB")" = "1" ]; then printf 'P9_RESTORE_TARGET_EXISTS\\n' >&2; exit 2; fi`;
  }
  if (operation === "create") {
    return `set -eu; export PGPASSWORD="$(cat /run/secrets/postgres_password)"; createdb -U "$POSTGRES_USER" '${target}'`;
  }
  if (operation === "drop") {
    return `set -eu; export PGPASSWORD="$(cat /run/secrets/postgres_password)"; dropdb --if-exists -U "$POSTGRES_USER" '${target}'`;
  }
  return `set -eu; export PGPASSWORD="$(cat /run/secrets/postgres_password)"; pg_restore --format=custom --no-owner --no-privileges --exit-on-error --username="$POSTGRES_USER" --dbname='${target}' || { status=$?; printf 'P9_PG_RESTORE_EXIT=%s\\n' "$status" >&2; exit "$status"; }`;
}

async function authenticateArtifact(config: RestoreConfig): Promise<void> {
  const gpg = spawn("gpg", [
    "--batch",
    "--yes",
    "--no-tty",
    "--pinentry-mode",
    "loopback",
    "--passphrase-file",
    config.passphraseFile,
    "--output",
    "/dev/null",
    "--decrypt",
    config.artifactPath,
  ], { stdio: ["ignore", "ignore", "pipe"] });
  await waitForProcess(gpg, "GPG authentication", { failureKind: "gpg-authentication" });
}

async function assertTargetAbsent(config: RestoreConfig): Promise<void> {
  let output: string;
  try {
    output = await runComposeOutput(
      restoreComposeArgs(config, ["exec", "-T", "postgres", "sh", "-c", postgresShell(config, "check")]),
      { env: composeEnvironment(config.postgresPasswordFile), failureKind: "restore-target-check" },
    );
  } catch (error: unknown) {
    if (error instanceof Error && error.message.includes("P9_RESTORE_TARGET_EXISTS")) {
      throw new RestoreOperationError("restore target already exists", "target-existing");
    }
    throw error;
  }
  if (output.includes("P9_RESTORE_TARGET_EXISTS")) {
    throw new RestoreOperationError("restore target already exists", "target-existing");
  }
}

async function createTarget(config: RestoreConfig): Promise<void> {
  await runCompose(
    restoreComposeArgs(config, ["exec", "-T", "postgres", "sh", "-c", postgresShell(config, "create")]),
    { env: composeEnvironment(config.postgresPasswordFile), failureKind: "restore-target-creation" },
  );
}

async function cleanupTarget(config: RestoreConfig): Promise<void> {
  await runCompose(
    restoreComposeArgs(config, ["exec", "-T", "postgres", "sh", "-c", postgresShell(config, "drop")]),
    { env: composeEnvironment(config.postgresPasswordFile), failureKind: "restore-cleanup" },
  );
}

async function streamRestore(config: RestoreConfig): Promise<void> {
  const gpg = spawn("gpg", [
    "--batch",
    "--yes",
    "--no-tty",
    "--pinentry-mode",
    "loopback",
    "--passphrase-file",
    config.passphraseFile,
    "--decrypt",
    config.artifactPath,
  ], { stdio: ["ignore", "pipe", "pipe"] });
  const restore = spawn(
    "docker",
    restoreComposeArgs(config, ["exec", "-T", "postgres", "sh", "-c", postgresShell(config, "restore")]),
    {
      env: composeEnvironment(config.postgresPasswordFile),
      stdio: ["pipe", "ignore", "pipe"],
    },
  );
  restore.stdin?.on("error", () => undefined);
  gpg.stdout?.pipe(restore.stdin);

  const results = await Promise.allSettled([
    waitForProcess(gpg, "GPG decryption", { failureKind: "gpg-decryption" }),
    waitForProcess(restore, "pg_restore", { failureKind: "pg_restore" }),
  ]);
  const failed = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
  if (failed) throw failed.reason;
}

const runtimeDependencies: RestoreDependencies = {
  loadConfig: (directory) => loadRestoreConfig(directory),
  validateCompose: (config) => validateComposeConfiguration(config.postgresPasswordFile, composeSelection(config)),
  authenticateArtifact,
  assertTargetAbsent,
  createTarget,
  streamRestore,
  cleanupTarget,
};

export async function runRestore(options: RunRestoreOptions = {}): Promise<{
  backupIdentifier: string;
  targetDatabase: string;
}> {
  const directory = options.directory ?? process.argv[2];
  if (!directory) throw new RestoreOperationError("usage: npm run p9:restore -- /opt/bmo/p9.1-restore-tests/incoming/<backup-id>", "usage");
  const dependencies = options.dependencies ?? runtimeDependencies;
  const config = await dependencies.loadConfig(directory);

  await dependencies.validateCompose(config);
  await dependencies.authenticateArtifact(config);
  await dependencies.assertTargetAbsent(config);

  let targetCreationAttempted = false;
  try {
    targetCreationAttempted = true;
    await dependencies.createTarget(config);
    await dependencies.streamRestore(config);
  } catch (error: unknown) {
    if (targetCreationAttempted) {
      try {
        await dependencies.cleanupTarget(config);
      } catch (cleanupError: unknown) {
        const original = sanitizedError(error, "restore failed");
        const cleanup = sanitizedError(cleanupError, "restore target cleanup failed");
        throw new RestoreOperationError(`${original}; ${cleanup}`, "restore-cleanup");
      }
    }
    throw error;
  }

  return { backupIdentifier: config.backupIdentifier, targetDatabase: config.targetDatabase };
}

async function main(): Promise<void> {
  const result = await runRestore();
  process.stdout.write(`${result.backupIdentifier} restored to ${result.targetDatabase}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    process.stderr.write(`${sanitizedError(error, "restore failed")}\n`);
    process.exitCode = 1;
  });
}
