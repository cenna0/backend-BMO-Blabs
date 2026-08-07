import { describe, expect, it } from "vitest";

import {
  ACCEPTANCE_RUNTIME_STATE_FILE,
  ACCEPTANCE_RUNTIME_STATE_SOURCE_FILE,
  ACCEPTANCE_RUNTIME_STATE_TMPFS_SPEC,
  cleanupRuntimeAcceptanceState,
  materializeRuntimeAcceptanceState,
  validateHostAcceptanceStateFile,
  validateRuntimeAcceptanceStateFile,
} from "../../src/p9/operator/acceptance-state.js";

function metadata(overrides: Partial<{ file: boolean; symlink: boolean; mode: number; uid: number; gid: number }> = {}) {
  const value = { file: true, symlink: false, mode: 0o600, uid: 1002, gid: 1002, ...overrides };
  return {
    isFile: () => value.file,
    isSymbolicLink: () => value.symlink,
    mode: value.mode,
    uid: value.uid,
    gid: value.gid,
  };
}

describe("P9 acceptance host/runtime state handoff", () => {
  it("uses distinct fixed source, runtime, and tmpfs paths", () => {
    expect(ACCEPTANCE_RUNTIME_STATE_SOURCE_FILE).toBe("/run/secrets/acceptance_state_source");
    expect(ACCEPTANCE_RUNTIME_STATE_FILE).toBe("/run/p9-acceptance/fixture-state.json");
    expect(ACCEPTANCE_RUNTIME_STATE_TMPFS_SPEC).toContain("uid=1000,gid=1000,mode=0700");
  });

  it("accepts the operator-owned host state but rejects container ownership", () => {
    const fs = { lstatSync: () => metadata(), accessSync: () => undefined };
    expect(validateHostAcceptanceStateFile("/tmp/fixture-state.json", fs, 1002, 1002)).toBe("/tmp/fixture-state.json");
    expect(() => validateHostAcceptanceStateFile("/tmp/fixture-state.json", {
      ...fs,
      lstatSync: () => metadata({ uid: 1000, gid: 1000 }),
    }, 1002, 1002)).toThrow(/ownership/);
    expect(() => validateHostAcceptanceStateFile("/tmp/fixture-state.json", {
      ...fs,
      lstatSync: () => metadata({ symlink: true }),
    }, 1002, 1002)).toThrow(/symlink/);
  });

  it("accepts only the fixed runtime state owned by 1000:1000", () => {
    const fs = { lstatSync: () => metadata({ uid: 1000, gid: 1000 }), accessSync: () => undefined };
    expect(validateRuntimeAcceptanceStateFile(ACCEPTANCE_RUNTIME_STATE_FILE, fs)).toBe(ACCEPTANCE_RUNTIME_STATE_FILE);
    expect(() => validateRuntimeAcceptanceStateFile(ACCEPTANCE_RUNTIME_STATE_FILE, {
      ...fs,
      lstatSync: () => metadata({ uid: 1002, gid: 1002 }),
    })).toThrow(/ownership/);
    expect(() => validateRuntimeAcceptanceStateFile(ACCEPTANCE_RUNTIME_STATE_FILE, {
      ...fs,
      lstatSync: () => metadata({ uid: 1000, gid: 1000, mode: 0o640 }),
    })).toThrow(/permissions/);
  });

  it("materializes and cleans only the fixed runtime state path", () => {
    const calls: string[] = [];
    const fs = {
      readFileSync: (path: string) => { calls.push(`read:${path}`); return "{\"version\":1}"; },
      openSync: (path: string, _flags: number, mode: number) => { calls.push(`open:${path}:${mode.toString(8)}`); return 4; },
      writeSync: (_fd: number, value: string) => { calls.push(`write:${value.length}`); return value.length; },
      fchmodSync: (_fd: number, mode: number) => calls.push(`chmod:${mode.toString(8)}`),
      fchownSync: (_fd: number, uid: number, gid: number) => calls.push(`chown:${uid}:${gid}`),
      closeSync: (_fd: number) => calls.push("close"),
      unlinkSync: (path: string) => calls.push(`unlink:${path}`),
    };

    materializeRuntimeAcceptanceState({ fs });
    cleanupRuntimeAcceptanceState({ fs });

    expect(calls).toEqual([
      `read:${ACCEPTANCE_RUNTIME_STATE_SOURCE_FILE}`,
      `open:${ACCEPTANCE_RUNTIME_STATE_FILE}:600`,
      "write:13",
      "chmod:600",
      "chown:1000:1000",
      "close",
      `unlink:${ACCEPTANCE_RUNTIME_STATE_FILE}`,
    ]);
  });

  it("removes a partial runtime state file when materialization fails after creation", () => {
    const calls: string[] = [];
    const fs = {
      readFileSync: () => "{\"version\":1}",
      openSync: () => 4,
      writeSync: () => { throw new Error("synthetic write failure"); },
      fchmodSync: () => undefined,
      fchownSync: () => undefined,
      closeSync: () => calls.push("close"),
      unlinkSync: (path: string) => calls.push(`unlink:${path}`),
    };

    expect(() => materializeRuntimeAcceptanceState({ fs })).toThrow(/materialization failed/);
    expect(calls).toEqual(["close", `unlink:${ACCEPTANCE_RUNTIME_STATE_FILE}`]);
  });

  it("does not remove a pre-existing runtime state file when exclusive creation fails", () => {
    const calls: string[] = [];
    const fs = {
      readFileSync: () => "{\"version\":1}",
      openSync: () => { throw new Error("already exists"); },
      writeSync: () => 0,
      fchmodSync: () => undefined,
      fchownSync: () => undefined,
      closeSync: () => calls.push("close"),
      unlinkSync: (path: string) => calls.push(`unlink:${path}`),
    };

    expect(() => materializeRuntimeAcceptanceState({ fs })).toThrow(/materialization failed/);
    expect(calls).toEqual([]);
  });
});
