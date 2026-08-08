import {
  accessSync,
  closeSync,
  constants as fsConstants,
  fchmodSync,
  fchownSync,
  lstatSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeSync,
} from "node:fs";

import { ACCEPTANCE_RUNTIME_GID, ACCEPTANCE_RUNTIME_UID } from "./acceptance-secret.js";
import { ACCEPTANCE_HOST_GID, ACCEPTANCE_HOST_UID } from "./acceptance-workspace.js";
import { validateProtectedFile, type ProtectedFileFs } from "./protected-file.js";

export const ACCEPTANCE_RUNTIME_STATE_SOURCE_FILE = "/run/secrets/acceptance_state_source" as const;
export const ACCEPTANCE_RUNTIME_STATE_DIRECTORY = "/run/p9-acceptance" as const;
export const ACCEPTANCE_RUNTIME_STATE_FILE = `${ACCEPTANCE_RUNTIME_STATE_DIRECTORY}/fixture-state.json` as const;
export const ACCEPTANCE_RUNTIME_STATE_TMPFS_SPEC = `${ACCEPTANCE_RUNTIME_STATE_DIRECTORY}:rw,noexec,nosuid,nodev,uid=${ACCEPTANCE_RUNTIME_UID},gid=${ACCEPTANCE_RUNTIME_GID},mode=0700` as const;

export interface RuntimeAcceptanceStateFs {
  readFileSync(path: string, encoding: "utf8"): string;
  openSync(path: string, flags: number, mode: number): number;
  writeSync(fd: number, value: string): number;
  fchmodSync(fd: number, mode: number): void;
  fchownSync(fd: number, uid: number, gid: number): void;
  closeSync(fd: number): void;
  unlinkSync(path: string): void;
}

const runtimeFs: RuntimeAcceptanceStateFs & ProtectedFileFs = {
  lstatSync,
  accessSync,
  readFileSync,
  openSync,
  writeSync,
  fchmodSync,
  fchownSync,
  closeSync,
  unlinkSync,
};

export function validateHostAcceptanceStateFile(
  path: string,
  fs: ProtectedFileFs = runtimeFs,
  expectedUid = ACCEPTANCE_HOST_UID,
  expectedGid = ACCEPTANCE_HOST_GID,
): string {
  return validateProtectedFile(path, { fs, expectedUid, expectedGid, mode: 0o600, label: "acceptance host state manifest" });
}

export function validateRuntimeAcceptanceStateFile(
  path: string,
  fs: ProtectedFileFs = runtimeFs,
): string {
  if (path !== ACCEPTANCE_RUNTIME_STATE_FILE) throw new Error("runtime acceptance state path is unsafe");
  return validateProtectedFile(path, {
    fs,
    expectedUid: ACCEPTANCE_RUNTIME_UID,
    expectedGid: ACCEPTANCE_RUNTIME_GID,
    mode: 0o600,
    label: "runtime acceptance state file",
  });
}

export interface MaterializeRuntimeAcceptanceStateOptions {
  sourcePath?: string;
  runtimePath?: string;
  fs?: RuntimeAcceptanceStateFs;
}

export function materializeRuntimeAcceptanceState(
  options: MaterializeRuntimeAcceptanceStateOptions = {},
): void {
  const sourcePath = options.sourcePath ?? ACCEPTANCE_RUNTIME_STATE_SOURCE_FILE;
  const runtimePath = options.runtimePath ?? ACCEPTANCE_RUNTIME_STATE_FILE;
  const fs = options.fs ?? runtimeFs;
  if (sourcePath !== ACCEPTANCE_RUNTIME_STATE_SOURCE_FILE || runtimePath !== ACCEPTANCE_RUNTIME_STATE_FILE) {
    throw new Error("acceptance state handoff path is unsafe");
  }

  let descriptor: number | undefined;
  let runtimeFileCreated = false;
  try {
    const state = fs.readFileSync(sourcePath, "utf8");
    descriptor = fs.openSync(runtimePath, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW, 0o600);
    runtimeFileCreated = true;
    fs.writeSync(descriptor, state);
    fs.fchmodSync(descriptor, 0o600);
    fs.fchownSync(descriptor, ACCEPTANCE_RUNTIME_UID, ACCEPTANCE_RUNTIME_GID);
    fs.closeSync(descriptor);
    descriptor = undefined;
  } catch {
    if (descriptor !== undefined) {
      try { fs.closeSync(descriptor); } catch { /* best-effort descriptor cleanup */ }
    }
    if (runtimeFileCreated) {
      try { fs.unlinkSync(runtimePath); } catch { /* best-effort partial-file cleanup */ }
    }
    throw new Error("acceptance state materialization failed");
  }
}

export interface CleanupRuntimeAcceptanceStateOptions {
  runtimePath?: string;
  fs?: Pick<RuntimeAcceptanceStateFs, "unlinkSync">;
}

export function cleanupRuntimeAcceptanceState(
  options: CleanupRuntimeAcceptanceStateOptions = {},
): void {
  const runtimePath = options.runtimePath ?? ACCEPTANCE_RUNTIME_STATE_FILE;
  const fs = options.fs ?? runtimeFs;
  if (runtimePath !== ACCEPTANCE_RUNTIME_STATE_FILE) throw new Error("runtime acceptance state path is unsafe");
  try {
    fs.unlinkSync(runtimePath);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
      throw new Error("acceptance state cleanup failed");
    }
  }
}
