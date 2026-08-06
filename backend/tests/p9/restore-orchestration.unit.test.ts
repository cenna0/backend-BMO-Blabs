import { describe, expect, it, vi } from "vitest";

import {
  runRestore,
  type RestoreDependencies,
} from "../../src/p9/operator/restore.js";
import type { RestoreConfig } from "../../src/p9/operator/restore-config.js";

const config = {
  setDirectory: "/tmp/restore-incoming/p9-daily-20260806T072656Z",
  backupIdentifier: "p9-daily-20260806T072656Z",
  artifactPath: "/tmp/restore-incoming/p9-daily-20260806T072656Z/p9-daily-20260806T072656Z.dump.gpg",
  checksumPath: "/tmp/restore-incoming/p9-daily-20260806T072656Z/p9-daily-20260806T072656Z.dump.gpg.sha256",
  manifestPath: "/tmp/restore-incoming/p9-daily-20260806T072656Z/p9-daily-20260806T072656Z.manifest.json",
  passphraseFile: "/synthetic/passphrase-file",
  postgresPasswordFile: "/synthetic/postgres-password-file",
  targetDatabase: "bmo_restore_20260806",
  primaryDatabase: "bmo",
  postgresMajorVersion: 16,
  migrationState: "verified",
  composeFile: "/tmp/p9.1-compose.yml",
  composeProject: "bmo-p9-1",
  composeEnvFile: "/tmp/synthetic-compose.env",
} as RestoreConfig;

function dependencies(events: string[]): RestoreDependencies {
  return {
    loadConfig: vi.fn(async () => config),
    validateCompose: vi.fn(async () => { events.push("compose"); }),
    authenticateArtifact: vi.fn(async () => { events.push("gpg-authentication"); }),
    assertTargetAbsent: vi.fn(async () => { events.push("target-absent"); }),
    createTarget: vi.fn(async () => { events.push("target-created"); }),
    streamRestore: vi.fn(async () => { events.push("stream-restore"); }),
    cleanupTarget: vi.fn(async () => { events.push("cleanup"); }),
  };
}

describe("P9 restore orchestration safety boundary", () => {
  it("authenticates before target creation and leaves a successful target available", async () => {
    const events: string[] = [];
    const result = await runRestore({ directory: config.setDirectory, dependencies: dependencies(events) });

    expect(events).toEqual(["compose", "gpg-authentication", "target-absent", "target-created", "stream-restore"]);
    expect(result).toEqual({ backupIdentifier: config.backupIdentifier, targetDatabase: config.targetDatabase });
  });

  it("does not create a target when GPG authentication fails", async () => {
    const events: string[] = [];
    const deps = dependencies(events);
    deps.authenticateArtifact = vi.fn(async () => {
      events.push("gpg-authentication");
      throw new Error("GPG authentication failed: bad passphrase");
    });

    await expect(runRestore({ directory: config.setDirectory, dependencies: deps })).rejects.toThrow("GPG authentication failed");
    expect(events).toEqual(["compose", "gpg-authentication"]);
    expect(deps.createTarget).not.toHaveBeenCalled();
  });

  it("cleans only the explicitly created target after restore failure", async () => {
    const events: string[] = [];
    const deps = dependencies(events);
    deps.streamRestore = vi.fn(async () => {
      events.push("stream-restore");
      throw new Error("pg_restore failed: exit 1");
    });

    await expect(runRestore({ directory: config.setDirectory, dependencies: deps })).rejects.toThrow("pg_restore failed");
    expect(events).toEqual(["compose", "gpg-authentication", "target-absent", "target-created", "stream-restore", "cleanup"]);
    expect(deps.cleanupTarget).toHaveBeenCalledWith(config);
  });

  it("reports cleanup failure separately", async () => {
    const events: string[] = [];
    const deps = dependencies(events);
    deps.streamRestore = vi.fn(async () => { throw new Error("pg_restore failed: exit 1"); });
    deps.cleanupTarget = vi.fn(async () => { throw new Error("restore target cleanup failed"); });

    await expect(runRestore({ directory: config.setDirectory, dependencies: deps })).rejects.toThrow(/pg_restore failed.*cleanup failed/);
  });

  it("does not restore when the named target already exists", async () => {
    const events: string[] = [];
    const deps = dependencies(events);
    deps.assertTargetAbsent = vi.fn(async () => {
      events.push("target-exists");
      throw new Error("restore target already exists");
    });

    await expect(runRestore({ directory: config.setDirectory, dependencies: deps })).rejects.toThrow("restore target already exists");
    expect(events).toEqual(["compose", "gpg-authentication", "target-exists"]);
    expect(deps.createTarget).not.toHaveBeenCalled();
    expect(deps.streamRestore).not.toHaveBeenCalled();
  });
});
