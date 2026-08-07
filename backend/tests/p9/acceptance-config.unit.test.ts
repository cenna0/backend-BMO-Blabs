import { describe, expect, it } from "vitest";

import {
  loadAcceptanceConfig,
  type AcceptanceConfigFs,
} from "../../src/p9/operator/acceptance-config.js";

function metadata(overrides: Partial<{ file: boolean; symlink: boolean; directory: boolean; mode: number; uid: number; gid: number }> = {}) {
  const value = {
    file: true,
    symlink: false,
    directory: true,
    mode: 0o600,
    uid: 1002,
    gid: 1002,
    ...overrides,
  };
  return {
    isFile: () => value.file,
    isSymbolicLink: () => value.symlink,
    isDirectory: () => value.directory,
    mode: value.mode,
    uid: value.uid,
    gid: value.gid,
  };
}

function fileSystem(overrides: Partial<{ file: boolean; symlink: boolean; directory: boolean; mode: number; uid: number; gid: number }> = {}): AcceptanceConfigFs {
  return {
    lstatSync: () => metadata(overrides),
    accessSync: () => undefined,
  };
}

function environment(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    P9_ACCEPTANCE_DATABASE: "bmo_restore_acceptance_test",
    P9_ACCEPTANCE_PORT: "3025",
    P9_ACCEPTANCE_BIND_HOST: "127.0.0.1",
    P9_ACCEPTANCE_NETWORK: "bmo-p9-1_p9_private",
    P9_ACCEPTANCE_PROJECT: "bmo-p9-1-restore-acceptance",
    P9_ACCEPTANCE_CONTAINER: "bmo-p9-1-restore-acceptance-runtime",
    P9_ACCEPTANCE_IMAGE: "bmo-p9.1-candidate:test",
    P9_ACCEPTANCE_CODE_DIR: "/opt/bmo/app/backend/dist/src",
    P9_ACCEPTANCE_POSTGRES_CONTAINER: "bmo-p9-1-postgres-1",
    P9_ACCEPTANCE_MIGRATIONS_DISABLED: "true",
    P9_POSTGRES_USER: "bmo",
    P9_POSTGRES_PASSWORD_FILE: "/tmp/postgres-password",
    P9_ACCEPTANCE_PASSWORD_FILE: "/tmp/acceptance-password",
    P9_ACCEPTANCE_RUNTIME_ENV_FILE: "/tmp/acceptance-runtime.env",
    ...overrides,
  };
}

function load(env = environment(), fs = fileSystem()) {
  return loadAcceptanceConfig({ env, fs, runtimeUid: 1002, runtimeGid: 1002 });
}

describe("P9 restored-target acceptance configuration", () => {
  it("accepts a complete safe configuration without side effects", () => {
    expect(load()).toMatchObject({
      database: "bmo_restore_acceptance_test",
      port: 3025,
      bindHost: "127.0.0.1",
      network: "bmo-p9-1_p9_private",
      migrationsDisabled: true,
      codeDirectory: "/opt/bmo/app/backend/dist/src",
      canonicalAcceptancePasswordFile: "/tmp/acceptance-password",
    });
  });

  it.each([
    ["primary database", { P9_ACCEPTANCE_DATABASE: "bmo" }],
    ["empty database", { P9_ACCEPTANCE_DATABASE: "" }],
    ["unsafe database", { P9_ACCEPTANCE_DATABASE: "bmo_review_restore" }],
    ["unsafe database punctuation", { P9_ACCEPTANCE_DATABASE: "bmo_restore_bad-name" }],
  ])("rejects %s", (_label, overrides) => {
    expect(() => load(environment(overrides))).toThrow();
  });

  it.each([
    ["public bind host", { P9_ACCEPTANCE_BIND_HOST: "0.0.0.0" }],
    ["wrong network", { P9_ACCEPTANCE_NETWORK: "bridge" }],
    ["production project", { P9_ACCEPTANCE_PROJECT: "bmo-production" }],
    ["candidate container", { P9_ACCEPTANCE_CONTAINER: "bmo-p9-1-backend-1" }],
    ["migrations enabled", { P9_ACCEPTANCE_MIGRATIONS_DISABLED: "false" }],
    ["wrong PostgreSQL user", { P9_POSTGRES_USER: "postgres" }],
  ])("rejects %s", (_label, overrides) => {
    expect(() => load(environment(overrides))).toThrow();
  });

  it.each([
    ["missing file", { file: false }],
    ["symlink", { symlink: true }],
    ["code directory is not a directory", { directory: false }],
    ["wrong mode", { mode: 0o644 }],
    ["group-readable mode", { mode: 0o640 }],
    ["wrong owner", { uid: 0 }],
    ["wrong group", { gid: 0 }],
  ])("rejects unsafe protected files: %s", (_label, fileOverrides) => {
    expect(() => load(environment(), fileSystem(fileOverrides))).toThrow();
  });

  it("rejects a container-owned canonical password file at the host boundary", () => {
    expect(() => load(environment(), fileSystem({ uid: 1000, gid: 1000 }))).toThrow(/ownership/);
  });

  it("requires all explicit runtime identity and secret-file values", () => {
    for (const key of [
      "P9_ACCEPTANCE_DATABASE",
      "P9_ACCEPTANCE_PORT",
      "P9_ACCEPTANCE_BIND_HOST",
      "P9_ACCEPTANCE_NETWORK",
      "P9_ACCEPTANCE_PROJECT",
      "P9_ACCEPTANCE_CONTAINER",
      "P9_ACCEPTANCE_IMAGE",
      "P9_ACCEPTANCE_CODE_DIR",
      "P9_ACCEPTANCE_POSTGRES_CONTAINER",
      "P9_ACCEPTANCE_MIGRATIONS_DISABLED",
      "P9_POSTGRES_PASSWORD_FILE",
      "P9_ACCEPTANCE_PASSWORD_FILE",
      "P9_ACCEPTANCE_RUNTIME_ENV_FILE",
    ]) {
      const env = environment();
      delete env[key];
      expect(() => load(env)).toThrow(key);
    }
  });
});
