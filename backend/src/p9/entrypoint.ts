import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";

import {
  ACCEPTANCE_RUNTIME_PASSWORD_FILE,
  ACCEPTANCE_RUNTIME_PASSWORD_SOURCE_FILE,
  cleanupRuntimeAcceptancePassword,
  materializeRuntimeAcceptancePassword,
} from "./operator/acceptance-secret.js";
import {
  ACCEPTANCE_RUNTIME_STATE_FILE,
  ACCEPTANCE_RUNTIME_STATE_SOURCE_FILE,
  cleanupRuntimeAcceptanceState,
  materializeRuntimeAcceptanceState,
} from "./operator/acceptance-state.js";

let runtimeAcceptancePasswordMaterialized = false;
let runtimeAcceptancePasswordCleanupFailed = false;
let runtimeAcceptanceStateMaterialized = false;
let runtimeAcceptanceStateCleanupFailed = false;

function cleanupRuntimeAcceptancePasswordIfNeeded(): void {
  if (!runtimeAcceptancePasswordMaterialized) return;
  try {
    cleanupRuntimeAcceptancePassword();
  } catch {
    runtimeAcceptancePasswordCleanupFailed = true;
    process.stderr.write("acceptance password runtime cleanup failed\n");
  } finally {
    runtimeAcceptancePasswordMaterialized = false;
  }
}

function cleanupRuntimeAcceptanceStateIfNeeded(): void {
  if (!runtimeAcceptanceStateMaterialized) return;
  try {
    cleanupRuntimeAcceptanceState({ runtimePath: ACCEPTANCE_RUNTIME_STATE_FILE });
  } catch {
    runtimeAcceptanceStateCleanupFailed = true;
    process.stderr.write("acceptance state runtime cleanup failed\n");
  } finally {
    runtimeAcceptanceStateMaterialized = false;
  }
}

function materializeRuntimeAcceptancePasswordIfConfigured(): void {
  const sourcePath = process.env.P9_ACCEPTANCE_PASSWORD_SOURCE_FILE;
  if (sourcePath === undefined) return;
  if (sourcePath !== ACCEPTANCE_RUNTIME_PASSWORD_SOURCE_FILE || process.env.P9_ACCEPTANCE_PASSWORD_FILE !== ACCEPTANCE_RUNTIME_PASSWORD_FILE) {
    throw new Error("acceptance password runtime handoff configuration is unsafe");
  }
  materializeRuntimeAcceptancePassword({ sourcePath, runtimePath: ACCEPTANCE_RUNTIME_PASSWORD_FILE });
  runtimeAcceptancePasswordMaterialized = true;
}

function materializeRuntimeAcceptanceStateIfConfigured(): void {
  const sourcePath = process.env.P9_ACCEPTANCE_STATE_SOURCE_FILE;
  if (sourcePath === undefined) return;
  if (sourcePath !== ACCEPTANCE_RUNTIME_STATE_SOURCE_FILE || process.env.P9_ACCEPTANCE_STATE_FILE !== ACCEPTANCE_RUNTIME_STATE_FILE) {
    throw new Error("acceptance state runtime handoff configuration is unsafe");
  }
  materializeRuntimeAcceptanceState({ sourcePath, runtimePath: ACCEPTANCE_RUNTIME_STATE_FILE });
  runtimeAcceptanceStateMaterialized = true;
}

process.once("exit", cleanupRuntimeAcceptancePasswordIfNeeded);
process.once("exit", cleanupRuntimeAcceptanceStateIfNeeded);

function loadDatabaseUrlFromSecret(): void {
  if (process.env.DATABASE_URL || !process.env.P9_DATABASE_PASSWORD_FILE) return;
  const password = readFileSync(process.env.P9_DATABASE_PASSWORD_FILE, "utf8").trim();
  if (!password) throw new Error("P9 database password secret is empty");
  const user = process.env.P9_POSTGRES_USER ?? "bmo";
  const database = process.env.P9_POSTGRES_DB ?? "bmo";
  process.env.DATABASE_URL = `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@postgres:5432/${encodeURIComponent(database)}`;
}

loadDatabaseUrlFromSecret();
materializeRuntimeAcceptancePasswordIfConfigured();
materializeRuntimeAcceptanceStateIfConfigured();
const setgid = process.setgid;
const setuid = process.setuid;
if (typeof process.getuid === "function" && process.getuid() === 0 && setgid && setuid) {
  setgid(Number(process.env.P9_RUNTIME_GID ?? "1000"));
  setuid(Number(process.env.P9_RUNTIME_UID ?? "1000"));
}
const [command, ...args] = process.argv.slice(2);
if (!command) throw new Error("P9 candidate entrypoint requires a command");
const child = spawn(command, args, { stdio: "inherit", env: process.env });
child.once("error", (error) => {
  cleanupRuntimeAcceptancePasswordIfNeeded();
  cleanupRuntimeAcceptanceStateIfNeeded();
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
child.once("exit", (code, signal) => {
  cleanupRuntimeAcceptancePasswordIfNeeded();
  cleanupRuntimeAcceptanceStateIfNeeded();
  if (runtimeAcceptancePasswordCleanupFailed || runtimeAcceptanceStateCleanupFailed) {
    process.exitCode = 1;
    return;
  }
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
