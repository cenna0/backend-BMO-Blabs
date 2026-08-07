import { spawn } from "node:child_process";

import { sanitizeChildOutput } from "./compose.js";
import type { AcceptanceConfig } from "./acceptance-config.js";

export interface DockerResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface AcceptanceDocker {
  run(args: string[]): Promise<DockerResult>;
}

export interface AcceptanceRuntimeHttpResult {
  status: number;
  body?: unknown;
}

export interface AcceptanceRuntimeHttpClient {
  request(path: string, signal?: AbortSignal): Promise<AcceptanceRuntimeHttpResult>;
}

export interface AcceptanceRuntimeWaitOptions {
  http?: AcceptanceRuntimeHttpClient;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  timeoutMs?: number;
  pollIntervalMs?: number;
}

export const ACCEPTANCE_READINESS_PATH = "/api/v1/ops/db/readyz" as const;
export const ACCEPTANCE_IDENTITY_PATH = "/api/v1/ops/db/identity" as const;
export const ACCEPTANCE_STARTUP_TIMEOUT_MS = 30_000 as const;
export const ACCEPTANCE_STARTUP_POLL_INTERVAL_MS = 250 as const;
export const ACCEPTANCE_READINESS_PROBE_TIMEOUT_MS = 3_000 as const;
export const ACCEPTANCE_IDENTITY_TIMEOUT_MS = 5_000 as const;

export interface AcceptanceRuntimeStatus {
  container: string;
  database: string;
  image: string;
  status: string;
  migrationsDisabled: true;
}

export class AcceptanceRuntimeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AcceptanceRuntimeError";
  }
}

export function buildAcceptanceRuntimeArgs(config: AcceptanceConfig): string[] {
  return [
    "run",
    "--detach",
    "--name", config.container,
    "--network", config.network,
    "--publish", `${config.bindHost}:${config.port}:${config.internalPort}`,
    "--env-file", config.runtimeEnvFile,
    "--env", "P9_ENABLED=true",
    // The container is private to the candidate network; host publication is loopback-only.
    "--env", "P9_BIND_HOST=0.0.0.0",
    "--env", `P9_BIND_PORT=${config.internalPort}`,
    "--env", `P9_POSTGRES_USER=${config.postgresUser}`,
    "--env", `P9_POSTGRES_DB=${config.database}`,
    "--env", "P9_DATABASE_PASSWORD_FILE=/run/secrets/postgres_password",
    "--env", "P9_ACCEPTANCE_MIGRATIONS_DISABLED=true",
    "--mount", `type=bind,source=${config.codeDirectory},destination=/app/dist/src,readonly`,
    "--mount", `type=bind,source=${config.postgresPasswordFile},destination=/run/secrets/postgres_password,readonly`,
    "--label", `com.bmo.p9.acceptance.project=${config.project}`,
    "--label", `com.bmo.p9.acceptance.target=${config.database}`,
    config.image,
    "node", "dist/src/p9/candidate-server.js",
  ];
}

function detail(result: DockerResult): string {
  return sanitizeChildOutput(result.stderr || result.stdout) || "no diagnostic output";
}

async function requiredDocker(docker: AcceptanceDocker, args: string[], label: string): Promise<DockerResult> {
  const result = await docker.run(args);
  if (result.exitCode !== 0) throw new AcceptanceRuntimeError(`${label} failed: ${detail(result)}`);
  return result;
}

async function ensureCandidateNetwork(docker: AcceptanceDocker, config: AcceptanceConfig): Promise<void> {
  await requiredDocker(docker, ["network", "inspect", config.network], "candidate network validation");
}

async function ensureCandidateImage(docker: AcceptanceDocker, config: AcceptanceConfig): Promise<void> {
  const result = await requiredDocker(
    docker,
    ["inspect", "--format", "{{.Config.Image}}", "bmo-p9-1-backend-1"],
    "candidate image validation",
  );
  if (result.stdout.trim() !== config.image) {
    throw new AcceptanceRuntimeError("acceptance image does not match the running candidate image");
  }
}

async function ensureContainerAbsent(docker: AcceptanceDocker, config: AcceptanceConfig): Promise<void> {
  const result = await docker.run(["inspect", config.container]);
  if (result.exitCode === 0) throw new AcceptanceRuntimeError("acceptance runtime container already exists");
}

async function ensureTargetDatabase(docker: AcceptanceDocker, config: AcceptanceConfig): Promise<void> {
  const sql = `SELECT 1 FROM pg_database WHERE datname = '${config.database}'`;
  const result = await requiredDocker(
    docker,
    ["exec", config.postgresContainer, "psql", "-U", config.postgresUser, "-d", "postgres", "-Atqc", sql],
    "restore target database check",
  );
  if (result.stdout.trim() !== "1") throw new AcceptanceRuntimeError("restore target database does not exist");
}

interface AcceptanceRuntimeContainerState {
  status: string;
  exitCode: string;
}

async function inspectRuntimeContainer(
  config: AcceptanceConfig,
  docker: AcceptanceDocker,
): Promise<AcceptanceRuntimeContainerState> {
  const result = await docker.run([
    "inspect",
    "--format",
    "{{.State.Status}}|{{.State.ExitCode}}",
    config.container,
  ]);
  if (result.exitCode !== 0) {
    throw new AcceptanceRuntimeError("acceptance runtime disappeared before readiness");
  }
  const [status, exitCode] = result.stdout.trim().split("|", 2);
  if (!status) throw new AcceptanceRuntimeError("acceptance runtime state is unavailable");
  return { status, exitCode: exitCode ?? "unknown" };
}

function objectBody(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function loopbackUrl(config: AcceptanceConfig, path: string): string {
  return `http://${config.bindHost}:${config.port}${path}`;
}

function createLoopbackHttpClient(config: AcceptanceConfig): AcceptanceRuntimeHttpClient {
  return {
    async request(path, signal) {
      const init: RequestInit = {
        method: "GET",
        headers: { accept: "application/json" },
      };
      if (signal) init.signal = signal;
      const response = await fetch(loopbackUrl(config, path), init);
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        body = undefined;
      }
      return { status: response.status, body };
    },
  };
}

function isReadyResponse(result: AcceptanceRuntimeHttpResult): boolean {
  const body = objectBody(result.body);
  return result.status === 200 && body?.status === "ok" && body.database === "ready";
}

async function readinessFailureDetail(config: AcceptanceConfig, docker: AcceptanceDocker): Promise<string> {
  const state = await docker.run([
    "inspect",
    "--format",
    "{{.State.Status}}|{{.State.ExitCode}}",
    config.container,
  ]);
  const logs = await docker.run(["logs", "--tail", "40", config.container]);
  const detailText = [state.stderr || state.stdout, logs.stderr || logs.stdout]
    .map(sanitizeChildOutput)
    .filter(Boolean)
    .join(" ");
  return detailText || "no diagnostic output";
}

function waitMilliseconds(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function requestWithTimeout(
  http: AcceptanceRuntimeHttpClient,
  path: string,
  timeoutMs: number,
): Promise<AcceptanceRuntimeHttpResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await http.request(path, controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

function validateWaitOptions(timeoutMs: number, pollIntervalMs: number): void {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new AcceptanceRuntimeError("acceptance startup timeout is invalid");
  }
  if (!Number.isFinite(pollIntervalMs) || pollIntervalMs <= 0) {
    throw new AcceptanceRuntimeError("acceptance startup poll interval is invalid");
  }
}

export async function waitForAcceptanceReadiness(
  config: AcceptanceConfig,
  docker: AcceptanceDocker,
  options: AcceptanceRuntimeWaitOptions = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? ACCEPTANCE_STARTUP_TIMEOUT_MS;
  const pollIntervalMs = options.pollIntervalMs ?? ACCEPTANCE_STARTUP_POLL_INTERVAL_MS;
  validateWaitOptions(timeoutMs, pollIntervalMs);
  const now = options.now ?? (() => performance.now());
  const sleep = options.sleep ?? waitMilliseconds;
  const http = options.http ?? createLoopbackHttpClient(config);
  const deadline = now() + timeoutMs;
  let lastReason = "application readiness response was not observed";

  while (now() <= deadline) {
    let state: AcceptanceRuntimeContainerState;
    try {
      state = await inspectRuntimeContainer(config, docker);
    } catch (error) {
      const detailText = await readinessFailureDetail(config, docker).catch(() => "no diagnostic output");
      throw new AcceptanceRuntimeError(`${error instanceof Error ? error.message : "acceptance runtime state check failed"}: ${detailText}`);
    }

    if (state.status === "exited" || state.status === "dead") {
      const detailText = await readinessFailureDetail(config, docker);
      throw new AcceptanceRuntimeError(`acceptance runtime exited before readiness (exit ${state.exitCode}): ${detailText}`);
    }

    if (state.status === "running") {
      try {
        const remaining = Math.max(1, deadline - now());
        const result = await requestWithTimeout(
          http,
          ACCEPTANCE_READINESS_PATH,
          Math.min(ACCEPTANCE_READINESS_PROBE_TIMEOUT_MS, remaining),
        );
        if (isReadyResponse(result)) return;
        lastReason = "application readiness response was not ready";
      } catch {
        lastReason = "application readiness connection was refused or unavailable";
      }
    } else {
      lastReason = `acceptance runtime is ${state.status}`;
    }

    const remaining = deadline - now();
    if (remaining <= 0) break;
    await sleep(Math.min(pollIntervalMs, remaining));
  }

  const detailText = await readinessFailureDetail(config, docker).catch(() => "no diagnostic output");
  throw new AcceptanceRuntimeError(`acceptance runtime readiness timed out: ${lastReason}: ${detailText}`);
}

export async function verifyAcceptanceTargetIdentity(
  config: AcceptanceConfig,
  http = createLoopbackHttpClient(config),
): Promise<void> {
  let result: AcceptanceRuntimeHttpResult;
  try {
    result = await requestWithTimeout(http, ACCEPTANCE_IDENTITY_PATH, ACCEPTANCE_IDENTITY_TIMEOUT_MS);
  } catch {
    throw new AcceptanceRuntimeError("acceptance target identity request failed");
  }
  const body = objectBody(result.body);
  if (result.status !== 200 || body?.database !== config.database) {
    throw new AcceptanceRuntimeError("application database identity does not match restore target");
  }
}

export async function startAcceptanceRuntime(
  config: AcceptanceConfig,
  docker: AcceptanceDocker,
  options: AcceptanceRuntimeWaitOptions = {},
): Promise<{ container: string; database: string }> {
  await ensureCandidateNetwork(docker, config);
  await ensureCandidateImage(docker, config);
  await ensureContainerAbsent(docker, config);
  await ensureTargetDatabase(docker, config);
  try {
    await requiredDocker(docker, buildAcceptanceRuntimeArgs(config), "acceptance runtime start");
    await waitForAcceptanceReadiness(config, docker, options);
  } catch (error) {
    const cleanup = await docker.run(["rm", "--force", config.container]);
    if (cleanup.exitCode !== 0 && !/no such container/i.test(`${cleanup.stderr}\n${cleanup.stdout}`)) {
      throw new AcceptanceRuntimeError("acceptance runtime start cleanup failed");
    }
    throw error;
  }
  return { container: config.container, database: config.database };
}

export async function statusAcceptanceRuntime(
  config: AcceptanceConfig,
  docker: AcceptanceDocker,
): Promise<AcceptanceRuntimeStatus> {
  const inspected = await requiredDocker(
    docker,
    ["inspect", "--format", "{{.State.Status}}|{{.Config.Image}}", config.container],
    "acceptance runtime status",
  );
  const [rawStatus, rawImage] = inspected.stdout.trim().split("|", 2);
  const status = rawStatus ?? "unknown";
  const image = rawImage ?? "";
  if (image !== config.image) throw new AcceptanceRuntimeError("acceptance runtime image identity mismatch");
  const database = (await requiredDocker(
    docker,
    ["exec", config.container, "printenv", "P9_POSTGRES_DB"],
    "acceptance runtime database identity",
  )).stdout.trim();
  if (database !== config.database) throw new AcceptanceRuntimeError("acceptance runtime database identity mismatch");
  const migrationMode = (await requiredDocker(
    docker,
    ["exec", config.container, "printenv", "P9_ACCEPTANCE_MIGRATIONS_DISABLED"],
    "acceptance runtime migration mode",
  )).stdout.trim();
  if (migrationMode !== "true") throw new AcceptanceRuntimeError("acceptance runtime migration mode is unsafe");
  return { container: config.container, database, image, status, migrationsDisabled: true };
}

export async function stopAcceptanceRuntime(config: AcceptanceConfig, docker: AcceptanceDocker): Promise<void> {
  const result = await docker.run(["rm", "--force", config.container]);
  if (result.exitCode !== 0 && !/no such container/i.test(`${result.stderr}\n${result.stdout}`)) {
    throw new AcceptanceRuntimeError(`acceptance runtime stop failed: ${detail(result)}`);
  }
}

export function createDockerExecutor(): AcceptanceDocker {
  return {
    run: (args) => new Promise((resolve, reject) => {
      const child = spawn("docker", args, { stdio: ["ignore", "pipe", "pipe"] });
      const stdout: string[] = [];
      const stderr: string[] = [];
      child.stdout?.setEncoding("utf8");
      child.stderr?.setEncoding("utf8");
      child.stdout?.on("data", (chunk: string) => stdout.push(chunk));
      child.stderr?.on("data", (chunk: string) => stderr.push(chunk));
      child.once("error", reject);
      child.once("close", (exitCode) => resolve({ exitCode: exitCode ?? 1, stdout: stdout.join(""), stderr: stderr.join("") }));
    }),
  };
}
