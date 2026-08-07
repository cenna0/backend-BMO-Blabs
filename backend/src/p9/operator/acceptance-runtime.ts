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

export async function startAcceptanceRuntime(
  config: AcceptanceConfig,
  docker: AcceptanceDocker,
): Promise<{ container: string; database: string }> {
  await ensureCandidateNetwork(docker, config);
  await ensureCandidateImage(docker, config);
  await ensureContainerAbsent(docker, config);
  await ensureTargetDatabase(docker, config);
  try {
    await requiredDocker(docker, buildAcceptanceRuntimeArgs(config), "acceptance runtime start");
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
