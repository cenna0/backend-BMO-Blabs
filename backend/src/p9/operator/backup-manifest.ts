import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  createReadStream,
  existsSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename } from "node:path";

export const BACKUP_MANIFEST_SCHEMA_VERSION = 1 as const;
export const BACKUP_FORMAT = "postgresql-custom-encrypted" as const;
export const BACKUP_CREATION_RESULT = "success" as const;

const forbiddenKeyPattern = /(?:password|passphrase|token|secret|private.?key|credential|connection.?string|dsn|jwt|hmac|invitation|access.?key|refresh.?token|environment|env)/i;
const forbiddenValuePattern = /(?:postgres(?:ql)?:\/\/|-----BEGIN[^\n]*PRIVATE KEY-----|--passphrase(?:\s|=))/i;
const allowedManifestKeys = new Set([
  "schemaVersion",
  "backupIdentifier",
  "timestamp",
  "databaseIdentifier",
  "postgresMajorVersion",
  "backupFormat",
  "migrationState",
  "encryptedArtifactFilename",
  "encryptedArtifactSize",
  "sha256",
  "creationResult",
]);

export interface BackupManifest {
  schemaVersion: typeof BACKUP_MANIFEST_SCHEMA_VERSION;
  backupIdentifier: string;
  timestamp: string;
  databaseIdentifier: string;
  postgresMajorVersion: number;
  backupFormat: typeof BACKUP_FORMAT;
  migrationState: string;
  encryptedArtifactFilename: string;
  encryptedArtifactSize: number;
  sha256: string;
  creationResult: typeof BACKUP_CREATION_RESULT;
}

export interface BackupManifestInput {
  artifactPath: string;
  checksumPath: string;
  manifestPath: string;
  backupIdentifier: string;
  timestamp: string;
  databaseIdentifier: string;
  postgresMajorVersion: number;
  migrationState: string;
}

export interface BackupSetPaths {
  artifactPath: string;
  checksumPath: string;
  manifestPath: string;
}

interface ArtifactMetadata {
  filename: string;
  size: number;
  sha256: string;
}

function assertNoSecretBearingFields(value: unknown, path = "manifest"): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoSecretBearingFields(entry, `${path}[${index}]`));
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, nestedValue] of Object.entries(value)) {
      if (forbiddenKeyPattern.test(key)) {
        throw new Error(`manifest contains forbidden secret-bearing field: ${path}.${key}`);
      }
      assertNoSecretBearingFields(nestedValue, `${path}.${key}`);
    }
    return;
  }
  if (typeof value === "string" && forbiddenValuePattern.test(value)) {
    throw new Error(`manifest contains forbidden secret-bearing value at ${path}`);
  }
}

function assertSafeIdentifier(value: string, field: string): void {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(value)) {
    throw new Error(`${field} must be a sanitized PostgreSQL identifier`);
  }
}

function assertSafeBackupIdentifier(value: string): void {
  if (!/^p9-(?:daily|weekly)-[a-z0-9-]{1,110}$/i.test(value)) {
    throw new Error("backupIdentifier is not a supported P9 backup identifier");
  }
}

function parseChecksum(checksumPath: string, artifactFilename: string): string {
  const lines = readFileSync(checksumPath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length !== 1) throw new Error("backup checksum file must contain exactly one non-empty line");
  const line = lines[0];
  if (!line) throw new Error("backup checksum file is malformed");
  const match = /^(?<hash>[a-f0-9]{64})\s+\*?(?<filename>[^\s]+)$/i.exec(line);
  const groups = match?.groups;
  if (!groups?.hash || !groups.filename) throw new Error("backup checksum file is malformed");
  if (groups.filename !== artifactFilename) throw new Error("backup checksum filename does not match artifact");
  return groups.hash.toLowerCase();
}

export async function sha256File(path: string): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const digest = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("data", (chunk) => digest.update(chunk));
    stream.once("error", reject);
    stream.once("end", () => resolve(digest.digest("hex")));
  });
}

function validateManifestObject(
  value: unknown,
  expected: ArtifactMetadata & { backupIdentifier: string },
): BackupManifest {
  assertNoSecretBearingFields(value);
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("backup manifest must be a JSON object");
  }
  const manifest = value as Record<string, unknown>;
  const unexpectedKeys = Object.keys(manifest).filter((key) => !allowedManifestKeys.has(key));
  if (unexpectedKeys.length > 0) {
    throw new Error(`manifest contains forbidden or unexpected field: ${unexpectedKeys[0]}`);
  }
  if (manifest.schemaVersion !== BACKUP_MANIFEST_SCHEMA_VERSION) throw new Error("unsupported backup manifest schema version");
  if (manifest.backupIdentifier !== expected.backupIdentifier) throw new Error("manifest backup identifier mismatch");
  if (typeof manifest.timestamp !== "string" || Number.isNaN(Date.parse(manifest.timestamp))) throw new Error("manifest timestamp is invalid");
  if (typeof manifest.databaseIdentifier !== "string") throw new Error("manifest database identifier is invalid");
  assertSafeIdentifier(manifest.databaseIdentifier, "manifest databaseIdentifier");
  const postgresMajorVersion = manifest.postgresMajorVersion;
  if (typeof postgresMajorVersion !== "number" || !Number.isInteger(postgresMajorVersion) || postgresMajorVersion < 1 || postgresMajorVersion > 99) {
    throw new Error("manifest PostgreSQL major version is invalid");
  }
  if (manifest.backupFormat !== BACKUP_FORMAT) throw new Error("manifest backup format is invalid");
  if (
    typeof manifest.migrationState !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:/ -]{0,127}$/.test(manifest.migrationState)
  ) {
    throw new Error("manifest migration state is invalid");
  }
  if (typeof manifest.encryptedArtifactFilename !== "string" || manifest.encryptedArtifactFilename !== expected.filename) {
    throw new Error("manifest encrypted artifact filename mismatch");
  }
  if (manifest.encryptedArtifactSize !== expected.size || !Number.isSafeInteger(manifest.encryptedArtifactSize) || manifest.encryptedArtifactSize <= 0) {
    throw new Error("manifest encrypted artifact size mismatch");
  }
  if (typeof manifest.sha256 !== "string" || !/^[a-f0-9]{64}$/i.test(manifest.sha256) || manifest.sha256.toLowerCase() !== expected.sha256) {
    throw new Error("manifest encrypted artifact checksum mismatch");
  }
  if (manifest.creationResult !== BACKUP_CREATION_RESULT) throw new Error("manifest creation result is not success");
  return manifest as unknown as BackupManifest;
}

export async function validateBackupSet(paths: BackupSetPaths): Promise<BackupManifest> {
  if (!existsSync(paths.artifactPath)) throw new Error("encrypted backup artifact is missing");
  const artifact = statSync(paths.artifactPath);
  if (!artifact.isFile() || artifact.size <= 0) throw new Error("encrypted backup artifact is empty or not a file");
  const filename = basename(paths.artifactPath);
  if (!filename.endsWith(".dump.gpg")) throw new Error("encrypted backup artifact filename is invalid");
  const backupIdentifier = filename.slice(0, -".dump.gpg".length);
  assertSafeBackupIdentifier(backupIdentifier);
  const sha256 = await sha256File(paths.artifactPath);
  const expectedChecksum = parseChecksum(paths.checksumPath, filename);
  if (expectedChecksum !== sha256) throw new Error("backup checksum does not match encrypted artifact");
  const parsed = JSON.parse(readFileSync(paths.manifestPath, "utf8")) as unknown;
  return validateManifestObject(parsed, { backupIdentifier, filename, size: artifact.size, sha256 });
}

export async function writeSanitizedBackupManifest(input: BackupManifestInput): Promise<BackupManifest> {
  if (!existsSync(input.artifactPath)) throw new Error("encrypted backup artifact is missing");
  const artifact = statSync(input.artifactPath);
  if (!artifact.isFile() || artifact.size <= 0) throw new Error("encrypted backup artifact is empty or not a file");
  const filename = basename(input.artifactPath);
  if (filename !== `${input.backupIdentifier}.dump.gpg`) throw new Error("backup artifact filename does not match backup identifier");
  assertSafeBackupIdentifier(input.backupIdentifier);
  const sha256 = await sha256File(input.artifactPath);
  if (parseChecksum(input.checksumPath, filename) !== sha256) throw new Error("backup checksum does not match encrypted artifact");
  if (existsSync(input.manifestPath)) throw new Error("backup manifest already exists");

  const manifest = validateManifestObject({
    schemaVersion: BACKUP_MANIFEST_SCHEMA_VERSION,
    backupIdentifier: input.backupIdentifier,
    timestamp: input.timestamp,
    databaseIdentifier: input.databaseIdentifier,
    postgresMajorVersion: input.postgresMajorVersion,
    backupFormat: BACKUP_FORMAT,
    migrationState: input.migrationState,
    encryptedArtifactFilename: filename,
    encryptedArtifactSize: artifact.size,
    sha256,
    creationResult: BACKUP_CREATION_RESULT,
  }, { backupIdentifier: input.backupIdentifier, filename, size: artifact.size, sha256 });

  const temporaryManifestPath = `${input.manifestPath}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporaryManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    chmodSync(temporaryManifestPath, 0o600);
    renameSync(temporaryManifestPath, input.manifestPath);
  } catch (error) {
    try { unlinkSync(temporaryManifestPath); } catch { /* best effort cleanup */ }
    throw error;
  }
  return manifest;
}
