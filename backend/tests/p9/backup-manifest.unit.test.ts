import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  BACKUP_FORMAT,
  BACKUP_MANIFEST_SCHEMA_VERSION,
  validateBackupSet,
  writeSanitizedBackupManifest,
} from "../../src/p9/operator/backup-manifest.js";

const temporaryDirectories: string[] = [];

function fixtureDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "bmo-p9-backup-manifest-"));
  temporaryDirectories.push(directory);
  return directory;
}

function writeFixture(directory: string, backupIdentifier = "p9-daily-20260805T021500Z"): {
  artifactPath: string;
  checksumPath: string;
  manifestPath: string;
  artifactBytes: Buffer;
  checksum: string;
} {
  const artifactBytes = Buffer.from("isolated encrypted fixture", "utf8");
  const artifactPath = join(directory, `${backupIdentifier}.dump.gpg`);
  const checksumPath = `${artifactPath}.sha256`;
  const manifestPath = join(directory, `${backupIdentifier}.manifest.json`);
  const checksum = createHash("sha256").update(artifactBytes).digest("hex");
  writeFileSync(artifactPath, artifactBytes);
  writeFileSync(checksumPath, `${checksum}  ${backupIdentifier}.dump.gpg\n`);
  return { artifactPath, checksumPath, manifestPath, artifactBytes, checksum };
}

async function createManifestFixture(directory: string, backupIdentifier = "p9-daily-20260805T021500Z") {
  const fixture = writeFixture(directory, backupIdentifier);
  const manifest = await writeSanitizedBackupManifest({
    artifactPath: fixture.artifactPath,
    checksumPath: fixture.checksumPath,
    manifestPath: fixture.manifestPath,
    backupIdentifier,
    timestamp: "2026-08-05T02:15:00.000Z",
    databaseIdentifier: "bmo",
    postgresMajorVersion: 16,
    migrationState: "verified",
  });
  return { ...fixture, manifest };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("P9.1 sanitized backup manifests", () => {
  it("generates the complete three-file set with exact artifact metadata", async () => {
    const directory = fixtureDirectory();
    const { artifactPath, checksumPath, manifestPath, artifactBytes, checksum, manifest } =
      await createManifestFixture(directory);

    expect(readdirSync(directory).sort()).toEqual([
      "p9-daily-20260805T021500Z.dump.gpg",
      "p9-daily-20260805T021500Z.dump.gpg.sha256",
      "p9-daily-20260805T021500Z.manifest.json",
    ]);
    expect(manifest).toMatchObject({
      schemaVersion: BACKUP_MANIFEST_SCHEMA_VERSION,
      backupIdentifier: "p9-daily-20260805T021500Z",
      backupFormat: BACKUP_FORMAT,
      encryptedArtifactFilename: "p9-daily-20260805T021500Z.dump.gpg",
      encryptedArtifactSize: artifactBytes.byteLength,
      sha256: checksum,
      creationResult: "success",
    });
    expect(readFileSync(manifestPath, "utf8")).toContain('"creationResult": "success"');
    await expect(validateBackupSet({ artifactPath, checksumPath, manifestPath })).resolves.toEqual(manifest);
  });

  it("does not emit a success manifest when the encrypted artifact is missing", async () => {
    const directory = fixtureDirectory();
    const fixture = writeFixture(directory);
    writeFileSync(fixture.artifactPath, "");

    await expect(writeSanitizedBackupManifest({
      artifactPath: join(directory, "missing.dump.gpg"),
      checksumPath: fixture.checksumPath,
      manifestPath: fixture.manifestPath,
      backupIdentifier: "p9-daily-20260805T021500Z",
      timestamp: "2026-08-05T02:15:00.000Z",
      databaseIdentifier: "bmo",
      postgresMajorVersion: 16,
      migrationState: "verified",
    })).rejects.toThrow(/artifact/i);
    expect(() => readFileSync(fixture.manifestPath)).toThrow();
  });

  it("fails closed for a checksum mismatch", async () => {
    const directory = fixtureDirectory();
    const fixture = writeFixture(directory);
    writeFileSync(fixture.checksumPath, `${"0".repeat(64)}  ${fixture.artifactPath.split("/").pop()}\n`);

    await expect(writeSanitizedBackupManifest({
      artifactPath: fixture.artifactPath,
      checksumPath: fixture.checksumPath,
      manifestPath: fixture.manifestPath,
      backupIdentifier: "p9-daily-20260805T021500Z",
      timestamp: "2026-08-05T02:15:00.000Z",
      databaseIdentifier: "bmo",
      postgresMajorVersion: 16,
      migrationState: "verified",
    })).rejects.toThrow(/checksum/i);
    expect(() => readFileSync(fixture.manifestPath)).toThrow();
  });

  it("rejects a manifest that names another artifact or contains nested secret fields", async () => {
    const directory = fixtureDirectory();
    const { artifactPath, checksumPath, manifestPath, manifest } = await createManifestFixture(directory);
    writeFileSync(manifestPath, JSON.stringify({
      ...manifest,
      encryptedArtifactFilename: "another-backup.dump.gpg",
      metadata: { credentials: { password: "not-a-real-secret" } },
    }));

    await expect(validateBackupSet({ artifactPath, checksumPath, manifestPath })).rejects.toThrow(
      /manifest.*(artifact|secret|unexpected)|secret.*manifest/i,
    );
  });

  it("rejects malformed or missing encrypted backup metadata", async () => {
    const directory = fixtureDirectory();
    const fixture = writeFixture(directory);
    writeFileSync(fixture.checksumPath, "not-a-checksum\n");

    await expect(validateBackupSet({
      artifactPath: fixture.artifactPath,
      checksumPath: fixture.checksumPath,
      manifestPath: fixture.manifestPath,
    })).rejects.toThrow(/checksum|manifest/i);
  });

  it("rejects migration metadata that could carry an environment value", async () => {
    const directory = fixtureDirectory();
    const fixture = writeFixture(directory);

    await expect(writeSanitizedBackupManifest({
      artifactPath: fixture.artifactPath,
      checksumPath: fixture.checksumPath,
      manifestPath: fixture.manifestPath,
      backupIdentifier: "p9-daily-20260805T021500Z",
      timestamp: "2026-08-05T02:15:00.000Z",
      databaseIdentifier: "bmo",
      postgresMajorVersion: 16,
      migrationState: "verified=unexpected",
    })).rejects.toThrow(/migration state/i);
  });
});
