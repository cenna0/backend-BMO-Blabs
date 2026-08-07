import { chmodSync, closeSync, existsSync, lstatSync, openSync } from "node:fs";
import { dirname, isAbsolute } from "node:path";

import { loadAcceptanceConfig, type AcceptanceConfig } from "./acceptance-config.js";
import { fileFixtureStateStore, readAcceptancePasswordFile } from "./acceptance-fixture.js";
import { runAcceptance, createFetchAcceptanceHttpClient } from "./acceptance-runner.js";
import {
  createDockerExecutor,
  startAcceptanceRuntime,
  statusAcceptanceRuntime,
  stopAcceptanceRuntime,
  type AcceptanceDocker,
} from "./acceptance-runtime.js";
import { sanitizeChildOutput } from "./compose.js";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function stateFilePath(): string {
  const value = required("P9_ACCEPTANCE_STATE_FILE");
  if (!isAbsolute(value)) throw new Error("P9_ACCEPTANCE_STATE_FILE must be an absolute path");
  return value;
}

function prepareStateFile(path: string): void {
  if (!existsSync(path)) {
    if (!existsSync(dirname(path))) throw new Error("acceptance fixture state directory is unavailable");
    const descriptor = openSync(path, "wx", 0o600);
    try { chmodSync(path, 0o600); } finally { closeSync(descriptor); }
    return;
  }
  const metadata = lstatSync(path);
  if (metadata.isSymbolicLink() || !metadata.isFile() || (metadata.mode & 0o7777) !== 0o600) {
    throw new Error("acceptance fixture state file is unsafe");
  }
}

function validateExistingStateFile(path: string): void {
  if (!existsSync(path)) throw new Error("acceptance fixture state file is unavailable");
  const metadata = lstatSync(path);
  if (metadata.isSymbolicLink() || !metadata.isFile() || (metadata.mode & 0o7777) !== 0o600) {
    throw new Error("acceptance fixture state file is unsafe");
  }
}

export function buildAcceptanceWorkerArgs(config: AcceptanceConfig, stateFile: string, command: string, includePassword: boolean): string[] {
  const args = [
    "run",
    "--rm",
    "--name", `${config.container}-worker`,
    "--network", config.network,
    "--env-file", config.runtimeEnvFile,
    "--env", "P9_ENABLED=true",
    "--env", `P9_POSTGRES_USER=${config.postgresUser}`,
    "--env", `P9_POSTGRES_DB=${config.database}`,
    "--env", "P9_DATABASE_PASSWORD_FILE=/run/secrets/postgres_password",
    "--env", `P9_ACCEPTANCE_DATABASE=${config.database}`,
    "--env", "P9_ACCEPTANCE_MIGRATIONS_DISABLED=true",
    "--env", "P9_ACCEPTANCE_STATE_FILE=/run/p9-acceptance/fixture-state.json",
    "--mount", `type=bind,source=${config.codeDirectory},destination=/app/dist/src,readonly`,
    "--mount", `type=bind,source=${config.postgresPasswordFile},destination=/run/secrets/postgres_password,readonly`,
    "--mount", `type=bind,source=${stateFile},destination=/run/p9-acceptance/fixture-state.json`,
  ];
  if (includePassword) {
    args.push(
      "--env", "P9_ACCEPTANCE_PASSWORD_FILE=/run/secrets/acceptance_password",
      "--mount", `type=bind,source=${config.acceptancePasswordFile},destination=/run/secrets/acceptance_password,readonly`,
    );
  }
  args.push(config.image, "node", "dist/src/p9/operator/acceptance-worker.js", command);
  return args;
}

async function runWorker(config: AcceptanceConfig, command: string, includePassword: boolean, docker: AcceptanceDocker): Promise<string> {
  const stateFile = stateFilePath();
  if (command === "fixture-create" || command === "evidence-snapshot") prepareStateFile(stateFile);
  else validateExistingStateFile(stateFile);
  const result = await docker.run(buildAcceptanceWorkerArgs(config, stateFile, command, includePassword));
  if (result.exitCode !== 0) throw new Error(`acceptance worker failed: ${sanitizeChildOutput(result.stderr || result.stdout) || "no diagnostic output"}`);
  return result.stdout.trim();
}

export async function runAcceptanceCommand(command: string, docker = createDockerExecutor()): Promise<void> {
  const config = loadAcceptanceConfig();
  if (command === "runtime:validate-config") {
    process.stdout.write("acceptance runtime configuration valid\n");
    return;
  }
  if (command === "runtime:start") {
    await startAcceptanceRuntime(config, docker);
    process.stdout.write("acceptance runtime started\n");
    return;
  }
  if (command === "runtime:status") {
    const status = await statusAcceptanceRuntime(config, docker);
    process.stdout.write(`acceptance runtime ${status.status}; target ${status.database}\n`);
    return;
  }
  if (command === "runtime:stop") {
    await stopAcceptanceRuntime(config, docker);
    process.stdout.write("acceptance runtime stopped\n");
    return;
  }
  if (command === "fixture:validate-config") {
    stateFilePath();
    process.stdout.write("acceptance fixture configuration valid\n");
    return;
  }
  if (command === "fixture:create") {
    await runWorker(config, "fixture-create", true, docker);
    process.stdout.write("acceptance fixture created\n");
    return;
  }
  if (command === "fixture:status") {
    if (!existsSync(stateFilePath())) {
      process.stdout.write("acceptance fixture absent\n");
      return;
    }
    const output = await runWorker(config, "fixture-status", false, docker);
    process.stdout.write(`acceptance fixture ${output === "fixture-present" ? "present" : "absent"}\n`);
    return;
  }
  if (command === "fixture:cleanup") {
    await runWorker(config, "fixture-cleanup", false, docker);
    process.stdout.write("acceptance fixture cleaned\n");
    return;
  }
  if (command === "evidence:snapshot") {
    const output = await runWorker(config, "evidence-snapshot", false, docker);
    process.stdout.write(`${output}\n`);
    return;
  }
  if (command === "run") {
    const statePath = stateFilePath();
    validateExistingStateFile(statePath);
    const state = await fileFixtureStateStore(statePath).read();
    const evidence = await runAcceptance({
      targetDatabase: config.database,
      fixture: { email: state.email, userId: state.userId ?? "" },
      readPassword: async () => readAcceptancePasswordFile(config.acceptancePasswordFile),
      http: createFetchAcceptanceHttpClient(`http://${config.bindHost}:${config.port}/api/v1`),
    });
    process.stdout.write(`application acceptance prepared evidence: ${JSON.stringify(evidence)}\n`);
    return;
  }
  throw new Error("unknown P9 acceptance command");
}

if (process.argv[1]?.endsWith("acceptance-cli.js")) {
  try {
    await runAcceptanceCommand(process.argv[2] ?? "");
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "acceptance command failed"}\n`);
    process.exitCode = 1;
  }
}
