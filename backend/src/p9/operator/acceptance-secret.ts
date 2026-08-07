import {
  closeSync,
  accessSync,
  fchmodSync,
  fchownSync,
  lstatSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeSync,
  constants as fsConstants,
} from "node:fs";

import { validateProtectedFile, type ProtectedFileFs } from "./protected-file.js";

export const ACCEPTANCE_RUNTIME_UID = 1000 as const;
export const ACCEPTANCE_RUNTIME_GID = 1000 as const;
export const ACCEPTANCE_RUNTIME_PASSWORD_SOURCE_FILE = "/run/secrets/acceptance_password_source" as const;
export const ACCEPTANCE_RUNTIME_PASSWORD_TMPFS = "/run/bmo-p9.1" as const;
export const ACCEPTANCE_RUNTIME_PASSWORD_FILE = `${ACCEPTANCE_RUNTIME_PASSWORD_TMPFS}/acceptance-password` as const;
export const ACCEPTANCE_RUNTIME_PASSWORD_TMPFS_SPEC = `${ACCEPTANCE_RUNTIME_PASSWORD_TMPFS}:rw,noexec,nosuid,nodev,mode=0755` as const;

export interface RuntimeAcceptancePasswordFs {
  readFileSync(path: string, encoding: "utf8"): string;
  openSync(path: string, flags: number, mode: number): number;
  writeSync(fd: number, value: string): number;
  fchmodSync(fd: number, mode: number): void;
  fchownSync(fd: number, uid: number, gid: number): void;
  closeSync(fd: number): void;
  unlinkSync(path: string): void;
}

const runtimeFs: RuntimeAcceptancePasswordFs & ProtectedFileFs = {
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

export function validateRuntimeAcceptancePasswordFile(
  path: string,
  fs?: ProtectedFileFs,
): string {
  if (path !== ACCEPTANCE_RUNTIME_PASSWORD_FILE) throw new Error("runtime acceptance password path is unsafe");
  const options = {
    expectedUid: ACCEPTANCE_RUNTIME_UID,
    expectedGid: ACCEPTANCE_RUNTIME_GID,
    mode: 0o600,
    label: "runtime acceptance password file",
  } as const;
  return fs === undefined
    ? validateProtectedFile(path, options)
    : validateProtectedFile(path, { ...options, fs });
}

export interface MaterializeRuntimeAcceptancePasswordOptions {
  sourcePath?: string;
  runtimePath?: string;
  fs?: RuntimeAcceptancePasswordFs;
}

export function materializeRuntimeAcceptancePassword(
  options: MaterializeRuntimeAcceptancePasswordOptions = {},
): void {
  const sourcePath = options.sourcePath ?? ACCEPTANCE_RUNTIME_PASSWORD_SOURCE_FILE;
  const runtimePath = options.runtimePath ?? ACCEPTANCE_RUNTIME_PASSWORD_FILE;
  const fs = options.fs ?? runtimeFs;
  if (sourcePath !== ACCEPTANCE_RUNTIME_PASSWORD_SOURCE_FILE || runtimePath !== ACCEPTANCE_RUNTIME_PASSWORD_FILE) {
    throw new Error("acceptance password handoff path is unsafe");
  }

  let descriptor: number | undefined;
  let runtimeFileCreated = false;
  try {
    const password = fs.readFileSync(sourcePath, "utf8");
    descriptor = fs.openSync(runtimePath, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW, 0o600);
    runtimeFileCreated = true;
    fs.writeSync(descriptor, password);
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
    throw new Error("acceptance password materialization failed");
  }
}

export interface CleanupRuntimeAcceptancePasswordOptions {
  runtimePath?: string;
  fs?: Pick<RuntimeAcceptancePasswordFs, "unlinkSync">;
}

export function cleanupRuntimeAcceptancePassword(
  options: CleanupRuntimeAcceptancePasswordOptions = {},
): void {
  const runtimePath = options.runtimePath ?? ACCEPTANCE_RUNTIME_PASSWORD_FILE;
  const fs = options.fs ?? runtimeFs;
  if (runtimePath !== ACCEPTANCE_RUNTIME_PASSWORD_FILE) throw new Error("runtime acceptance password path is unsafe");
  try {
    fs.unlinkSync(runtimePath);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
      throw new Error("runtime acceptance password cleanup failed");
    }
  }
}
