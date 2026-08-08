import {
  lstatSync,
  mkdirSync,
  readdirSync,
} from "node:fs";
import { basename, dirname, isAbsolute } from "node:path";

export const ACCEPTANCE_HOST_WORKSPACE_MODE = 0o700 as const;
export const ACCEPTANCE_HOST_STATE_FILE_NAME = "fixture-state.json" as const;
export const ACCEPTANCE_HOST_STATE_FILE_MODE = 0o600 as const;
export const ACCEPTANCE_HOST_UID = 1002 as const;
export const ACCEPTANCE_HOST_GID = 1002 as const;

export interface AcceptanceWorkspaceStats {
  isDirectory(): boolean;
  isFile(): boolean;
  isSymbolicLink(): boolean;
  mode: number;
  uid: number;
  gid: number;
}

export interface AcceptanceWorkspaceFs {
  lstatSync(path: string): AcceptanceWorkspaceStats;
  mkdirSync(path: string, options: { mode: number }): void;
  readdirSync(path: string): string[];
}

export interface AcceptanceWorkspaceOptions {
  fs?: AcceptanceWorkspaceFs;
  expectedUid?: number;
  expectedGid?: number;
}

export interface AcceptanceWorkspace {
  workspacePath: string;
  statePath: string;
  stateFilePresent: boolean;
}

export class AcceptanceWorkspaceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AcceptanceWorkspaceError";
  }
}

const runtimeFs: AcceptanceWorkspaceFs = { lstatSync, mkdirSync, readdirSync };

function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("code" in error)) return undefined;
  const code = error.code;
  return typeof code === "string" ? code : undefined;
}

function pathsForState(statePath: string): { workspacePath: string; statePath: string } {
  if (!isAbsolute(statePath)) throw new AcceptanceWorkspaceError("acceptance workspace state path must be absolute");
  if (basename(statePath) !== ACCEPTANCE_HOST_STATE_FILE_NAME) {
    throw new AcceptanceWorkspaceError(`acceptance workspace state path must end in ${ACCEPTANCE_HOST_STATE_FILE_NAME}`);
  }
  const workspacePath = dirname(statePath);
  if (workspacePath === "/") throw new AcceptanceWorkspaceError("acceptance workspace path is unsafe");
  return { workspacePath, statePath };
}

function lstatOrUnavailable(fs: AcceptanceWorkspaceFs, path: string, label: string): AcceptanceWorkspaceStats | undefined {
  try {
    return fs.lstatSync(path);
  } catch (error) {
    if (errorCode(error) === "ENOENT") return undefined;
    throw new AcceptanceWorkspaceError(`${label} is unavailable`);
  }
}

function requireDirectory(
  metadata: AcceptanceWorkspaceStats | undefined,
  expectedUid: number,
  expectedGid: number,
): void {
  if (!metadata) throw new AcceptanceWorkspaceError("acceptance workspace is unavailable");
  if (metadata.isSymbolicLink()) throw new AcceptanceWorkspaceError("acceptance workspace must not be a symlink");
  if (!metadata.isDirectory()) throw new AcceptanceWorkspaceError("acceptance workspace must be a directory");
  if (metadata.uid !== expectedUid || metadata.gid !== expectedGid) {
    throw new AcceptanceWorkspaceError("acceptance workspace ownership is unsafe");
  }
  if ((metadata.mode & 0o7777) !== ACCEPTANCE_HOST_WORKSPACE_MODE) {
    throw new AcceptanceWorkspaceError("acceptance workspace permissions are unsafe");
  }
}

function requireStateFile(
  metadata: AcceptanceWorkspaceStats | undefined,
  expectedUid: number,
  expectedGid: number,
): void {
  if (!metadata) throw new AcceptanceWorkspaceError("acceptance workspace state file disappeared");
  if (metadata.isSymbolicLink()) throw new AcceptanceWorkspaceError("acceptance workspace state file must not be a symlink");
  if (!metadata.isFile()) throw new AcceptanceWorkspaceError("acceptance workspace state file must be a regular file");
  if (metadata.uid !== expectedUid || metadata.gid !== expectedGid) {
    throw new AcceptanceWorkspaceError("acceptance workspace state file ownership is unsafe");
  }
  if ((metadata.mode & 0o7777) !== ACCEPTANCE_HOST_STATE_FILE_MODE) {
    throw new AcceptanceWorkspaceError("acceptance workspace state file permissions are unsafe");
  }
}

function validateChildren(
  workspacePath: string,
  statePath: string,
  fs: AcceptanceWorkspaceFs,
  expectedUid: number,
  expectedGid: number,
): boolean {
  let entries: string[];
  try {
    entries = fs.readdirSync(workspacePath);
  } catch {
    throw new AcceptanceWorkspaceError("acceptance workspace contents are unavailable");
  }
  for (const entry of entries) {
    if (entry !== ACCEPTANCE_HOST_STATE_FILE_NAME) {
      throw new AcceptanceWorkspaceError(`acceptance workspace contains unexpected entry: ${entry}`);
    }
  }
  if (!entries.includes(ACCEPTANCE_HOST_STATE_FILE_NAME)) return false;
  requireStateFile(lstatOrUnavailable(fs, statePath, "acceptance workspace state file"), expectedUid, expectedGid);
  return true;
}

export function validateAcceptanceWorkspace(
  statePath: string,
  options: AcceptanceWorkspaceOptions = {},
): AcceptanceWorkspace {
  const paths = pathsForState(statePath);
  const fs = options.fs ?? runtimeFs;
  const expectedUid = options.expectedUid ?? ACCEPTANCE_HOST_UID;
  const expectedGid = options.expectedGid ?? ACCEPTANCE_HOST_GID;
  requireDirectory(lstatOrUnavailable(fs, paths.workspacePath, "acceptance workspace"), expectedUid, expectedGid);
  return {
    ...paths,
    stateFilePresent: validateChildren(paths.workspacePath, paths.statePath, fs, expectedUid, expectedGid),
  };
}

export function ensureAcceptanceWorkspace(
  statePath: string,
  options: AcceptanceWorkspaceOptions = {},
): AcceptanceWorkspace {
  const paths = pathsForState(statePath);
  const fs = options.fs ?? runtimeFs;
  const expectedUid = options.expectedUid ?? ACCEPTANCE_HOST_UID;
  const expectedGid = options.expectedGid ?? ACCEPTANCE_HOST_GID;
  const before = lstatOrUnavailable(fs, paths.workspacePath, "acceptance workspace");
  if (!before) {
    try {
      fs.mkdirSync(paths.workspacePath, { mode: ACCEPTANCE_HOST_WORKSPACE_MODE });
    } catch (error) {
      if (errorCode(error) !== "EEXIST") throw new AcceptanceWorkspaceError("acceptance workspace creation failed");
    }
  }
  requireDirectory(lstatOrUnavailable(fs, paths.workspacePath, "acceptance workspace"), expectedUid, expectedGid);
  return {
    ...paths,
    stateFilePresent: validateChildren(paths.workspacePath, paths.statePath, fs, expectedUid, expectedGid),
  };
}
