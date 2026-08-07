import { describe, expect, it } from "vitest";

import {
  ACCEPTANCE_RUNTIME_PASSWORD_FILE,
  ACCEPTANCE_RUNTIME_PASSWORD_SOURCE_FILE,
  ACCEPTANCE_RUNTIME_PASSWORD_TMPFS,
  ACCEPTANCE_RUNTIME_GID,
  ACCEPTANCE_RUNTIME_UID,
  cleanupRuntimeAcceptancePassword,
  materializeRuntimeAcceptancePassword,
  validateRuntimeAcceptancePasswordFile,
} from "../../src/p9/operator/acceptance-secret.js";

function metadata(overrides: Partial<{ file: boolean; symlink: boolean; mode: number; uid: number; gid: number }> = {}) {
  const value = { file: true, symlink: false, mode: 0o600, uid: 1000, gid: 1000, ...overrides };
  return {
    isFile: () => value.file,
    isSymbolicLink: () => value.symlink,
    mode: value.mode,
    uid: value.uid,
    gid: value.gid,
  };
}

describe("P9 acceptance runtime secret handoff", () => {
  it("uses fixed internal source, tmpfs, and runtime paths", () => {
    expect(ACCEPTANCE_RUNTIME_PASSWORD_SOURCE_FILE).toBe("/run/secrets/acceptance_password_source");
    expect(ACCEPTANCE_RUNTIME_PASSWORD_TMPFS).toBe("/run/bmo-p9.1");
    expect(ACCEPTANCE_RUNTIME_PASSWORD_FILE).toBe("/run/bmo-p9.1/acceptance-password");
    expect(ACCEPTANCE_RUNTIME_UID).toBe(1000);
    expect(ACCEPTANCE_RUNTIME_GID).toBe(1000);
  });

  it("accepts only the ephemeral runtime file owned by 1000:1000 with mode 0600", () => {
    const fs = {
      lstatSync: () => metadata(),
      accessSync: () => undefined,
    };

    expect(validateRuntimeAcceptancePasswordFile(ACCEPTANCE_RUNTIME_PASSWORD_FILE, fs)).toBe(ACCEPTANCE_RUNTIME_PASSWORD_FILE);
    expect(() => validateRuntimeAcceptancePasswordFile("/run/bmo-p9.1/wrong", fs)).toThrow();
    expect(() => validateRuntimeAcceptancePasswordFile(ACCEPTANCE_RUNTIME_PASSWORD_FILE, {
      ...fs,
      lstatSync: () => metadata({ uid: 1002 }),
    })).toThrow();
    expect(() => validateRuntimeAcceptancePasswordFile(ACCEPTANCE_RUNTIME_PASSWORD_FILE, {
      ...fs,
      lstatSync: () => metadata({ mode: 0o640 }),
    })).toThrow();
  });

  it("materializes synthetic content into a 1000:1000 mode-0600 file without logging it", () => {
    const calls: string[] = [];
    let written = "";
    const fs = {
      readFileSync: (path: string) => {
        calls.push(`read:${path}`);
        return "synthetic-password-content";
      },
      openSync: (path: string, _flags: number, mode: number) => {
        calls.push(`open:${path}:${mode.toString(8)}`);
        return 7;
      },
      writeSync: (_fd: number, value: string) => {
        written = value;
        calls.push("write");
        return value.length;
      },
      fchmodSync: (_fd: number, mode: number) => calls.push(`chmod:${mode.toString(8)}`),
      fchownSync: (_fd: number, uid: number, gid: number) => calls.push(`chown:${uid}:${gid}`),
      closeSync: (_fd: number) => calls.push("close"),
      unlinkSync: (path: string) => calls.push(`unlink:${path}`),
    };

    materializeRuntimeAcceptancePassword({ fs });

    expect(calls).toEqual([
      `read:${ACCEPTANCE_RUNTIME_PASSWORD_SOURCE_FILE}`,
      `open:${ACCEPTANCE_RUNTIME_PASSWORD_FILE}:600`,
      "write",
      "chmod:600",
      "chown:1000:1000",
      "close",
    ]);
    expect(calls.join(" ")).not.toContain("password-content");
    expect(written).toBe("synthetic-password-content");
  });

  it("removes partial runtime material when materialization fails", () => {
    const calls: string[] = [];
    const fs = {
      readFileSync: () => "synthetic-password-content",
      openSync: () => 7,
      writeSync: () => { throw new Error("synthetic write failure"); },
      fchmodSync: () => undefined,
      fchownSync: () => undefined,
      closeSync: () => calls.push("close"),
      unlinkSync: (path: string) => calls.push(`unlink:${path}`),
    };

    expect(() => materializeRuntimeAcceptancePassword({ fs })).toThrow(/materialization failed/);
    expect(calls).toEqual(["close", `unlink:${ACCEPTANCE_RUNTIME_PASSWORD_FILE}`]);
  });

  it("does not delete a pre-existing runtime path when exclusive creation fails", () => {
    const calls: string[] = [];
    const fs = {
      readFileSync: () => "synthetic-password-content",
      openSync: () => { throw new Error("already exists"); },
      writeSync: () => 0,
      fchmodSync: () => undefined,
      fchownSync: () => undefined,
      closeSync: () => calls.push("close"),
      unlinkSync: (path: string) => calls.push(`unlink:${path}`),
    };

    expect(() => materializeRuntimeAcceptancePassword({ fs })).toThrow(/materialization failed/);
    expect(calls).toEqual([]);
  });

  it("cleans only the fixed runtime file and ignores an already-removed file", () => {
    const calls: string[] = [];
    cleanupRuntimeAcceptancePassword({
      fs: { unlinkSync: (path: string) => calls.push(path) },
    });
    expect(calls).toEqual([ACCEPTANCE_RUNTIME_PASSWORD_FILE]);
  });
});
