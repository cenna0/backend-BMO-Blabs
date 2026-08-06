import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

const backendRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const backupSourcePath = resolve(backendRoot, "src/p9/operator/backup.ts");
const backupConfigSourcePath = resolve(backendRoot, "src/p9/operator/backup-config.ts");
const canonicalMaterialPath = "/opt/bmo/secrets/p9.1/backup/backup-encryption-material-v1";
const obsoleteMaterialPath = "/opt/bmo/config/p9.1/backup-passphrase";

function runBackupWithMaterial(
  materialPath: string,
  outputDirectory: string,
  includeVariable = true,
  includePostgresVariable = true,
) {
  const postgresPasswordDirectory = existsSync(outputDirectory) ? outputDirectory : dirname(outputDirectory);
  const postgresPasswordPath = resolve(postgresPasswordDirectory, "postgres-password");
  writeFileSync(postgresPasswordPath, "synthetic-password", { mode: 0o600 });
  chmodSync(postgresPasswordPath, 0o600);
  const environment: NodeJS.ProcessEnv = { ...process.env, P9_BACKUP_DIR: outputDirectory };
  if (includeVariable) environment.P9_BACKUP_PASSPHRASE_FILE = materialPath;
  else delete environment.P9_BACKUP_PASSPHRASE_FILE;
  if (includePostgresVariable) environment.P9_POSTGRES_PASSWORD_FILE = postgresPasswordPath;
  else delete environment.P9_POSTGRES_PASSWORD_FILE;
  return spawnSync(resolve(backendRoot, "node_modules/.bin/tsx"), ["src/p9/operator/backup.ts"], {
    cwd: backendRoot,
    env: environment,
    encoding: "utf8",
    timeout: 10_000,
  });
}

describe("P9 backup encryption-material path contract", () => {
  it("uses the protected path variable and rejects unsafe material before dumping", () => {
    const backupSource = readFileSync(backupSourcePath, "utf8");
    const configSource = readFileSync(backupConfigSourcePath, "utf8");
    expect(configSource).toContain("P9_BACKUP_PASSPHRASE_FILE");
    expect(configSource).toContain("P9_POSTGRES_PASSWORD_FILE");
    expect(backupSource).toContain("validateComposeConfiguration");
    expect(backupSource).toContain("composeEnvironment(config.postgresPasswordFile)");
    expect(configSource).toContain("lstatSync(passphraseFile)");
    expect(configSource).toContain("readFileSync(passphraseFile, \"utf8\")");
    expect(configSource).toContain("BACKUP_MATERIAL_MINIMUM_LENGTH");
    expect(backupSource).toContain("loadBackupConfig");
    expect(configSource).not.toContain(obsoleteMaterialPath);
    expect(canonicalMaterialPath).toBe("/opt/bmo/secrets/p9.1/backup/backup-encryption-material-v1");
  });

  it("fails before output-directory creation when the material path is missing", () => {
    const outputDirectory = mkdtempSync(resolve(tmpdir(), "bmo-p9-backup-config-output-"));
    const missingMaterialPath = resolve(outputDirectory, "missing-material");
    const result = runBackupWithMaterial(missingMaterialPath, resolve(outputDirectory, "daily"));

    expect(result.status).not.toBe(0);
    expect(existsSync(resolve(outputDirectory, "daily"))).toBe(false);
    rmSync(outputDirectory, { recursive: true, force: true });
  });

  it("fails before output-directory creation when the material file is empty", () => {
    const fixtureDirectory = mkdtempSync(resolve(tmpdir(), "bmo-p9-backup-config-empty-"));
    const materialPath = resolve(fixtureDirectory, "material");
    const outputDirectory = resolve(fixtureDirectory, "daily");
    writeFileSync(materialPath, "", { mode: 0o600 });
    chmodSync(materialPath, 0o600);

    const result = runBackupWithMaterial(materialPath, outputDirectory);

    expect(result.status).not.toBe(0);
    expect(existsSync(outputDirectory)).toBe(false);
    rmSync(fixtureDirectory, { recursive: true, force: true });
  });

  it("fails closed when the encryption-material variable is absent", () => {
    const outputDirectory = mkdtempSync(resolve(tmpdir(), "bmo-p9-backup-config-missing-"));
    const result = runBackupWithMaterial("unused", resolve(outputDirectory, "daily"), false);

    expect(result.status).not.toBe(0);
    expect(existsSync(resolve(outputDirectory, "daily"))).toBe(false);
    rmSync(outputDirectory, { recursive: true, force: true });
  });

  it("fails before output-directory creation when the PostgreSQL password-file variable is absent", () => {
    const outputDirectory = mkdtempSync(resolve(tmpdir(), "bmo-p9-backup-config-missing-postgres-password-"));
    const missingMaterialPath = resolve(outputDirectory, "missing-material");
    const result = runBackupWithMaterial(missingMaterialPath, resolve(outputDirectory, "daily"), true, false);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("P9_POSTGRES_PASSWORD_FILE is required");
    expect(existsSync(resolve(outputDirectory, "daily"))).toBe(false);
    rmSync(outputDirectory, { recursive: true, force: true });
  });
});
