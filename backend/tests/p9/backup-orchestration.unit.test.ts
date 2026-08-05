import { createHash } from "node:crypto";
import { existsSync, linkSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { finalizeBackupSet, type FinalizeBackupSetInput } from "../../src/p9/operator/backup-set.js";
import { validateBackupSet, writeSanitizedBackupManifest } from "../../src/p9/operator/backup-manifest.js";

const temporaryDirectories: string[] = [];

function fixtureDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "bmo-p9-backup-orchestration-"));
  temporaryDirectories.push(directory);
  return directory;
}

function operationInput(directory: string, backupIdentifier = "p9-daily-20260805T021500Z"): FinalizeBackupSetInput {
  const artifactPath = join(directory, `${backupIdentifier}.dump.gpg`);
  const artifactTempPath = join(directory, `.${backupIdentifier}.encrypted.tmp`);
  writeFileSync(artifactTempPath, Buffer.from("encrypted rehearsal ciphertext", "utf8"));
  return {
    artifactTempPath,
    artifactPath,
    checksumPath: `${artifactPath}.sha256`,
    manifestPath: join(directory, `${backupIdentifier}.manifest.json`),
    backupIdentifier,
    timestamp: "2026-08-05T02:15:00.000Z",
    databaseIdentifier: "bmo",
    postgresMajorVersion: 16,
    migrationState: "verified",
  };
}

async function createSuccessfulSet(directory: string, backupIdentifier: string): Promise<string[]> {
  const input = operationInput(directory, backupIdentifier);
  await finalizeBackupSet(input);
  return readdirSync(directory).sort();
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("P9.1 encrypted backup orchestration", () => {
  it("creates exactly three validated final files with no temporary residue", async () => {
    const directory = fixtureDirectory();
    const input = operationInput(directory);

    const result = await finalizeBackupSet(input);

    expect(readdirSync(directory).sort()).toEqual([
      "p9-daily-20260805T021500Z.dump.gpg",
      "p9-daily-20260805T021500Z.dump.gpg.sha256",
      "p9-daily-20260805T021500Z.manifest.json",
    ]);
    expect(result.sha256).toBe(createHash("sha256").update("encrypted rehearsal ciphertext").digest("hex"));
    await expect(validateBackupSet({
      artifactPath: input.artifactPath,
      checksumPath: input.checksumPath,
      manifestPath: input.manifestPath,
    })).resolves.toMatchObject({
      backupIdentifier: input.backupIdentifier,
      encryptedArtifactFilename: `${input.backupIdentifier}.dump.gpg`,
      creationResult: "success",
    });
  });

  it("removes the finalized artifact and checksum when manifest writing fails", async () => {
    const directory = fixtureDirectory();
    const input = operationInput(directory);

    await expect(finalizeBackupSet(input, {
      writeManifest: async () => {
        throw new Error("manifest write failure");
      },
    })).rejects.toThrow("manifest write failure");

    expect(readdirSync(directory)).toEqual([]);
  });

  it("removes the complete failed set when final validation fails", async () => {
    const directory = fixtureDirectory();
    const input = operationInput(directory);

    await expect(finalizeBackupSet(input, {
      validateSet: async () => {
        throw new Error("manifest secret validation failure");
      },
    })).rejects.toThrow("manifest secret validation failure");

    expect(readdirSync(directory)).toEqual([]);
  });

  it("rolls back files promoted before a later promotion failure", async () => {
    const directory = fixtureDirectory();
    const input = operationInput(directory);
    let promotionCount = 0;

    await expect(finalizeBackupSet(input, {
      promote: (temporaryPath, finalPath) => {
        promotionCount += 1;
        if (promotionCount === 2) throw new Error("second promotion failure");
        linkSync(temporaryPath, finalPath);
        rmSync(temporaryPath);
      },
    })).rejects.toThrow("second promotion failure");

    expect(promotionCount).toBe(2);
    expect(readdirSync(directory)).toEqual([]);
  });

  it("rejects a pre-existing collision without overwriting or deleting it", async () => {
    const directory = fixtureDirectory();
    const input = operationInput(directory);
    const existing = Buffer.from("pre-existing backup", "utf8");
    writeFileSync(input.artifactPath, existing);

    await expect(finalizeBackupSet(input)).rejects.toThrow(/already exists|collision/i);

    expect(readFileSync(input.artifactPath)).toEqual(existing);
    expect(readdirSync(directory)).toEqual([`${input.backupIdentifier}.dump.gpg`]);
  });

  it("preserves an unrelated completed backup set after a failed operation", async () => {
    const directory = fixtureDirectory();
    const unrelatedIdentifier = "p9-daily-20260804T021500Z";
    const unrelatedFiles = await createSuccessfulSet(directory, unrelatedIdentifier);
    const before = new Map(unrelatedFiles.map((name) => [name, readFileSync(join(directory, name))]));
    const input = operationInput(directory, "p9-daily-20260805T021500Z");

    await expect(finalizeBackupSet(input, {
      writeManifest: async () => {
        throw new Error("new operation failed");
      },
    })).rejects.toThrow("new operation failed");

    expect(readdirSync(directory).sort()).toEqual(unrelatedFiles);
    for (const [name, content] of before) expect(readFileSync(join(directory, name))).toEqual(content);
    expect(existsSync(input.artifactPath)).toBe(false);
  });
});
