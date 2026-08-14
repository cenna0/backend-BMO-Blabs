import { readdir, readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import { P9_REQUIRED_MIGRATIONS } from "../../src/p9/migration-manifest.js";

const schemaPath = new URL("../../prisma/schema.prisma", import.meta.url);
const phase2MigrationName = "20260811190000_phase2_application_foundation";
const phase2MigrationPath = new URL(
  `../../prisma/migrations/${phase2MigrationName}/migration.sql`,
  import.meta.url,
);
const whatsappConversationMigrationPath = new URL(
  "../../prisma/migrations/20260814120000_whatsapp_conversations/migration.sql",
  import.meta.url,
);
const whatsappIdentityAliasMigrationPath = new URL(
  "../../prisma/migrations/20260814210000_whatsapp_identity_aliases/migration.sql",
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

const expectedPhase2TableColumnTypes: Record<string, readonly string[]> = {
  PasswordRecovery: ["id:UUID", "userId:UUID", "tokenVerifier:CHAR(64)", "expiresAt:TIMESTAMPTZ(3)", "usedAt:TIMESTAMPTZ(3)", "attemptCount:INTEGER", "maxAttempts:INTEGER", "lastAttemptAt:TIMESTAMPTZ(3)", "requestIpHash:CHAR(64)", "requestUserAgentHash:CHAR(64)", "requestId:VARCHAR(128)", "createdAt:TIMESTAMPTZ(3)", "updatedAt:TIMESTAMPTZ(3)"],
  PersonalizationSettings: ["id:UUID", "userId:UUID", "baseStyleTone:VARCHAR(32)", "warmth:VARCHAR(32)", "enthusiasm:VARCHAR(32)", "headerAndLists:VARCHAR(32)", "emoji:VARCHAR(32)", "fastAnswers:BOOLEAN", "customInstructions:VARCHAR(4000)", "createdAt:TIMESTAMPTZ(3)", "updatedAt:TIMESTAMPTZ(3)"],
  ChatSession: ["id:UUID", "userId:UUID", "deviceId:UUID", "temporary:BOOLEAN", "title:VARCHAR(200)", 'status:"ChatSessionStatus"', "lastMessageCursor:BIGINT", "lastMessageAt:TIMESTAMPTZ(3)", "expiresAt:TIMESTAMPTZ(3)", "deletedAt:TIMESTAMPTZ(3)", "createdAt:TIMESTAMPTZ(3)", "updatedAt:TIMESTAMPTZ(3)"],
  ChatMessage: ["id:UUID", "sessionId:UUID", "userId:UUID", "sourceDeviceId:UUID", 'role:"ChatMessageRole"', 'kind:"ChatMessageKind"', "content:TEXT", "metadata:JSONB", "cursor:BIGSERIAL", "idempotencyKey:VARCHAR(128)", "createdAt:TIMESTAMPTZ(3)", "deletedAt:TIMESTAMPTZ(3)"],
  ChatOperation: ["id:UUID", "userId:UUID", "userMessageId:UUID", "idempotencyKey:VARCHAR(128)", 'status:"ChatOperationStatus"', "errorCode:VARCHAR(64)", "startedAt:TIMESTAMPTZ(3)", "completedAt:TIMESTAMPTZ(3)", "updatedAt:TIMESTAMPTZ(3)"],
  ChatMessageFeedback: ["id:UUID", "userId:UUID", "messageId:UUID", 'rating:"ChatFeedbackRating"', "reason:VARCHAR(500)", "createdAt:TIMESTAMPTZ(3)", "updatedAt:TIMESTAMPTZ(3)"],
  MemoryRecord: ["id:UUID", "userId:UUID", "topic:VARCHAR(120)", "category:VARCHAR(64)", "normalizedContent:TEXT", "importance:INTEGER", "source:VARCHAR(64)", "expiresAt:TIMESTAMPTZ(3)", "deletedAt:TIMESTAMPTZ(3)", "createdAt:TIMESTAMPTZ(3)", "updatedAt:TIMESTAMPTZ(3)"],
  MemoryCandidate: ["id:UUID", "userId:UUID", "sourceMessageId:UUID", "proposedContent:TEXT", "topic:VARCHAR(120)", "policyMetadata:JSONB", 'status:"MemoryCandidateStatus"', "expiresAt:TIMESTAMPTZ(3)", "reviewedAt:TIMESTAMPTZ(3)", "createdAt:TIMESTAMPTZ(3)", "updatedAt:TIMESTAMPTZ(3)"],
  MemoryAction: ["id:UUID", "userId:UUID", 'actionType:"MemoryActionType"', "resourceType:VARCHAR(32)", "resourceId:UUID", "idempotencyKey:VARCHAR(128)", "metadata:JSONB", "createdAt:TIMESTAMPTZ(3)"],
  MemoryTopicForget: ["id:UUID", "userId:UUID", "normalizedTopic:VARCHAR(120)", "idempotencyKey:VARCHAR(128)", "createdAt:TIMESTAMPTZ(3)"],
  MemorySummary: ["id:UUID", "userId:UUID", "content:TEXT", 'status:"MemorySummaryStatus"', "version:INTEGER", "feedback:VARCHAR(500)", "generatedAt:TIMESTAMPTZ(3)", "expiresAt:TIMESTAMPTZ(3)", "deletedAt:TIMESTAMPTZ(3)", "createdAt:TIMESTAMPTZ(3)", "updatedAt:TIMESTAMPTZ(3)"],
  Schedule: ["id:UUID", "userId:UUID", "targetDeviceId:UUID", 'status:"ScheduleStatus"', "timezone:VARCHAR(64)", "recurrence:JSONB", "payload:JSONB", "nextRunAt:TIMESTAMPTZ(3)", "version:INTEGER", "cancelledAt:TIMESTAMPTZ(3)", "completedAt:TIMESTAMPTZ(3)", "createdAt:TIMESTAMPTZ(3)", "updatedAt:TIMESTAMPTZ(3)"],
  ScheduleRun: ["id:UUID", "scheduleId:UUID", "dueAt:TIMESTAMPTZ(3)", 'status:"ScheduleRunStatus"', "leaseOwner:VARCHAR(128)", "leaseExpiresAt:TIMESTAMPTZ(3)", "attemptCount:INTEGER", "retryAt:TIMESTAMPTZ(3)", "missedAt:TIMESTAMPTZ(3)", "result:JSONB", "errorCode:VARCHAR(64)", "startedAt:TIMESTAMPTZ(3)", "completedAt:TIMESTAMPTZ(3)", "createdAt:TIMESTAMPTZ(3)", "updatedAt:TIMESTAMPTZ(3)"],
  ProactiveDelivery: ["id:UUID", "userId:UUID", "deviceId:UUID", 'source:"DeliverySource"', "sourceResourceType:VARCHAR(32)", "sourceResourceId:UUID", "idempotencyKey:VARCHAR(128)", 'status:"ProactiveDeliveryStatus"', "audioKey:VARCHAR(255)", "audioExpiresAt:TIMESTAMPTZ(3)", "attemptCount:INTEGER", "errorCode:VARCHAR(64)", "expiresAt:TIMESTAMPTZ(3)", "deliveredAt:TIMESTAMPTZ(3)", "createdAt:TIMESTAMPTZ(3)", "updatedAt:TIMESTAMPTZ(3)"],
  DeliveryAttempt: ["id:UUID", "deliveryId:UUID", "userId:UUID", "deviceId:UUID", "attemptNumber:INTEGER", 'status:"DeliveryAttemptStatus"', "channel:VARCHAR(32)", "receiptId:VARCHAR(128)", "errorCode:VARCHAR(64)", "errorDetail:VARCHAR(500)", "sentAt:TIMESTAMPTZ(3)", "receivedAt:TIMESTAMPTZ(3)", "playedAt:TIMESTAMPTZ(3)", "createdAt:TIMESTAMPTZ(3)", "updatedAt:TIMESTAMPTZ(3)"],
  DeviceWifiConfiguration: ["id:UUID", "deviceId:UUID", "version:INTEGER", "ssid:VARCHAR(32)", 'security:"WifiSecurity"', "secretCiphertext:TEXT", "secretNonce:VARCHAR(128)", "secretTag:VARCHAR(128)", "secretKeyVersion:INTEGER", 'status:"WifiConfigurationStatus"', "deliveredAt:TIMESTAMPTZ(3)", "applyingAt:TIMESTAMPTZ(3)", "connectedAt:TIMESTAMPTZ(3)", "failedAt:TIMESTAMPTZ(3)", "rolledBackAt:TIMESTAMPTZ(3)", "supersededAt:TIMESTAMPTZ(3)", "errorCode:VARCHAR(64)", "errorDetail:VARCHAR(500)", "createdAt:TIMESTAMPTZ(3)", "updatedAt:TIMESTAMPTZ(3)"],
  DeviceTelemetryCurrent: ["id:UUID", "deviceId:UUID", "wifiConnected:BOOLEAN", "wifiRssi:INTEGER", "batterySupported:BOOLEAN", "batteryPercent:INTEGER", "firmwareVersion:VARCHAR(64)", "observedAt:TIMESTAMPTZ(3)", "updatedAt:TIMESTAMPTZ(3)"],
  DeviceLog: ["id:UUID", "deviceId:UUID", 'level:"DeviceLogLevel"', "code:VARCHAR(64)", "message:VARCHAR(1000)", "metadata:VARCHAR(2000)", "observedAt:TIMESTAMPTZ(3)", "expiresAt:TIMESTAMPTZ(3)", "createdAt:TIMESTAMPTZ(3)"],
  IntegrationConnection: ["id:UUID", "userId:UUID", 'provider:"IntegrationProvider"', 'status:"IntegrationStatus"', "externalReference:VARCHAR(255)", "scopes:TEXT[]", "statusMetadata:VARCHAR(2000)", "connectedAt:TIMESTAMPTZ(3)", "disconnectedAt:TIMESTAMPTZ(3)", "createdAt:TIMESTAMPTZ(3)", "updatedAt:TIMESTAMPTZ(3)"],
  OAuthState: ["id:UUID", "userId:UUID", 'provider:"IntegrationProvider"', "stateVerifier:CHAR(64)", "redirectUri:VARCHAR(2048)", "requestId:VARCHAR(128)", "expiresAt:TIMESTAMPTZ(3)", "usedAt:TIMESTAMPTZ(3)", "createdAt:TIMESTAMPTZ(3)"],
  SpotifyCredential: ["id:UUID", "userId:UUID", "connectionId:UUID", 'provider:"IntegrationProvider"', "accessTokenCiphertext:TEXT", "accessTokenNonce:VARCHAR(128)", "accessTokenTag:VARCHAR(128)", "refreshTokenCiphertext:TEXT", "refreshTokenNonce:VARCHAR(128)", "refreshTokenTag:VARCHAR(128)", "keyVersion:INTEGER", "expiresAt:TIMESTAMPTZ(3)", "scopes:TEXT[]", "createdAt:TIMESTAMPTZ(3)", "updatedAt:TIMESTAMPTZ(3)"],
  SpotifyAction: ["id:UUID", "userId:UUID", "connectionId:UUID", 'provider:"IntegrationProvider"', "action:VARCHAR(64)", "payload:JSONB", "idempotencyKey:VARCHAR(128)", 'status:"SpotifyActionStatus"', "confirmationExpiresAt:TIMESTAMPTZ(3)", "confirmedAt:TIMESTAMPTZ(3)", "resultCode:VARCHAR(64)", "resultMetadata:VARCHAR(2000)", "errorCode:VARCHAR(64)", "createdAt:TIMESTAMPTZ(3)", "updatedAt:TIMESTAMPTZ(3)"],
  WhatsAppNotificationRule: ["id:UUID", "userId:UUID", "connectionId:UUID", 'provider:"IntegrationProvider"', 'scope:"WhatsAppRuleScope"', "opaqueTargetRef:VARCHAR(255)", "enabled:BOOLEAN", "speakOnDevice:BOOLEAN", "ruleMetadata:VARCHAR(2000)", "createdAt:TIMESTAMPTZ(3)", "updatedAt:TIMESTAMPTZ(3)"],
  WhatsAppSendRequest: ["id:UUID", "userId:UUID", "connectionId:UUID", 'provider:"IntegrationProvider"', "opaqueRecipientRef:VARCHAR(255)", "preview:VARCHAR(1000)", "idempotencyKey:VARCHAR(128)", 'status:"WhatsAppSendStatus"', "confirmationExpiresAt:TIMESTAMPTZ(3)", "confirmedAt:TIMESTAMPTZ(3)", "errorCode:VARCHAR(64)", "expiresAt:TIMESTAMPTZ(3)", "createdAt:TIMESTAMPTZ(3)", "updatedAt:TIMESTAMPTZ(3)"],
  WhatsAppDelivery: ["id:UUID", "userId:UUID", "connectionId:UUID", 'provider:"IntegrationProvider"', "sendRequestId:UUID", 'direction:"WhatsAppDeliveryDirection"', 'status:"WhatsAppDeliveryStatus"', "providerMessageRef:VARCHAR(255)", "metadata:VARCHAR(2000)", "errorCode:VARCHAR(64)", "deliveredAt:TIMESTAMPTZ(3)", "expiresAt:TIMESTAMPTZ(3)", "createdAt:TIMESTAMPTZ(3)", "updatedAt:TIMESTAMPTZ(3)"],
  BugReport: ["id:UUID", "userId:UUID", "category:VARCHAR(64)", "description:VARCHAR(4000)", "context:VARCHAR(4000)", 'status:"BugReportStatus"', "createdAt:TIMESTAMPTZ(3)", "updatedAt:TIMESTAMPTZ(3)", "resolvedAt:TIMESTAMPTZ(3)"],
  BugReportAttachment: ["id:UUID", "bugReportId:UUID", "storageKey:VARCHAR(255)", "contentType:VARCHAR(100)", "byteSize:INTEGER", "sha256:CHAR(64)", "expiresAt:TIMESTAMPTZ(3)", "createdAt:TIMESTAMPTZ(3)"],
};

function sqlColumnTypes(tableDefinition: string): string[] {
  return tableDefinition.split("\n").flatMap((line) => {
    const match = line.match(/^\s+"([^"]+)"\s+((?:"[^"]+")|[A-Z]+(?:\(\d+\))?(?:\[\])?)/);
    return match ? [`${match[1]}:${match[2]}`] : [];
  });
}

const destructiveSqlPatterns = [
  /\bDROP\s+(?:COLUMN|CONSTRAINT|INDEX|SCHEMA|TABLE|TYPE)\b/i,
  /\bTRUNCATE(?:\s+TABLE)?\b/i,
  /\bDELETE\s+FROM\b/i,
  /\bUPDATE\s+(?:ONLY\s+)?(?:"[^"]+"(?:\."[^"]+")?|[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)?)\s+(?:AS\s+\w+\s+)?SET\b/i,
  /\bALTER\s+(?:INDEX|TABLE|TYPE)\b[^;]*\bRENAME\b/i,
];

const expectedMappedForeignKeys = [
  ["Session", "clientDevice", "Session_client_device_owner_fkey"],
  ["RefreshToken", "session", "RefreshToken_session_family_fkey"],
  ["DevicePairing", "device", "DevicePairing_device_owner_fkey"],
  ["ChatSession", "device", "ChatSession_device_owner_fkey"],
  ["ChatMessage", "sourceDevice", "ChatMessage_source_device_owner_fkey"],
  ["Schedule", "targetDevice", "Schedule_target_device_owner_fkey"],
  ["ProactiveDelivery", "device", "ProactiveDelivery_device_owner_fkey"],
  ["DeliveryAttempt", "delivery", "DeliveryAttempt_delivery_owner_fkey"],
  ["DeliveryAttempt", "device", "DeliveryAttempt_device_owner_fkey"],
  ["SpotifyCredential", "connection", "SpotifyCredential_connection_owner_provider_fkey"],
  ["SpotifyAction", "connection", "SpotifyAction_connection_owner_provider_fkey"],
  [
    "WhatsAppNotificationRule",
    "connection",
    "WhatsAppNotificationRule_connection_owner_provider_fkey",
  ],
  ["WhatsAppSendRequest", "connection", "WhatsAppSendRequest_connection_owner_provider_fkey"],
  ["WhatsAppDelivery", "connection", "WhatsAppDelivery_connection_owner_provider_fkey"],
  ["WhatsAppConversationAlias", "connection", "WhatsAppConversationAlias_connection_owner_provider_fkey"],
  ["WhatsAppConversationAlias", "conversation", "WhatsAppConversationAlias_conversation_owner_provider_fkey"],
] as const;

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
      "WhatsAppConversation",
      "WhatsAppConversationAlias",
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

  it("maps deployed custom foreign-key names for stable Prisma introspection", async () => {
    const schema = await readFile(schemaPath, "utf8");
    const migrationDirectory = new URL("../../prisma/migrations/", import.meta.url);
    const migrationEntries = await readdir(migrationDirectory, { withFileTypes: true });
    const migrationSql = (
      await Promise.all(
        migrationEntries
          .filter((entry) => entry.isDirectory())
          .map((entry) => readFile(new URL(`${entry.name}/migration.sql`, migrationDirectory), "utf8")),
      )
    ).join("\n");

    for (const [modelName, relationField, constraintName] of expectedMappedForeignKeys) {
      const relationLine = prismaModelDefinition(schema, modelName)
        .split("\n")
        .find((line) => new RegExp(`^\\s*${relationField}\\s`).test(line));
      expect(relationLine, `${modelName}.${relationField}`).toContain(`map: "${constraintName}"`);
      expect(migrationSql, constraintName).toContain(`CONSTRAINT "${constraintName}"`);
    }
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
      '@relation("ChatSessionDevice", fields: [deviceId, userId], references: [id, userId], onDelete: Restrict, map: "ChatSession_device_owner_fkey")',
    );
    expect(schema).toContain(
      'delivery      ProactiveDelivery     @relation(fields: [deliveryId, userId], references: [id, userId], onDelete: Cascade, map: "DeliveryAttempt_delivery_owner_fkey")',
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
    for (const destructivePattern of destructiveSqlPatterns) {
      expect(migrationSql).not.toMatch(destructivePattern);
    }
    expect(migrationSql).toMatch(/ALTER TABLE "User"[\s\S]*ADD COLUMN\s+"dateOfBirth" DATE/);
    expect(migrationSql).toContain("User_username_normalized_ck");
    expect(migrationSql).toContain("PasswordRecovery_attempt_bounds_ck");
    expect(migrationSql).toContain("ChatSession_device_owner_fkey");
    expect(migrationSql).toContain("DeliveryAttempt_delivery_owner_fkey");
    expect(migrationSql).toContain("DeviceWifiConfiguration_secret_shape_ck");
    expect(migrationSql).toContain("DeviceTelemetryCurrent_battery_ck");
    expect(migrationSql).toContain("DeviceSettings_delivery_version_ck");
  });

  it("detects embedded destructive DDL and migration-time data rewrites", () => {
    const destructiveFixtures = [
      'ALTER TABLE "User" ADD COLUMN "nickname" TEXT, DROP COLUMN "email";',
      'UPDATE "User" SET "username" = lower("username");',
      'WITH candidates AS (SELECT 1) UPDATE public.users AS u SET active = false;',
      'ALTER TABLE "User" RENAME COLUMN "email" TO "emailAddress";',
      'ALTER INDEX "User_email_key" RENAME TO "User_emailAddress_key";',
      'TRUNCATE TABLE "ChatMessage";',
      'DELETE FROM "DeviceLog";',
    ];
    for (const fixture of destructiveFixtures) {
      expect(destructiveSqlPatterns.some((pattern) => pattern.test(fixture)), fixture).toBe(true);
    }
    expect(
      destructiveSqlPatterns.some((pattern) =>
        pattern.test('FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE'),
      ),
    ).toBe(false);
  });

  it("keeps explicit SQL scalar type parity for every Phase 2 table", async () => {
    const migrationSql = await readFile(phase2MigrationPath, "utf8");
    const actualTables = [...migrationSql.matchAll(/^CREATE TABLE "([^"]+)"/gm)].map((match) => match[1]);
    expect(actualTables.sort()).toEqual(Object.keys(expectedPhase2TableColumnTypes).sort());

    for (const [tableName, expectedColumnTypes] of Object.entries(expectedPhase2TableColumnTypes)) {
      expect(sqlColumnTypes(sqlTableDefinition(migrationSql, tableName)), tableName).toEqual(expectedColumnTypes);
    }
  });

  it("declares the additive WhatsApp conversation migration and relations", async () => {
    const [schema, migrationSql] = await Promise.all([
      readFile(schemaPath, "utf8"),
      readFile(whatsappConversationMigrationPath, "utf8"),
    ]);
    expect(schema).toContain("enum WhatsAppConversationType");
    expect(sqlColumnTypes(sqlTableDefinition(migrationSql, "WhatsAppConversation"))).toEqual([
      "id:UUID", "userId:UUID", "connectionId:UUID", 'provider:"IntegrationProvider"',
      "opaqueChatRef:VARCHAR(255)", "displayName:VARCHAR(120)", 'type:"WhatsAppConversationType"',
      "lastActivityAt:TIMESTAMPTZ(3)", "createdAt:TIMESTAMPTZ(3)", "updatedAt:TIMESTAMPTZ(3)",
    ]);
    expect(migrationSql).toContain('ALTER TABLE "WhatsAppSendRequest" ADD COLUMN "conversationId" UUID;');
    expect(migrationSql).toContain('ALTER TABLE "WhatsAppDelivery" ADD COLUMN "conversationId" UUID;');
    expect(migrationSql).toContain('CONSTRAINT "WhatsAppConversation_connection_owner_provider_fkey"');
    expect(migrationSql).toContain('CONSTRAINT "WhatsAppSendRequest_conversation_owner_provider_fkey"');
    expect(migrationSql).toContain('CONSTRAINT "WhatsAppDelivery_conversation_owner_provider_fkey"');
  });

  it("declares additive provider identity aliases without exposing them to Mobile", async () => {
    const [schema, migrationSql] = await Promise.all([
      readFile(schemaPath, "utf8"),
      readFile(whatsappIdentityAliasMigrationPath, "utf8"),
    ]);
    expect(sqlColumnTypes(sqlTableDefinition(migrationSql, "WhatsAppConversationAlias"))).toEqual([
      "id:UUID", "userId:UUID", "connectionId:UUID", 'provider:"IntegrationProvider"',
      "conversationId:UUID", "providerRef:VARCHAR(255)",
      "createdAt:TIMESTAMPTZ(3)", "updatedAt:TIMESTAMPTZ(3)",
    ]);
    expect(schema).toMatch(/model WhatsAppConversationAlias[\s\S]*providerRef\s+String\s+@db\.VarChar\(255\)/);
    expect(schema).toMatch(/model WhatsAppConversationAlias[\s\S]*@@unique\(\[userId, connectionId, provider, providerRef\]\)/);
    expect(migrationSql).not.toMatch(/DROP\s|DELETE\s+FROM|UPDATE\s+"/i);
    expect(migrationSql).toContain('CONSTRAINT "WhatsAppConversationAlias_conversation_owner_provider_fkey"');
  });

  it("closes nullable CHECK gaps and requires bounded device-log expiry", async () => {
    const [schema, migrationSql] = await Promise.all([
      readFile(schemaPath, "utf8"),
      readFile(phase2MigrationPath, "utf8"),
    ]);
    expect(prismaModelDefinition(schema, "DeviceLog")).toMatch(
      /expiresAt\s+DateTime\s+@db\.Timestamptz\(3\)/,
    );
    const deviceLogTable = sqlTableDefinition(migrationSql, "DeviceLog");
    expect(deviceLogTable).toContain('"expiresAt" TIMESTAMPTZ(3) NOT NULL');
    expect(deviceLogTable).not.toMatch(/"expiresAt"[^\n]*DEFAULT/);
    expect(migrationSql).toContain('CONSTRAINT "DeviceLog_expiry_ck"');
    expect(migrationSql).toContain('CHECK ("expiresAt" > "createdAt")');

    expect(migrationSql).toMatch(/"avatarByteSize" IS NOT NULL\s+AND "avatarByteSize" > 0/);
    expect(migrationSql).toContain('length(btrim("avatarKey")) > 0');
    expect(migrationSql).toContain('length(btrim("avatarContentType")) > 0');
    expect(migrationSql).toContain('"secretKeyVersion" IS NOT NULL');
    expect(migrationSql).toContain('length(btrim("secretCiphertext")) > 0');
    expect(migrationSql).toContain('length(btrim("secretNonce")) > 0');
    expect(migrationSql).toContain('length(btrim("secretTag")) > 0');
    expect(migrationSql).toMatch(
      /"batterySupported" = true\s+AND "batteryPercent" IS NOT NULL\s+AND "batteryPercent" BETWEEN 0 AND 100/,
    );
    expect(migrationSql).toContain('length(btrim("refreshTokenCiphertext")) > 0');
    expect(migrationSql).toContain('length(btrim("refreshTokenNonce")) > 0');
    expect(migrationSql).toContain('length(btrim("refreshTokenTag")) > 0');
  });

  it("binds provider-specific records to matching integration connections", async () => {
    const [schema, migrationSql] = await Promise.all([
      readFile(schemaPath, "utf8"),
      readFile(phase2MigrationPath, "utf8"),
    ]);
    const providerModels = [
      ["SpotifyCredential", "SPOTIFY"],
      ["SpotifyAction", "SPOTIFY"],
      ["WhatsAppNotificationRule", "WHATSAPP"],
      ["WhatsAppSendRequest", "WHATSAPP"],
      ["WhatsAppDelivery", "WHATSAPP"],
    ] as const;
    for (const [modelName, provider] of providerModels) {
      const model = prismaModelDefinition(schema, modelName);
      expect(model).toMatch(new RegExp(`provider\\s+IntegrationProvider\\s+@default\\(${provider}\\)`));
      expect(model).toContain(
        `@relation(fields: [connectionId, userId, provider], references: [id, userId, provider], onDelete: Cascade, map: "${modelName}_connection_owner_provider_fkey")`,
      );
      expect(sqlTableDefinition(migrationSql, modelName)).toContain(
        `"provider" "IntegrationProvider" NOT NULL DEFAULT '${provider}'`,
      );
      expect(migrationSql).toContain(`CONSTRAINT "${modelName}_provider_ck"`);
      expect(migrationSql).toContain(`CHECK ("provider" = '${provider}')`);
      expect(migrationSql).toContain(
        `CONSTRAINT "${modelName}_connection_owner_provider_fkey" FOREIGN KEY ("connectionId", "userId", "provider") REFERENCES "IntegrationConnection"("id", "userId", "provider")`,
      );
      expect(migrationSql).not.toContain(`CONSTRAINT "${modelName}_connectionId_userId_fkey"`);
    }
    expect(prismaModelDefinition(schema, "IntegrationConnection")).toContain(
      "@@unique([id, userId, provider])",
    );
    expect(migrationSql).toContain(
      'CREATE UNIQUE INDEX "IntegrationConnection_id_userId_provider_key" ON "IntegrationConnection"("id", "userId", "provider");',
    );
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
