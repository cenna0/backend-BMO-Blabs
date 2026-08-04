import { readdir, readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const schemaPath = new URL("../../prisma/schema.prisma", import.meta.url);

describe("P9.1 Prisma schema", () => {
  it("contains only the eleven P9.1 foundation models", async () => {
    const schema = await readFile(schemaPath, "utf8");
    const models = [...schema.matchAll(/^model\s+(\w+)\s*\{/gm)].map((match) => match[1]);
    expect(models).toEqual([
      "User",
      "PasswordCredential",
      "AuthIdentity",
      "Invitation",
      "Session",
      "RefreshToken",
      "Device",
      "DevicePairing",
      "UserSettings",
      "DeviceSettings",
      "AuditEvent",
    ]);
    expect(schema).not.toMatch(/model\s+(Chat|Memory|Schedule|Spotify|WhatsApp)/);
  });

  it("declares secret-safe uniqueness and ownership constraints", async () => {
    const schema = await readFile(schemaPath, "utf8");
    expect(schema).toMatch(/email\s+String\s+@unique/);
    expect(schema).toMatch(/tokenHash\s+String\s+@unique/);
    expect(schema).toMatch(/hardwareId\s+String\s+@unique/);
    expect(schema).toMatch(/codeHash\s+String/);
    expect(schema).not.toMatch(/password\s+String/);
    expect(schema).not.toMatch(/refreshToken\s+String/);
    expect(schema).toMatch(/timezone\s+String\s+@default\("Asia\/Jakarta"\)/);
    expect(schema).toContain("PairingStatus");
  });

  it("declares the locked pairing lifecycle and device setting bounds in comments", async () => {
    const schema = await readFile(schemaPath, "utf8");
    expect(schema).toMatch(/ISSUED/);
    expect(schema).toMatch(/CLAIMED/);
    expect(schema).toMatch(/EXPIRED/);
    expect(schema).toMatch(/REVOKED/);
    expect(schema).toMatch(/INVALIDATED/);
    expect(schema).toMatch(/FAILED/);
    expect(schema).toMatch(/playbackVolume\s+Int/);
    expect(schema).toMatch(/speechSpeed\s+Float/);
    expect(schema).toMatch(/voiceProfileId\s+String/);
  });

  it("declares database-enforced identity, ownership, family, and setting invariants", async () => {
    const schema = await readFile(schemaPath, "utf8");
    const migrationDirectory = new URL("../../prisma/migrations/", import.meta.url);
    const migrationFiles = await readdir(migrationDirectory, { withFileTypes: true });
    const migrationSql = (await Promise.all(
      migrationFiles
        .filter((entry) => entry.isDirectory())
        .map((entry) => readFile(new URL(`${entry.name}/migration.sql`, migrationDirectory), "utf8")),
    )).join("\n");
    expect(schema).toContain("@@unique([familyId])");
    expect(schema).toContain("@@unique([id, userId])");
    expect(schema).toContain("@relation(fields: [sessionId, familyId], references: [id, familyId]");
    expect(schema).toContain("@relation(fields: [deviceId, userId], references: [id, userId]");
    expect(migrationSql).toContain("User_email_normalized_ck");
    expect(migrationSql).toContain("Invitation_email_normalized_ck");
    expect(migrationSql).toContain("RefreshToken_session_family_fkey");
    expect(migrationSql).toContain("DevicePairing_device_owner_fkey");
    expect(migrationSql).toContain("UserSettings_timezone_ck");
    expect(migrationSql).toContain("DeviceSettings_voice_bounds_ck");
  });
});
