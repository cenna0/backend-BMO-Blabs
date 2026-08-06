import { existsSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import {
  CANONICAL_BACKUP_MATERIAL_PATH,
  loadBackupConfig,
} from "../../src/p9/operator/backup-config.js";
import { runBackup } from "../../src/p9/operator/backup.js";
import { runBackupConfigPreflight } from "../../src/p9/operator/validate-backup-config.js";

const materialPath = CANONICAL_BACKUP_MATERIAL_PATH;

function fixtureFs(options: {
  isFile?: boolean;
  isSymbolicLink?: boolean;
  mode?: number;
  uid?: number;
  gid?: number;
  material?: string;
  readable?: boolean;
} = {}) {
  const {
    isFile = true,
    isSymbolicLink = false,
    mode = 0o100440,
    uid = 0,
    gid = 1002,
    material = "fixture-material-long-enough",
    readable = true,
  } = options;
  const accessSync = vi.fn(() => {
    if (!readable) throw new Error("permission denied");
  });
  return {
    accessSync,
    lstatSync: vi.fn(() => ({
      isFile: () => isFile,
      isSymbolicLink: () => isSymbolicLink,
      mode,
      uid,
      gid,
    })),
    readFileSync: vi.fn(() => material),
  };
}

function validEnvironment(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return { P9_BACKUP_PASSPHRASE_FILE: materialPath, ...overrides };
}

describe("P9 backup configuration preflight", () => {
  it("loads valid protected material without requiring or creating an output directory", () => {
    const outputDirectory = "/tmp/bmo-p9-preflight-output-that-must-not-exist";
    const fs = fixtureFs();

    const config = loadBackupConfig({
      env: { P9_BACKUP_PASSPHRASE_FILE: materialPath, P9_BACKUP_DIR: outputDirectory },
      fs,
      runtimeGid: 1002,
    });

    expect(config.passphraseFile).toBe(materialPath);
    expect(config.directory).toBeUndefined();
    expect(fs.lstatSync).toHaveBeenCalledWith(materialPath);
    expect(fs.accessSync).toHaveBeenCalled();
    expect(fs.readFileSync).toHaveBeenCalledWith(materialPath, "utf8");
    expect(existsSync(outputDirectory)).toBe(false);
  });

  it("rejects a missing path variable", () => {
    expect(() => loadBackupConfig({ env: {}, fs: fixtureFs(), runtimeGid: 1002 })).toThrow(
      "P9_BACKUP_PASSPHRASE_FILE is required",
    );
  });

  it("rejects a missing material file", () => {
    const fs = fixtureFs();
    fs.lstatSync.mockImplementation(() => {
      throw new Error("missing");
    });

    expect(() => loadBackupConfig({ env: validEnvironment(), fs, runtimeGid: 1002 })).toThrow(
      "backup encryption material is unavailable",
    );
  });

  it("rejects symlink and non-regular material", () => {
    expect(() => loadBackupConfig({
      env: validEnvironment(),
      fs: fixtureFs({ isSymbolicLink: true }),
      runtimeGid: 1002,
    })).toThrow("must not be a symlink");

    expect(() => loadBackupConfig({
      env: validEnvironment(),
      fs: fixtureFs({ isFile: false }),
      runtimeGid: 1002,
    })).toThrow("must be a regular file");
  });

  it("rejects unsafe ownership and permissions", () => {
    expect(() => loadBackupConfig({
      env: validEnvironment(),
      fs: fixtureFs({ uid: 1002 }),
      runtimeGid: 1002,
    })).toThrow("ownership is unsafe");

    expect(() => loadBackupConfig({
      env: validEnvironment(),
      fs: fixtureFs({ gid: 1003 }),
      runtimeGid: 1002,
    })).toThrow("ownership is unsafe");

    expect(() => loadBackupConfig({
      env: validEnvironment(),
      fs: fixtureFs({ mode: 0o100644 }),
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

  it("does not include material or path contents in validation errors", () => {
    const sentinel = "fixture-material-that-must-never-appear";
    const error = (() => {
      try {
        loadBackupConfig({
          env: validEnvironment(),
          fs: fixtureFs({ material: sentinel }),
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
      runtimeGid: 1002,
    });

    expect(config.directory).toBeUndefined();
    expect(existsSync(outputDirectory)).toBe(false);
  });

  it("uses the shared loader before output preparation and execution", async () => {
    const config = {
      directory: "/tmp/bmo-p9-backup-output",
      passphraseFile: materialPath,
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
