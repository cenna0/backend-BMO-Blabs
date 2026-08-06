import { createHash } from "node:crypto";
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  loadRestoreConfig,
  type RestoreConfig,
} from "../../src/p9/operator/restore-config.js";
import {
  CANONICAL_BACKUP_MATERIAL_PATH,
  type BackupConfigFs,
} from "../../src/p9/operator/backup-config.js";

const backupIdentifier = "p9-daily-20260806T072656Z";
const artifactFilename = `${backupIdentifier}.dump.gpg`;
const checksumFilename = `${artifactFilename}.sha256`;
const manifestFilename = `${backupIdentifier}.manifest.json`;
const passwordPath = "/tmp/synthetic-p9-postgres-password";
const runtimeUid = process.getuid?.() ?? 1000;
const runtimeGid = process.getgid?.() ?? 1000;

interface Fixture {
  root: string;
  setDirectory: string;
  artifactPath: string;
  checksumPath: string;
  manifestPath: string;
}

function protectedFs(overrides: {
  passphraseMode?: number;
  passwordMode?: number;
  passphraseUid?: number;
  passphraseGid?: number;
  passwordUid?: number;
  passwordGid?: number;
} = {}): BackupConfigFs {
  const passphrase = {
    mode: overrides.passphraseMode ?? 0o440,
    uid: overrides.passphraseUid ?? 0,
    gid: overrides.passphraseGid ?? runtimeGid,
  };
  const password = {
    mode: overrides.passwordMode ?? 0o600,
    uid: overrides.passwordUid ?? runtimeUid,
    gid: overrides.passwordGid ?? runtimeGid,
  };

  return {
    lstatSync(path) {
      if (path === CANONICAL_BACKUP_MATERIAL_PATH) {
        return {
          isFile: () => true,
          isSymbolicLink: () => false,
          mode: passphrase.mode,
          uid: passphrase.uid,
          gid: passphrase.gid,
        };
      }
      if (path === passwordPath) {
        return {
          isFile: () => true,
          isSymbolicLink: () => false,
          mode: password.mode,
          uid: password.uid,
          gid: password.gid,
        };
      }
      throw new Error("missing synthetic protected file");
    },
    accessSync() {},
    readFileSync() {
      return "synthetic-material-that-is-never-logged";
    },
  };
}

function createFixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), "bmo-p9-restore-config-"));
  const incoming = join(root, "incoming");
  const setDirectory = join(incoming, backupIdentifier);
  mkdirSync(setDirectory, { recursive: true, mode: 0o700 });
  chmodSync(root, 0o700);
  chmodSync(incoming, 0o700);
  chmodSync(setDirectory, 0o700);

  const artifactPath = join(setDirectory, artifactFilename);
  const checksumPath = join(setDirectory, checksumFilename);
  const manifestPath = join(setDirectory, manifestFilename);
  const artifact = Buffer.from("synthetic encrypted custom-format artifact");
  const hash = createHashHex(artifact);
  writeFileSync(artifactPath, artifact, { mode: 0o600 });
  writeFileSync(checksumPath, `${hash}  ${artifactFilename}\n`, { mode: 0o600 });
  writeFileSync(manifestPath, JSON.stringify({
    schemaVersion: 1,
    backupIdentifier,
    timestamp: "2026-08-06T07:26:56.000Z",
    databaseIdentifier: "bmo",
    postgresMajorVersion: 16,
    backupFormat: "postgresql-custom-encrypted",
    migrationState: "verified",
    encryptedArtifactFilename: artifactFilename,
    encryptedArtifactSize: artifact.length,
    sha256: hash,
    creationResult: "success",
  }), { mode: 0o600 });
  for (const path of [artifactPath, checksumPath, manifestPath]) chmodSync(path, 0o600);
  return { root, setDirectory, artifactPath, checksumPath, manifestPath };
}

function createHashHex(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function environment(target = "bmo_restore_20260806") : NodeJS.ProcessEnv {
  return {
    P9_BACKUP_PASSPHRASE_FILE: CANONICAL_BACKUP_MATERIAL_PATH,
    P9_POSTGRES_PASSWORD_FILE: passwordPath,
    P9_RESTORE_DATABASE: target,
    P9_POSTGRES_DB: "bmo",
    P9_COMPOSE_PROJECT: "bmo-p9-1",
    P9_COMPOSE_ENV_FILE: "/tmp/synthetic-compose.env",
  };
}

function options(fixture: Fixture, env = environment()) {
  return {
    env,
    protectedFs: protectedFs(),
    runtimeUid,
    runtimeGid,
    restoreStagingRoot: fixture.root,
  };
}

async function expectConfig(fixture: Fixture): Promise<RestoreConfig> {
  return await loadRestoreConfig(fixture.setDirectory, options(fixture));
}

describe("P9 exact PC-copy restore configuration", () => {
  it("accepts a complete exact staged set and safe fresh target", async () => {
    const fixture = createFixture();
    try {
      const config = await expectConfig(fixture);
      expect(config.backupIdentifier).toBe(backupIdentifier);
      expect(config.artifactPath).toBe(fixture.artifactPath);
      expect(config.targetDatabase).toBe("bmo_restore_20260806");
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  it.each([
    ["missing staged member", (f: Fixture) => unlinkSync(f.checksumPath)],
    ["extra staged member", (f: Fixture) => writeFileSync(join(f.setDirectory, "unexpected.txt"), "x", { mode: 0o600 })],
    ["staged symlink", (f: Fixture) => { unlinkSync(f.artifactPath); symlinkSync(f.manifestPath, f.artifactPath); }],
    ["unsafe staged mode", (f: Fixture) => chmodSync(f.manifestPath, 0o644)],
  ] as const)("rejects %s", async (_label, mutate) => {
    const fixture = createFixture();
    try {
      mutate(fixture);
      await expect(expectConfig(fixture)).rejects.toThrow();
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  it.each([
    ["checksum mismatch", (f: Fixture) => writeFileSync(f.checksumPath, `${"0".repeat(64)}  ${artifactFilename}\n`, { mode: 0o600 })],
    ["sidecar filename mismatch", (f: Fixture) => writeFileSync(f.checksumPath, `${createHashHex(readFileSync(f.artifactPath))}  other.dump.gpg\n`, { mode: 0o600 })],
    ["malformed manifest", (f: Fixture) => writeFileSync(f.manifestPath, "not-json", { mode: 0o600 })],
    ["manifest identifier mismatch", (f: Fixture) => writeFileSync(f.manifestPath, JSON.stringify({ backupIdentifier: "wrong" }), { mode: 0o600 })],
    ["manifest size mismatch", (f: Fixture) => { const manifest = JSON.parse(readFileSync(f.manifestPath, "utf8")) as Record<string, unknown>; manifest.encryptedArtifactSize = 1; writeFileSync(f.manifestPath, JSON.stringify(manifest), { mode: 0o600 }); }],
    ["manifest hash mismatch", (f: Fixture) => { const manifest = JSON.parse(readFileSync(f.manifestPath, "utf8")) as Record<string, unknown>; manifest.sha256 = "0".repeat(64); writeFileSync(f.manifestPath, JSON.stringify(manifest), { mode: 0o600 }); }],
  ] as const)("rejects %s", async (_label, mutate) => {
    const fixture = createFixture();
    try {
      mutate(fixture);
      await expect(expectConfig(fixture)).rejects.toThrow();
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  it.each([
    ["missing passphrase path", { P9_BACKUP_PASSPHRASE_FILE: undefined }],
    ["missing PostgreSQL password path", { P9_POSTGRES_PASSWORD_FILE: undefined }],
    ["empty PostgreSQL password path", { P9_POSTGRES_PASSWORD_FILE: "" }],
    ["unsafe restore database name", { P9_RESTORE_DATABASE: "bmo;drop database bmo" }],
    ["primary restore database", { P9_RESTORE_DATABASE: "bmo" }],
  ] as const)("fails closed for %s", async (_label, overrides) => {
    const fixture = createFixture();
    try {
      const env = { ...environment(), ...overrides };
      await expect(loadRestoreConfig(fixture.setDirectory, options(fixture, env))).rejects.toThrow();
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  it.each([
    ["unsafe password mode", { passwordMode: 0o644 }],
    ["password symlink", { passwordMode: 0o600 }],
    ["unsafe passphrase mode", { passphraseMode: 0o644 }],
  ] as const)("rejects %s", async (_label, metadata) => {
    const fixture = createFixture();
    try {
      const fs = protectedFs(metadata);
      if (_label === "password symlink") {
        const env = environment();
        await expect(loadRestoreConfig(fixture.setDirectory, { ...options(fixture, env), protectedFs: {
          ...fs,
          lstatSync(path) {
            if (path === passwordPath) return { isFile: () => true, isSymbolicLink: () => true, mode: 0o600, uid: runtimeUid, gid: runtimeGid };
            return fs.lstatSync(path);
          },
        } })).rejects.toThrow();
      } else {
        await expect(loadRestoreConfig(fixture.setDirectory, { ...options(fixture), protectedFs: fs })).rejects.toThrow();
      }
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });
});
