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

export type DockerResourceKind = "container" | "network";
export type DockerResourceState = "ABSENT" | "PRESENT" | "INSPECTION_ERROR";

export interface DockerResourceInspection {
  kind: DockerResourceKind;
  name: string;
  state: DockerResourceState;
  diagnostic: string;
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
    "--env-file", config.runtimeEnvFile,
    "--env", "P9_ENABLED=true",
    // Host publication belongs to the disposable proxy; this backend remains private-network-only.
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

const ACCEPTANCE_PROXY_SCRIPT = [
  'const http = require("node:http");',
  'const target = process.env.BMO_ACCEPTANCE_PROXY_TARGET;',
  'const [hostname, rawPort] = String(target || "").split(":");',
  'const port = Number(rawPort);',
  'if (!hostname || !Number.isInteger(port) || port !== 3010) process.exit(64);',
  'const server = http.createServer((request, response) => {',
  '  if (!request.url || request.url.startsWith("http://") || request.url.startsWith("https://")) { response.statusCode = 400; response.end("invalid proxy path"); return; }',
  '  const upstream = http.request({ hostname, port, path: request.url, method: request.method, headers: { ...request.headers, host: `${hostname}:${port}`, connection: "close" } }, (upstreamResponse) => {',
  '    response.writeHead(upstreamResponse.statusCode || 502, upstreamResponse.headers);',
  '    upstreamResponse.pipe(response);',
  '  });',
  '  upstream.on("error", () => { if (!response.headersSent) { response.statusCode = 502; response.end("acceptance transport unavailable"); } else response.destroy(); });',
  '  request.on("aborted", () => upstream.destroy());',
  '  request.pipe(upstream);',
  '});',
  'server.listen(Number(process.env.BMO_ACCEPTANCE_PROXY_PORT || "3010"), process.env.BMO_ACCEPTANCE_PROXY_BIND || "0.0.0.0");',
].join(" ");

export function buildAcceptanceTransportNetworkArgs(config: AcceptanceConfig): string[] {
  return [
    "network",
    "create",
    "--driver", "bridge",
    "--label", `com.bmo.p9.acceptance.project=${config.project}`,
    "--label", "com.bmo.p9.acceptance.transport=true",
    "--opt", "com.docker.network.bridge.enable_ip_masquerade=false",
    "--opt", "com.docker.network.bridge.host_binding_ipv4=127.0.0.1",
    config.transportNetwork,
  ];
}

export function buildAcceptanceTransportProxyArgs(config: AcceptanceConfig): string[] {
  return [
    "run",
    "--detach",
    "--name", config.transportContainer,
    "--network", config.transportNetwork,
    "--publish", `${config.bindHost}:${config.port}:${config.internalPort}`,
    "--user", "1000:1000",
    "--read-only",
    "--tmpfs", "/tmp:rw,noexec,nosuid,nodev,size=16m",
    "--cap-drop", "ALL",
    "--security-opt", "no-new-privileges:true",
    "--pids-limit", "64",
    "--memory", "64m",
    "--cpus", "0.25",
    "--restart", "no",
    "--env", `BMO_ACCEPTANCE_PROXY_TARGET=${config.container}:${config.internalPort}`,
    "--env", `BMO_ACCEPTANCE_PROXY_PORT=${config.internalPort}`,
    "--env", "BMO_ACCEPTANCE_PROXY_BIND=0.0.0.0",
    "--label", `com.bmo.p9.acceptance.project=${config.project}`,
    "--label", "com.bmo.p9.acceptance.transport=true",
    config.image,
    "node",
    "-e",
    ACCEPTANCE_PROXY_SCRIPT,
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

interface DockerPortBinding {
  HostIp?: unknown;
  HostPort?: unknown;
}

export async function verifyAcceptanceTransport(
  config: AcceptanceConfig,
  docker: AcceptanceDocker,
): Promise<void> {
  const inspected = await requiredDocker(
    docker,
    ["inspect", "--format", "{{.State.Status}}|{{json .NetworkSettings.Ports}}", config.transportContainer],
    "acceptance transport inspection",
  );
  const separator = inspected.stdout.indexOf("|");
  if (separator < 0) throw new AcceptanceRuntimeError("acceptance transport inspection is malformed");
  const status = inspected.stdout.slice(0, separator).trim();
  if (status !== "running") throw new AcceptanceRuntimeError("acceptance transport is not running");

  let ports: unknown;
  try {
    ports = JSON.parse(inspected.stdout.slice(separator + 1).trim());
  } catch {
    throw new AcceptanceRuntimeError("effective acceptance transport publication is unavailable");
  }

  if (!ports || typeof ports !== "object" || Array.isArray(ports)) {
    throw new AcceptanceRuntimeError("effective acceptance transport publication is unavailable");
  }
  const portMap = ports as Record<string, DockerPortBinding[] | null>;
  const expectedContainerPort = `${config.internalPort}/tcp`;
  const keys = Object.keys(portMap);
  const binding = portMap[expectedContainerPort];
  if (keys.length !== 1 || !Array.isArray(binding) || binding.length !== 1) {
    throw new AcceptanceRuntimeError("effective acceptance transport publication is unavailable");
  }
  const [published] = binding;
  if (
    published?.HostIp !== config.bindHost ||
    published.HostPort !== String(config.port)
  ) {
    throw new AcceptanceRuntimeError("effective acceptance transport is not loopback-only on the required port");
  }
}

async function ensureCandidateNetwork(docker: AcceptanceDocker, config: AcceptanceConfig): Promise<void> {
  await requiredDocker(docker, ["network", "inspect", config.network], "candidate network validation");
}

async function verifyCandidateNetworkPrivacy(docker: AcceptanceDocker, config: AcceptanceConfig): Promise<void> {
  const result = await requiredDocker(
    docker,
    ["network", "inspect", "--format", "{{json .}}", config.network],
    "candidate network privacy inspection",
  );
  const network = parseJsonOutput<DockerNetworkInspection>(result, "candidate network privacy inspection");
  if (network.Name !== config.network || network.Driver !== "bridge" || network.Internal !== true) {
    throw new AcceptanceRuntimeError("candidate network must remain an internal bridge");
  }
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

function dockerResourceInspectArgs(kind: DockerResourceKind, name: string): string[] {
  return kind === "container"
    ? ["inspect", "--format", "{{json .Name}}", name]
    : ["network", "inspect", "--format", "{{json .Name}}", name];
}

function normalizedDockerLine(value: string): string {
  return value.replace(/\r\n/g, "\n").trim();
}

function isCanonicalDockerAbsence(
  kind: DockerResourceKind,
  name: string,
  result: DockerResult,
): boolean {
  const stdout = normalizedDockerLine(result.stdout);
  if (result.exitCode !== 1 || (stdout !== "" && stdout !== "[]")) return false;
  const stderr = normalizedDockerLine(result.stderr);
  const candidates = [
    `error: no such object: ${name}`,
    kind === "container" ? `Error: No such container: ${name}` : `Error response from daemon: network ${name} not found`,
    kind === "container" ? `Error response from daemon: No such container: ${name}` : `Error: No such network: ${name}`,
  ];
  return candidates.includes(stderr);
}

function resourceInspectionError(
  kind: DockerResourceKind,
  name: string,
  result: DockerResult,
  fallback: string,
): DockerResourceInspection {
  const diagnostic = detail(result);
  return {
    kind,
    name,
    state: "INSPECTION_ERROR",
    diagnostic: diagnostic === "no diagnostic output" ? fallback : diagnostic,
  };
}

export async function inspectDockerResource(
  docker: AcceptanceDocker,
  resource: { kind: DockerResourceKind; name: string },
): Promise<DockerResourceInspection> {
  const { kind, name } = resource;
  const result = await docker.run(dockerResourceInspectArgs(kind, name));
  if (isCanonicalDockerAbsence(kind, name, result)) {
    return { kind, name, state: "ABSENT", diagnostic: "confirmed absent" };
  }
  if (result.exitCode !== 0) {
    return resourceInspectionError(kind, name, result, `Docker ${kind} inspection failed`);
  }

  let inspectedName: unknown;
  try {
    inspectedName = JSON.parse(normalizedDockerLine(result.stdout));
  } catch {
    return resourceInspectionError(kind, name, result, `Docker ${kind} inspection output is malformed`);
  }
  const normalizedInspectedName = typeof inspectedName === "string" && kind === "container" && inspectedName.startsWith("/")
    ? inspectedName.slice(1)
    : inspectedName;
  if (normalizedInspectedName !== name) {
    return resourceInspectionError(kind, name, result, `Docker ${kind} inspection identity is unexpected`);
  }
  return { kind, name, state: "PRESENT", diagnostic: "confirmed present" };
}

async function ensureDockerResourceAbsent(
  docker: AcceptanceDocker,
  resource: { kind: DockerResourceKind; name: string },
  label: string,
): Promise<void> {
  const inspection = await inspectDockerResource(docker, resource);
  if (inspection.state === "PRESENT") throw new AcceptanceRuntimeError(`${label} already exists`);
  if (inspection.state === "INSPECTION_ERROR") {
    throw new AcceptanceRuntimeError(`${label} validation failed: ${inspection.diagnostic}`);
  }
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

function parseJsonOutput<T>(result: DockerResult, label: string): T {
  try {
    return JSON.parse(result.stdout.trim()) as T;
  } catch {
    throw new AcceptanceRuntimeError(`${label} is malformed`);
  }
}

interface DockerNetworkInspection {
  Name?: unknown;
  Driver?: unknown;
  Internal?: unknown;
  Containers?: Record<string, { Name?: unknown }>;
}

export async function verifyAcceptanceTransportNetwork(docker: AcceptanceDocker, config: AcceptanceConfig): Promise<void> {
  const result = await requiredDocker(
    docker,
    ["network", "inspect", "--format", "{{json .}}", config.transportNetwork],
    "acceptance transport network inspection",
  );
  const network = parseJsonOutput<DockerNetworkInspection>(result, "acceptance transport network inspection");
  const members = Object.values(network.Containers ?? {}).map((container) => container.Name);
  if (
    network.Name !== config.transportNetwork ||
    network.Driver !== "bridge" ||
    network.Internal !== false ||
    members.length !== 1 ||
    members[0] !== config.transportContainer
  ) {
    throw new AcceptanceRuntimeError("acceptance transport network is not dedicated and publish-capable");
  }
}

export async function verifyAcceptanceRuntimePrivateNetwork(docker: AcceptanceDocker, config: AcceptanceConfig): Promise<void> {
  const result = await requiredDocker(
    docker,
    ["inspect", "--format", "{{json .NetworkSettings.Networks}}", config.container],
    "acceptance runtime network inspection",
  );
  const networks = parseJsonOutput<Record<string, unknown>>(result, "acceptance runtime network inspection");
  const names = Object.keys(networks);
  if (names.length !== 1 || names[0] !== config.network) {
    throw new AcceptanceRuntimeError("acceptance backend must remain attached only to the private candidate network");
  }
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

function isCanonicalDockerRemovalAbsence(
  kind: DockerResourceKind,
  name: string,
  result: DockerResult,
): boolean {
  if (result.exitCode === 0 || normalizedDockerLine(result.stdout) !== "") return false;
  const stderr = normalizedDockerLine(result.stderr);
  const candidates = [
    `error: no such object: ${name}`,
    kind === "container" ? `Error: No such container: ${name}` : `Error response from daemon: network ${name} not found`,
    kind === "container" ? `Error response from daemon: No such container: ${name}` : `Error: No such network: ${name}`,
  ];
  return candidates.includes(stderr);
}

async function removeDockerResource(
  docker: AcceptanceDocker,
  args: string[],
  label: string,
  resource: { kind: DockerResourceKind; name: string },
): Promise<void> {
  const result = await docker.run(args);
  if (result.exitCode !== 0 && !isCanonicalDockerRemovalAbsence(resource.kind, resource.name, result)) {
    throw new AcceptanceRuntimeError(`${label} cleanup failed: ${detail(result)}`);
  }
}

async function cleanupAcceptanceResources(
  config: AcceptanceConfig,
  docker: AcceptanceDocker,
  options: { runtime: boolean; transport: boolean; network: boolean },
): Promise<void> {
  let firstError: unknown;
  const cleanup = async (
    args: string[],
    label: string,
    resource: { kind: DockerResourceKind; name: string },
  ): Promise<void> => {
    try {
      await removeDockerResource(docker, args, label, resource);
    } catch (error) {
      firstError ??= error;
    }
  };

  if (options.transport) {
    await cleanup(
      ["rm", "--force", config.transportContainer],
      "acceptance transport",
      { kind: "container", name: config.transportContainer },
    );
  }
  if (options.runtime) {
    await cleanup(
      ["rm", "--force", config.container],
      "acceptance runtime",
      { kind: "container", name: config.container },
    );
  }
  if (options.network) {
    await cleanup(
      ["network", "rm", config.transportNetwork],
      "acceptance transport network",
      { kind: "network", name: config.transportNetwork },
    );
  }
  if (firstError) throw firstError;
}

export async function startAcceptanceRuntime(
  config: AcceptanceConfig,
  docker: AcceptanceDocker,
  options: AcceptanceRuntimeWaitOptions = {},
): Promise<{ container: string; database: string }> {
  await ensureCandidateNetwork(docker, config);
  await verifyCandidateNetworkPrivacy(docker, config);
  await ensureCandidateImage(docker, config);
  await ensureDockerResourceAbsent(
    docker,
    { kind: "container", name: config.container },
    "acceptance runtime container",
  );
  await ensureDockerResourceAbsent(
    docker,
    { kind: "container", name: config.transportContainer },
    "acceptance transport container",
  );
  await ensureDockerResourceAbsent(
    docker,
    { kind: "network", name: config.transportNetwork },
    "acceptance transport network",
  );
  await ensureTargetDatabase(docker, config);
  let runtimeCreated = false;
  let transportCreated = false;
  let transportNetworkCreated = false;
  try {
    await requiredDocker(docker, buildAcceptanceRuntimeArgs(config), "acceptance runtime start");
    runtimeCreated = true;
    await requiredDocker(docker, buildAcceptanceTransportNetworkArgs(config), "acceptance transport network creation");
    transportNetworkCreated = true;
    await requiredDocker(docker, buildAcceptanceTransportProxyArgs(config), "acceptance transport start");
    transportCreated = true;
    await requiredDocker(
      docker,
      ["network", "connect", config.network, config.transportContainer],
      "acceptance transport private-network attachment",
    );
    await verifyAcceptanceTransport(config, docker);
    await verifyAcceptanceTransportNetwork(docker, config);
    await verifyAcceptanceRuntimePrivateNetwork(docker, config);
    await waitForAcceptanceReadiness(config, docker, options);
  } catch (error) {
    await cleanupAcceptanceResources(config, docker, {
      runtime: runtimeCreated,
      transport: transportCreated,
      network: transportNetworkCreated,
    });
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
  await verifyAcceptanceTransport(config, docker);
  await verifyAcceptanceTransportNetwork(docker, config);
  await verifyAcceptanceRuntimePrivateNetwork(docker, config);
  return { container: config.container, database, image, status, migrationsDisabled: true };
}

export async function stopAcceptanceRuntime(config: AcceptanceConfig, docker: AcceptanceDocker): Promise<void> {
  await cleanupAcceptanceResources(config, docker, { runtime: true, transport: true, network: true });
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
