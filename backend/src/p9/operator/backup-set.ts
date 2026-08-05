import { randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  linkSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename } from "node:path";

import {
  sha256File,
  validateBackupSet,
  writeSanitizedBackupManifest,
  type BackupManifest,
  type BackupManifestInput,
  type BackupSetPaths,
} from "./backup-manifest.js";

export interface FinalizeBackupSetInput extends Omit<BackupManifestInput, "artifactPath" | "checksumPath" | "manifestPath"> {
  artifactTempPath: string;
  artifactPath: string;
  checksumPath: string;
  manifestPath: string;
}

export interface FinalizedBackupSet {
  paths: BackupSetPaths;
  sha256: string;
  manifest: BackupManifest;
}

export interface FinalizeBackupSetDependencies {
  hashFile?: typeof sha256File;
  writeManifest?: (input: BackupManifestInput) => Promise<BackupManifest>;
  validateSet?: typeof validateBackupSet;
  promote?: (temporaryPath: string, finalPath: string) => void;
}

function removeIfPresent(path: string): void {
  try {
    unlinkSync(path);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") throw error;
  }
}

function assertTemporaryArtifact(path: string): void {
  const artifact = statSync(path);
  if (!artifact.isFile() || artifact.size <= 0) {
    throw new Error("encrypted backup temporary artifact is empty or not a file");
  }
}

function promoteWithoutOverwrite(temporaryPath: string, finalPath: string): void {
  // linkSync gives this promotion no-overwrite semantics on the same filesystem.
  // The temporary path is removed only after the final link exists.
  linkSync(temporaryPath, finalPath);
  try {
    unlinkSync(temporaryPath);
  } catch (error) {
    try { unlinkSync(finalPath); } catch { /* best effort rollback */ }
    throw error;
  }
}

function writeChecksumFile(path: string, sha256: string, artifactFilename: string): void {
  writeFileSync(path, `${sha256}  ${artifactFilename}\n`, { flag: "wx", mode: 0o600 });
  chmodSync(path, 0o600);
}

export function cleanupFinalizedBackupSet(paths: BackupSetPaths): void {
  for (const path of [paths.artifactPath, paths.checksumPath, paths.manifestPath]) {
    removeIfPresent(path);
  }
}

export async function finalizeBackupSet(
  input: FinalizeBackupSetInput,
  dependencies: FinalizeBackupSetDependencies = {},
): Promise<FinalizedBackupSet> {
  const hashFile = dependencies.hashFile ?? sha256File;
  const writeManifest = dependencies.writeManifest ?? writeSanitizedBackupManifest;
  const validateSet = dependencies.validateSet ?? validateBackupSet;
  const promote = dependencies.promote ?? promoteWithoutOverwrite;
  const checksumTemporaryPath = `${input.checksumPath}.${randomUUID()}.tmp`;
  const manifestTemporaryPath = `${input.manifestPath}.${randomUUID()}.tmp`;
  const finalPaths: BackupSetPaths = {
    artifactPath: input.artifactPath,
    checksumPath: input.checksumPath,
    manifestPath: input.manifestPath,
  };
  const promotedPaths: string[] = [];
  const temporaryPaths = [input.artifactTempPath, checksumTemporaryPath, manifestTemporaryPath];

  try {
    if ([input.artifactPath, input.checksumPath, input.manifestPath].some((path) => existsSync(path))) {
      throw new Error("backup final set collision: an intended final path already exists");
    }

    assertTemporaryArtifact(input.artifactTempPath);
    chmodSync(input.artifactTempPath, 0o600);

    promote(input.artifactTempPath, input.artifactPath);
    promotedPaths.push(input.artifactPath);

    const sha256 = await hashFile(input.artifactPath);
    writeChecksumFile(checksumTemporaryPath, sha256, basename(input.artifactPath));
    promote(checksumTemporaryPath, input.checksumPath);
    promotedPaths.push(input.checksumPath);

    const manifest = await writeManifest({
      artifactPath: input.artifactPath,
      checksumPath: input.checksumPath,
      manifestPath: manifestTemporaryPath,
      backupIdentifier: input.backupIdentifier,
      timestamp: input.timestamp,
      databaseIdentifier: input.databaseIdentifier,
      postgresMajorVersion: input.postgresMajorVersion,
      migrationState: input.migrationState,
    });
    promote(manifestTemporaryPath, input.manifestPath);
    promotedPaths.push(input.manifestPath);

    await validateSet(finalPaths);
    return { paths: finalPaths, sha256, manifest };
  } catch (error) {
    for (const path of [...promotedPaths, ...temporaryPaths]) {
      try { removeIfPresent(path); } catch { /* preserve the original failure */ }
    }
    throw error;
  }
}
