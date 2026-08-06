import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import type { Readable } from "node:stream";
import { resolve } from "node:path";

export type ProcessFailureKind =
  | "compose-configuration"
  | "compose-execution"
  | "pg_dump"
  | "generic";

export interface WaitForProcessOptions {
  failureKind?: ProcessFailureKind;
  captureStdout?: boolean;
}

export interface ComposeEnvironmentOptions {
  baseEnv?: NodeJS.ProcessEnv;
}

export interface ComposeConfigurationDependencies extends ComposeEnvironmentOptions {
  spawn?: ComposeSpawn;
  composeFile?: string;
}

export type ComposeSpawn = (command: string, args: string[], options: SpawnOptions) => ChildProcess;

export class BackupProcessError extends Error {
  constructor(
    message: string,
    public readonly failureKind: ProcessFailureKind,
  ) {
    super(message);
    this.name = "BackupProcessError";
  }
}

export function composeArgs(command: string[], composeFile = process.env.P9_COMPOSE_FILE ?? "../p9.1-compose.yml"): string[] {
  const args = ["compose", "-f", resolve(composeFile)];
  if (process.env.P9_COMPOSE_PROJECT) args.push("--project-name", process.env.P9_COMPOSE_PROJECT);
  if (process.env.P9_COMPOSE_ENV_FILE) args.push("--env-file", resolve(process.env.P9_COMPOSE_ENV_FILE));
  args.push(...command);
  return args;
}

export function composeEnvironment(
  postgresPasswordFile: string,
  options: ComposeEnvironmentOptions = {},
): NodeJS.ProcessEnv {
  return {
    ...(options.baseEnv ?? process.env),
    P9_POSTGRES_PASSWORD_FILE: postgresPasswordFile,
  };
}

function captureStream(stream: Readable | null, chunks: string[]): void {
  if (!stream) return;
  stream.setEncoding("utf8");
  stream.on("data", (chunk: string | Buffer) => chunks.push(String(chunk)));
}

function sanitizeSensitiveValues(value: string): string {
  return value
    .replace(/postgres(?:ql)?:\/\/[^\s"'`]+/gi, "[REDACTED_CONNECTION_URL]")
    .replace(/(password|passphrase|secret|token|api[_-]?key|private[_-]?key|authorization|credential)\s*[:=]\s*("[^"]*"|'[^']*'|[^\s,;]+)/gi, "$1=[REDACTED]")
    .replace(/PGPASSWORD\s*=\s*[^\s,;]+/gi, "PGPASSWORD=[REDACTED]")
    .replace(/(P9_[A-Z0-9_]+)=("[^"]*"|'[^']*'|[^\s,;]+)/g, "$1=[REDACTED]");
}

export function sanitizeChildOutput(output: string): string {
  const sanitized = sanitizeSensitiveValues(output)
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, 8)
    .join(" ");
  return sanitized.slice(0, 1200);
}

function summarizeFailure(output: string): string {
  const missingVariable = /required variable\s+([A-Z][A-Z0-9_]*)\s+is missing(?: a value)?/i.exec(output);
  if (missingVariable?.[1]) return `required ${missingVariable[1]} is missing`;
  return sanitizeChildOutput(output) || "no diagnostic output";
}

function failureMessage(label: string, output: string, kind: ProcessFailureKind): string {
  const detail = summarizeFailure(output);
  if (kind === "compose-configuration") return `Docker Compose configuration failed: ${detail}`;
  if (kind === "compose-execution") return `Docker Compose execution failed: ${detail}`;
  if (kind === "pg_dump") {
    if (/P9_PG_DUMP_EXECUTABLE_MISSING/.test(output)) return "pg_dump executable is missing";
    if (!/P9_PG_DUMP_EXIT=\d+/.test(output)) return `Docker Compose execution failed: ${detail}`;
    const sanitized = sanitizeChildOutput(output.replace(/P9_PG_DUMP_EXIT=\d+/g, ""));
    return `pg_dump failed${sanitized ? `: ${sanitized}` : ""}`;
  }
  return `${label} failed: ${detail}`;
}

function processCompletion(child: ChildProcess): Promise<number | null> {
  return new Promise<number | null>((resolvePromise, reject) => {
    let settled = false;
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
    child.once("close", (code) => {
      if (settled) return;
      settled = true;
      resolvePromise(code);
    });
  });
}

export async function waitForProcess(
  child: ChildProcess,
  label: string,
  options: WaitForProcessOptions = {},
): Promise<void> {
  const stderr: string[] = [];
  const stdout: string[] = [];
  captureStream(child.stderr, stderr);
  if (options.captureStdout) captureStream(child.stdout, stdout);

  let code: number | null;
  try {
    code = await processCompletion(child);
  } catch (error) {
    const detail = error instanceof Error ? sanitizeChildOutput(error.message) : "process launch failed";
    throw new BackupProcessError(`${label} could not start${detail ? `: ${detail}` : ""}`, options.failureKind ?? "generic");
  }

  if (code !== 0) {
    const failureKind = options.failureKind ?? "generic";
    throw new BackupProcessError(
      failureMessage(label, [...stderr, ...stdout].join("\n"), failureKind),
      failureKind,
    );
  }
}

export async function runCompose(
  args: string[],
  options: { env?: NodeJS.ProcessEnv } = {},
): Promise<void> {
  const child = spawn("docker", args, {
    env: options.env ?? process.env,
    stdio: ["ignore", "ignore", "pipe"],
  });
  await waitForProcess(child, "docker compose command", { failureKind: "compose-execution" });
}

export async function validateComposeConfiguration(
  postgresPasswordFile: string,
  options: ComposeConfigurationDependencies = {},
): Promise<void> {
  const spawnProcess = options.spawn ?? spawn;
  const spawnOptions: SpawnOptions = {
    env: composeEnvironment(postgresPasswordFile, options),
    stdio: ["ignore", "pipe", "pipe"],
  };
  const child = spawnProcess(
    "docker",
    composeArgs(["config", "--quiet"], options.composeFile),
    spawnOptions,
  );
  await waitForProcess(child, "Docker Compose configuration", {
    failureKind: "compose-configuration",
    captureStdout: true,
  });
}
