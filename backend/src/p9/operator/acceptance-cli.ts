import { existsSync } from "node:fs";
import { dirname, isAbsolute } from "node:path";

import { loadAcceptanceConfig, type AcceptanceConfig } from "./acceptance-config.js";
import {
  createPendingAcceptanceFixtureState,
  fileFixtureStateStore,
  readAcceptancePasswordFile,
  validateFixtureState,
  type FixtureState,
} from "./acceptance-fixture.js";
import { runAcceptance, createFetchAcceptanceHttpClient } from "./acceptance-runner.js";
import {
  createDockerExecutor,
  startAcceptanceRuntime,
  statusAcceptanceRuntime,
  stopAcceptanceRuntime,
  type AcceptanceDocker,
} from "./acceptance-runtime.js";
import {
  ACCEPTANCE_RUNTIME_STATE_FILE,
  ACCEPTANCE_RUNTIME_STATE_SOURCE_FILE,
  ACCEPTANCE_RUNTIME_STATE_TMPFS_SPEC,
  validateHostAcceptanceStateFile,
} from "./acceptance-state.js";
import { sanitizeChildOutput } from "./compose.js";
import {
  ACCEPTANCE_RUNTIME_PASSWORD_FILE,
  ACCEPTANCE_RUNTIME_PASSWORD_SOURCE_FILE,
  ACCEPTANCE_RUNTIME_PASSWORD_TMPFS_SPEC,
} from "./acceptance-secret.js";

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

function assertStateDirectory(path: string): void {
  if (!existsSync(dirname(path))) throw new Error("acceptance fixture state directory is unavailable");
}

function assertHostState(path: string): void {
  validateHostAcceptanceStateFile(path);
}

async function readHostState(path: string): Promise<FixtureState> {
  assertHostState(path);
  return fileFixtureStateStore(path).read();
}

async function removeHostState(path: string): Promise<void> {
  assertHostState(path);
  await fileFixtureStateStore(path).remove();
}

function assertStateMatchesPending(pending: FixtureState, created: FixtureState): void {
  validateFixtureState(created);
  if (
    created.database !== pending.database ||
    created.runId !== pending.runId ||
    created.email !== pending.email ||
    created.providerSubject !== pending.providerSubject ||
    created.displayName !== pending.displayName ||
    created.userId === null
  ) {
    throw new Error("acceptance fixture worker state identity mismatch");
  }
}

function parseWorkerFixtureState(output: string): FixtureState {
  try {
    const parsed = JSON.parse(output.trim()) as { state?: FixtureState };
    if (!parsed || !parsed.state) throw new Error("missing state");
    validateFixtureState(parsed.state);
    return parsed.state;
  } catch {
    throw new Error("acceptance fixture worker state output is invalid");
  }
}

export function buildAcceptanceWorkerArgs(
  config: AcceptanceConfig,
  stateFile: string,
  command: string,
  includePassword: boolean,
  includeState = true,
): string[] {
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
    "--mount", `type=bind,source=${config.codeDirectory},destination=/app/dist/src,readonly`,
    "--mount", `type=bind,source=${config.postgresPasswordFile},destination=/run/secrets/postgres_password,readonly`,
  ];
  if (includeState) {
    args.push(
      "--tmpfs", ACCEPTANCE_RUNTIME_STATE_TMPFS_SPEC,
      "--env", `P9_ACCEPTANCE_STATE_FILE=${ACCEPTANCE_RUNTIME_STATE_FILE}`,
      "--env", `P9_ACCEPTANCE_STATE_SOURCE_FILE=${ACCEPTANCE_RUNTIME_STATE_SOURCE_FILE}`,
      "--mount", `type=bind,source=${stateFile},destination=${ACCEPTANCE_RUNTIME_STATE_SOURCE_FILE},readonly`,
    );
  }
  if (includePassword) {
    args.push(
      "--tmpfs", ACCEPTANCE_RUNTIME_PASSWORD_TMPFS_SPEC,
      "--env", `P9_ACCEPTANCE_PASSWORD_FILE=${ACCEPTANCE_RUNTIME_PASSWORD_FILE}`,
      "--env", `P9_ACCEPTANCE_PASSWORD_SOURCE_FILE=${ACCEPTANCE_RUNTIME_PASSWORD_SOURCE_FILE}`,
      "--mount", `type=bind,source=${config.canonicalAcceptancePasswordFile},destination=${ACCEPTANCE_RUNTIME_PASSWORD_SOURCE_FILE},readonly`,
    );
  }
  args.push(config.image, "node", "dist/src/p9/operator/acceptance-worker-entrypoint.js", command);
  return args;
}

async function runWorker(
  config: AcceptanceConfig,
  command: string,
  includePassword: boolean,
  includeState: boolean,
  docker: AcceptanceDocker,
): Promise<string> {
  const stateFile = includeState ? stateFilePath() : "";
  if (includeState) assertHostState(stateFile);
  const result = await docker.run(buildAcceptanceWorkerArgs(config, stateFile, command, includePassword, includeState));
  if (result.exitCode !== 0) throw new Error(`acceptance worker failed: ${sanitizeChildOutput(result.stderr || result.stdout) || "no diagnostic output"}`);
  return result.stdout.trim();
}

async function createFixture(config: AcceptanceConfig, docker: AcceptanceDocker): Promise<void> {
  const statePath = stateFilePath();
  assertStateDirectory(statePath);
  if (existsSync(statePath)) {
    assertHostState(statePath);
    throw new Error("acceptance fixture state already exists; cleanup is required");
  }

  const pending = createPendingAcceptanceFixtureState(config.database);
  const stateStore = fileFixtureStateStore(statePath);
  await stateStore.write(pending);
  assertHostState(statePath);
  const output = await runWorker(config, "fixture-create", true, true, docker);
  const created = parseWorkerFixtureState(output);
  assertStateMatchesPending(pending, created);
  await stateStore.write(created);
  assertHostState(statePath);
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
    await createFixture(config, docker);
    process.stdout.write("acceptance fixture created\n");
    return;
  }
  if (command === "fixture:status") {
    const statePath = stateFilePath();
    if (!existsSync(statePath)) {
      process.stdout.write("acceptance fixture absent\n");
      return;
    }
    const output = await runWorker(config, "fixture-status", false, true, docker);
    process.stdout.write(`acceptance fixture ${output === "fixture-present" ? "present" : "absent"}\n`);
    return;
  }
  if (command === "fixture:cleanup") {
    const statePath = stateFilePath();
    await runWorker(config, "fixture-cleanup", false, true, docker);
    await removeHostState(statePath);
    process.stdout.write("acceptance fixture cleaned\n");
    return;
  }
  if (command === "evidence:snapshot") {
    const output = await runWorker(config, "evidence-snapshot", false, false, docker);
    process.stdout.write(`${output}\n`);
    return;
  }
  if (command === "run") {
    const state = await readHostState(stateFilePath());
    if (state.userId === null) throw new Error("acceptance fixture state is pending");
    const evidence = await runAcceptance({
      targetDatabase: config.database,
      fixture: { email: state.email, userId: state.userId },
      readPassword: async () => readAcceptancePasswordFile(config.canonicalAcceptancePasswordFile),
      http: createFetchAcceptanceHttpClient(`http://${config.bindHost}:${config.port}/api/v1`),
    });
    process.stdout.write(`application acceptance prepared evidence: ${JSON.stringify(evidence)}\n`);
    return;
  }
  throw new Error("unknown P9 acceptance command");
}

export async function main(
  argv: string[] = process.argv.slice(2),
  docker = createDockerExecutor(),
): Promise<number> {
  try {
    await runAcceptanceCommand(argv[0] ?? "", docker);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : "acceptance command failed";
    process.stderr.write(`${sanitizeChildOutput(message) || "acceptance command failed"}\n`);
    return 1;
  }
}
