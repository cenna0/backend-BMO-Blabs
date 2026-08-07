import { accessSync, constants, lstatSync } from "node:fs";

export interface ProtectedFileStats {
  isFile(): boolean;
  isSymbolicLink(): boolean;
  mode: number;
  uid: number;
  gid: number;
}

export interface ProtectedFileFs {
  lstatSync(path: string): ProtectedFileStats;
  accessSync(path: string, mode?: number): void;
}

export interface ProtectedFileOptions {
  fs?: ProtectedFileFs;
  expectedUid?: number;
  expectedGid?: number;
  mode?: number;
  label: string;
}

const runtimeFs: ProtectedFileFs = { lstatSync, accessSync };

function runtimeUid(): number {
  if (typeof process.getuid !== "function") throw new Error("protected-file runtime user is unavailable");
  return process.getuid();
}

function runtimeGid(): number {
  if (typeof process.getgid !== "function") throw new Error("protected-file runtime group is unavailable");
  return process.getgid();
}

export function validateProtectedFile(path: string, options: ProtectedFileOptions): string {
  const fs = options.fs ?? runtimeFs;
  const expectedUid = options.expectedUid ?? runtimeUid();
  const expectedGid = options.expectedGid ?? runtimeGid();
  const expectedMode = options.mode ?? 0o600;
  let metadata: ProtectedFileStats;
  try {
    metadata = fs.lstatSync(path);
  } catch {
    throw new Error(`${options.label} is unavailable`);
  }
  if (metadata.isSymbolicLink()) throw new Error(`${options.label} must not be a symlink`);
  if (!metadata.isFile()) throw new Error(`${options.label} must be a regular file`);
  if (metadata.uid !== expectedUid || metadata.gid !== expectedGid) {
    throw new Error(`${options.label} ownership is unsafe`);
  }
  if ((metadata.mode & 0o7777) !== expectedMode) {
    throw new Error(`${options.label} permissions are unsafe`);
  }
  try {
    fs.accessSync(path, constants.R_OK);
  } catch {
    throw new Error(`${options.label} is unreadable`);
  }
  return path;
}
