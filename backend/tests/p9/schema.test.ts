import { readdir, readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import { P9_REQUIRED_MIGRATIONS } from "../../src/p9/migration-manifest.js";

const schemaPath = new URL("../../prisma/schema.prisma", import.meta.url);
const phase2MigrationName = "20260811190000_phase2_application_foundation";
const phase2MigrationPath = new URL(
  `../../prisma/migrations/${phase2MigrationName}/migration.sql`,
  import.meta.url,
);

function sqlTableDefinition(sql: string, tableName: string): string {
  const match = sql.match(new RegExp(`CREATE TABLE "${tableName}" \\(([\\s\\S]*?)\\n\\);`));
  expect(match, `missing SQL table ${tableName}`).not.toBeNull();
  return match?.[1] ?? "";
}

function prismaModelDefinition(schema: string, modelName: string): string {
  const match = schema.match(new RegExp(`model ${modelName} \\{([\\s\\S]*?)\\n\\}`));
  expect(match, `missing Prisma model ${modelName}`).not.toBeNull();
  return match?.[1] ?? "";
}

describe("P9 Prisma schema", () => {
  it("keeps the runtime readiness manifest identical to source migration directories", async () => {
    const migrationDirectory = new URL("../../prisma/migrations/", import.meta.url);
    const migrationDirectories = (await readdir(migrationDirectory, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    expect(P9_REQUIRED_MIGRATIONS).toEqual(migrationDirectories);
  });

  it("preserves P9.1 and declares the exact Phase 2 application foundation models", async () => {
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
      "PasswordRecovery",
      "PersonalizationSettings",
      "ChatSession",
      "ChatMessage",
      "ChatOperation",
      "ChatMessageFeedback",
      "MemoryRecord",
      "MemoryCandidate",
      "MemoryAction",
      "MemoryTopicForget",
      "MemorySummary",
      "Schedule",
      "ScheduleRun",
      "ProactiveDelivery",
      "DeliveryAttempt",
      "DeviceWifiConfiguration",
      "DeviceTelemetryCurrent",
      "DeviceLog",
      "IntegrationConnection",
      "OAuthState",
      "SpotifyCredential",
      "SpotifyAction",
      "WhatsAppNotificationRule",
      "WhatsAppSendRequest",
      "WhatsAppDelivery",
      "BugReport",
      "BugReportAttachment",
    ]);
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

  it("adds profile and recovery data without exposing plaintext verifiers", async () => {
    const schema = await readFile(schemaPath, "utf8");
    expect(schema).toMatch(/dateOfBirth\s+DateTime\?\s+@db\.Date/);
    expect(schema).toMatch(/username\s+String\?\s+@unique\s+@db\.VarChar\(30\)/);
    expect(schema).toMatch(/avatarKey\s+String\?\s+@unique/);
    expect(schema).toMatch(/model PasswordRecovery[\s\S]*tokenVerifier\s+String\s+@unique\s+@db\.Char\(64\)/);
    expect(schema).toMatch(/model PasswordRecovery[\s\S]*attemptCount\s+Int\s+@default\(0\)/);
    expect(schema).not.toMatch(/^\s*(?:password|accessToken|refreshToken)\s+String/m);
  });

  it("declares user-scoped chat cursors, idempotency, operations, and owner-safe device links", async () => {
    const schema = await readFile(schemaPath, "utf8");
    expect(schema).toMatch(/cursor\s+BigInt\s+@default\(autoincrement\(\)\)/);
    expect(schema).toContain("@@unique([sessionId, cursor])");
    expect(schema).toContain("@@unique([userId, idempotencyKey])");
    expect(schema).toMatch(/model ChatOperation[\s\S]*status\s+ChatOperationStatus/);
    expect(schema).toMatch(/model ChatMessageFeedback[\s\S]*@@unique\(\[userId, messageId\]\)/);
    expect(schema).toContain(
      '@relation("ChatSessionDevice", fields: [deviceId, userId], references: [id, userId], onDelete: Restrict)',
    );
    expect(schema).toContain(
      "delivery      ProactiveDelivery     @relation(fields: [deliveryId, userId], references: [id, userId], onDelete: Cascade)",
    );
  });

  it("declares memory, schedule, delivery, device, integration, and support durability boundaries", async () => {
    const schema = await readFile(schemaPath, "utf8");
    expect(schema).toMatch(/enum ScheduleStatus[\s\S]*ACTIVE[\s\S]*PAUSED[\s\S]*CANCELLED[\s\S]*COMPLETED/);
    expect(schema).toMatch(/enum DeliverySource[\s\S]*CHAT[\s\S]*SCHEDULE[\s\S]*WHATSAPP/);
    expect(schema).toMatch(/enum WifiSecurity[\s\S]*OPEN[\s\S]*WPA_PSK/);
    expect(schema).toMatch(/enum WifiConfigurationStatus[\s\S]*SUPERSEDED/);
    expect(schema).toMatch(/model MemorySummary[\s\S]*userId\s+String\s+@unique/);
    expect(schema).toMatch(/model Schedule[\s\S]*timezone\s+String\s+@default\("Asia\/Jakarta"\)/);
    expect(schema).toMatch(/model ScheduleRun[\s\S]*@@unique\(\[scheduleId, dueAt\]\)/);
    expect(schema).toMatch(/model DeviceTelemetryCurrent[\s\S]*deviceId\s+String\s+@unique/);
    expect(schema).toMatch(/model DeviceLog[\s\S]*@@index\(\[expiresAt\]\)/);
    expect(schema).toMatch(/model OAuthState[\s\S]*stateVerifier\s+String\s+@unique\s+@db\.Char\(64\)/);
    expect(schema).toMatch(/model SpotifyCredential[\s\S]*accessTokenCiphertext[\s\S]*refreshTokenCiphertext/);
    expect(schema).toMatch(/model PasswordRecovery[\s\S]*requestId\s+String\?\s+@db\.VarChar\(128\)/);
    expect(schema).toMatch(/model DeviceLog[\s\S]*metadata\s+String\?\s+@db\.VarChar\(2000\)/);
    expect(schema).toMatch(/model SpotifyAction[\s\S]*resultCode\s+String\?[\s\S]*resultMetadata\s+String\?/);
    expect(schema).toMatch(/model WhatsAppDelivery[\s\S]*metadata\s+String\?\s+@db\.VarChar\(2000\)/);
    expect(schema).toMatch(/model BugReport[\s\S]*context\s+String\?\s+@db\.VarChar\(4000\)/);
    expect(schema).not.toMatch(/requestMetadata\s+Json|providerResult\s+Json|model DeviceLog[\s\S]*metadata\s+Json/);
    expect(schema).not.toMatch(/providerSession/);
    expect(schema).toMatch(/model BugReportAttachment/);
  });

  it("ships one additive, non-destructive Phase 2 migration with critical checks", async () => {
    const migrationSql = await readFile(phase2MigrationPath, "utf8");
    expect(migrationSql).not.toMatch(/^\s*(?:DROP|TRUNCATE|DELETE)\b/im);
    expect(migrationSql).toMatch(/ALTER TABLE "User"[\s\S]*ADD COLUMN\s+"dateOfBirth" DATE/);
    expect(migrationSql).toContain("User_username_normalized_ck");
    expect(migrationSql).toContain("PasswordRecovery_attempt_bounds_ck");
    expect(migrationSql).toContain("ChatSession_device_owner_fkey");
    expect(migrationSql).toContain("DeliveryAttempt_delivery_owner_fkey");
    expect(migrationSql).toContain("DeviceWifiConfiguration_secret_shape_ck");
    expect(migrationSql).toContain("DeviceTelemetryCurrent_battery_ck");
    expect(migrationSql).toContain("DeviceSettings_delivery_version_ck");
  });

  it("keeps MemoryAction and DeviceLog migration column types identical to Prisma", async () => {
    const migrationSql = await readFile(phase2MigrationPath, "utf8");
    expect(sqlTableDefinition(migrationSql, "MemoryAction")).toContain('"metadata" JSONB');
    expect(sqlTableDefinition(migrationSql, "DeviceLog")).toContain('"metadata" VARCHAR(2000)');
  });

  it("enforces disjoint global and targeted WhatsApp notification-rule uniqueness", async () => {
    const [schema, migrationSql] = await Promise.all([
      readFile(schemaPath, "utf8"),
      readFile(phase2MigrationPath, "utf8"),
    ]);
    const model = prismaModelDefinition(schema, "WhatsAppNotificationRule");
    expect(model).not.toContain("@@unique([userId, connectionId, scope, opaqueTargetRef])");
    expect(model).toContain("partial unique indexes");
    expect(migrationSql).toContain('CONSTRAINT "WhatsAppNotificationRule_target_shape_ck"');
    expect(migrationSql).toMatch(/"scope" = 'ALL'\s+AND "opaqueTargetRef" IS NULL/);
    expect(migrationSql).toMatch(/"scope" IN \('CONTACT', 'GROUP'\)[\s\S]*"opaqueTargetRef" IS NOT NULL[\s\S]*length\(btrim\("opaqueTargetRef"\)\) > 0/);
    expect(migrationSql).toContain(
      'CREATE UNIQUE INDEX "WhatsAppNotificationRule_global_unique" ON "WhatsAppNotificationRule"("userId", "connectionId") WHERE "scope" = \'ALL\';',
    );
    expect(migrationSql).toContain(
      'CREATE UNIQUE INDEX "WhatsAppNotificationRule_target_unique" ON "WhatsAppNotificationRule"("userId", "connectionId", "scope", "opaqueTargetRef") WHERE "scope" IN (\'CONTACT\', \'GROUP\');',
    );
    expect(migrationSql).not.toContain("WhatsAppNotificationRule_userId_connectionId_scope_opaqueTa_key");
  });
});
