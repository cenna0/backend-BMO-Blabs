import { existsSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import {
  CANONICAL_BACKUP_MATERIAL_PATH,
  loadBackupConfig,
} from "../../src/p9/operator/backup-config.js";
import { runBackup } from "../../src/p9/operator/backup.js";
import { runBackupConfigPreflight } from "../../src/p9/operator/validate-backup-config.js";

const materialPath = CANONICAL_BACKUP_MATERIAL_PATH;
const passwordPath = "/tmp/bmo-p9-password-file";

function fixtureFs(options: {
  isFile?: boolean;
  isSymbolicLink?: boolean;
  mode?: number;
  uid?: number;
  gid?: number;
  passwordIsFile?: boolean;
  passwordIsSymbolicLink?: boolean;
  passwordMode?: number;
  passwordUid?: number;
  passwordGid?: number;
  material?: string;
  materialMissing?: boolean;
  readable?: boolean;
  passwordReadable?: boolean;
} = {}) {
  const {
    isFile = true,
    isSymbolicLink = false,
    mode = 0o100440,
    uid = 0,
    gid = 1002,
    passwordIsFile = true,
    passwordIsSymbolicLink = false,
    passwordMode = 0o100600,
    passwordUid = 1002,
    passwordGid = 1002,
    material = "fixture-material-long-enough",
    materialMissing = false,
    readable = true,
    passwordReadable = true,
  } = options;
  const materialMetadata = {
    isFile: () => isFile,
    isSymbolicLink: () => isSymbolicLink,
    mode,
    uid,
    gid,
  };
  const passwordMetadata = {
    isFile: () => passwordIsFile,
    isSymbolicLink: () => passwordIsSymbolicLink,
    mode: passwordMode,
    uid: passwordUid,
    gid: passwordGid,
  };
  return {
    accessSync: vi.fn((path: string) => {
      if (path === passwordPath && !passwordReadable) throw new Error("permission denied");
      if (path !== passwordPath && !readable) throw new Error("permission denied");
    }),
    lstatSync: vi.fn((path: string) => {
      if (path !== passwordPath && materialMissing) throw new Error("missing");
      return path === passwordPath ? passwordMetadata : materialMetadata;
    }),
    readFileSync: vi.fn(() => material),
  };
}

function validEnvironment(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    P9_BACKUP_PASSPHRASE_FILE: materialPath,
    P9_POSTGRES_PASSWORD_FILE: passwordPath,
    ...overrides,
  };
}

describe("P9 backup configuration preflight", () => {
  it("loads valid protected material without requiring or creating an output directory", () => {
    const outputDirectory = "/tmp/bmo-p9-preflight-output-that-must-not-exist";
    const fs = fixtureFs();

    const config = loadBackupConfig({
      env: validEnvironment({ P9_BACKUP_DIR: outputDirectory }),
      fs,
      runtimeUid: 1002,
      runtimeGid: 1002,
    });

    expect(config.passphraseFile).toBe(materialPath);
    expect(config.postgresPasswordFile).toBe(passwordPath);
    expect(config.directory).toBeUndefined();
    expect(fs.lstatSync).toHaveBeenCalledWith(passwordPath);
    expect(fs.lstatSync).toHaveBeenCalledWith(materialPath);
    expect(fs.accessSync).toHaveBeenCalledWith(passwordPath, expect.any(Number));
    expect(fs.readFileSync).toHaveBeenCalledWith(materialPath, "utf8");
    expect(existsSync(outputDirectory)).toBe(false);
  });

  it("rejects a missing path variable", () => {
    expect(() => loadBackupConfig({ env: { P9_POSTGRES_PASSWORD_FILE: passwordPath }, fs: fixtureFs(), runtimeUid: 1002, runtimeGid: 1002 })).toThrow(
      "P9_BACKUP_PASSPHRASE_FILE is required",
    );
  });

  it("rejects a missing PostgreSQL password-file variable", () => {
    expect(() => loadBackupConfig({ env: { P9_BACKUP_PASSPHRASE_FILE: materialPath }, fs: fixtureFs(), runtimeUid: 1002, runtimeGid: 1002 })).toThrow(
      "P9_POSTGRES_PASSWORD_FILE is required",
    );
  });

  it("rejects a missing material file", () => {
    expect(() => loadBackupConfig({ env: validEnvironment(), fs: fixtureFs({ materialMissing: true }), runtimeUid: 1002, runtimeGid: 1002 })).toThrow(
      "backup encryption material is unavailable",
    );
  });

  it("rejects symlink and non-regular material", () => {
    expect(() => loadBackupConfig({
      env: validEnvironment(),
      fs: fixtureFs({ isSymbolicLink: true }),
      runtimeUid: 1002,
      runtimeGid: 1002,
    })).toThrow("must not be a symlink");

    expect(() => loadBackupConfig({
      env: validEnvironment(),
      fs: fixtureFs({ isFile: false }),
      runtimeUid: 1002,
      runtimeGid: 1002,
    })).toThrow("must be a regular file");
  });

  it("rejects unsafe ownership and permissions", () => {
    expect(() => loadBackupConfig({
      env: validEnvironment(),
      fs: fixtureFs({ uid: 1002 }),
      runtimeUid: 1002,
      runtimeGid: 1002,
    })).toThrow("ownership is unsafe");

    expect(() => loadBackupConfig({
      env: validEnvironment(),
      fs: fixtureFs({ gid: 1003 }),
      runtimeUid: 1002,
      runtimeGid: 1002,
    })).toThrow("ownership is unsafe");

    expect(() => loadBackupConfig({
      env: validEnvironment(),
      fs: fixtureFs({ mode: 0o100644 }),
      runtimeUid: 1002,
      runtimeGid: 1002,
    })).toThrow("permissions are unsafe");
  });

  it("rejects unreadable, empty, and weak material", () => {
    expect(() => loadBackupConfig({
      env: validEnvironment(),
      fs: fixtureFs({ readable: false }),
      runtimeGid: 1002,
    })).toThrow("material is unreadable");

    expect(() => loadBackupConfig({
      env: validEnvironment(),
      fs: fixtureFs({ material: " \n" }),
      runtimeGid: 1002,
    })).toThrow("material is empty");

    expect(() => loadBackupConfig({
      env: validEnvironment(),
      fs: fixtureFs({ material: "short" }),
      runtimeGid: 1002,
    })).toThrow("material is too weak");
  });

  it("rejects an empty, relative, missing, symlinked, unsafe, or unreadable PostgreSQL password file", () => {
    const base = { P9_BACKUP_PASSPHRASE_FILE: materialPath };
    expect(() => loadBackupConfig({ env: { ...base, P9_POSTGRES_PASSWORD_FILE: "" }, fs: fixtureFs(), runtimeUid: 1002, runtimeGid: 1002 })).toThrow("P9_POSTGRES_PASSWORD_FILE is required");
    expect(() => loadBackupConfig({ env: { ...base, P9_POSTGRES_PASSWORD_FILE: "relative/password" }, fs: fixtureFs(), runtimeUid: 1002, runtimeGid: 1002 })).toThrow("absolute path");
    expect(() => loadBackupConfig({ env: { ...base, P9_POSTGRES_PASSWORD_FILE: passwordPath }, fs: { ...fixtureFs(), lstatSync: vi.fn(() => { throw new Error("missing"); }) }, runtimeUid: 1002, runtimeGid: 1002 })).toThrow("password file is unavailable");
    expect(() => loadBackupConfig({ env: validEnvironment(), fs: fixtureFs({ passwordIsSymbolicLink: true }), runtimeUid: 1002, runtimeGid: 1002 })).toThrow("password file must not be a symlink");
    expect(() => loadBackupConfig({ env: validEnvironment(), fs: fixtureFs({ passwordIsFile: false }), runtimeUid: 1002, runtimeGid: 1002 })).toThrow("password file must be a regular file");
    expect(() => loadBackupConfig({ env: validEnvironment(), fs: fixtureFs({ passwordMode: 0o100644 }), runtimeUid: 1002, runtimeGid: 1002 })).toThrow("password file permissions are unsafe");
    expect(() => loadBackupConfig({ env: validEnvironment(), fs: fixtureFs({ passwordUid: 0 }), runtimeUid: 1002, runtimeGid: 1002 })).toThrow("password file ownership is unsafe");
    expect(() => loadBackupConfig({ env: validEnvironment(), fs: fixtureFs({ passwordGid: 0 }), runtimeUid: 1002, runtimeGid: 1002 })).toThrow("password file ownership is unsafe");
    expect(() => loadBackupConfig({ env: validEnvironment(), fs: fixtureFs({ passwordReadable: false }), runtimeUid: 1002, runtimeGid: 1002 })).toThrow("password file is unreadable");
  });

  it("does not include material or path contents in validation errors", () => {
    const sentinel = "fixture-material-that-must-never-appear";
    const error = (() => {
      try {
        loadBackupConfig({
          env: validEnvironment(),
          fs: fixtureFs({ material: sentinel }),
          runtimeUid: 1002,
          runtimeGid: 1003,
        });
        return undefined;
      } catch (caught) {
        return caught;
      }
    })();

    expect(error).toBeInstanceOf(Error);
    expect(String(error)).not.toContain(sentinel);
    expect(String(error)).not.toContain(materialPath);
  });

  it("runs the dedicated preflight without an output directory or process launcher", () => {
    const outputDirectory = "/tmp/bmo-p9-preflight-entrypoint-output-that-must-not-exist";
    const config = runBackupConfigPreflight({
      env: validEnvironment({ P9_BACKUP_DIR: outputDirectory }),
      fs: fixtureFs(),
      runtimeUid: 1002,
      runtimeGid: 1002,
    });

    expect(config.directory).toBeUndefined();
    expect(existsSync(outputDirectory)).toBe(false);
  });

  it("uses the shared loader before output preparation and execution", async () => {
    const config = {
      directory: "/tmp/bmo-p9-backup-output",
      passphraseFile: materialPath,
      postgresPasswordFile: passwordPath,
      kind: "daily" as const,
      retention: 7,
      databaseIdentifier: "bmo",
      postgresMajorVersion: 16,
      migrationState: "not-verified",
    };
    const loadConfig = vi.fn(() => config);
    const prepareDirectory = vi.fn((directory: string | undefined) => directory ?? "");
    const execute = vi.fn(async () => undefined);

    await runBackup({ loadConfig, prepareDirectory, execute });

    expect(loadConfig).toHaveBeenCalledWith({ requireOutputDirectory: true });
    expect(prepareDirectory).toHaveBeenCalledWith(config.directory);
    expect(execute).toHaveBeenCalledWith(config);
  });

  it("does not prepare output or execute tooling when shared validation fails", async () => {
    const validationError = new Error("sanitized validation failure");
    const loadConfig = vi.fn(() => {
      throw validationError;
    });
    const prepareDirectory = vi.fn((directory: string | undefined) => directory ?? "");
    const execute = vi.fn(async () => undefined);

    await expect(runBackup({ loadConfig, prepareDirectory, execute })).rejects.toBe(validationError);
    expect(prepareDirectory).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });
});
