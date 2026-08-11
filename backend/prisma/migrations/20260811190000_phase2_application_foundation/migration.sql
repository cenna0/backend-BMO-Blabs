-- CreateEnum
CREATE TYPE "ChatSessionStatus" AS ENUM ('ACTIVE', 'ARCHIVED', 'DELETED');

-- CreateEnum
CREATE TYPE "ChatMessageRole" AS ENUM ('USER', 'ASSISTANT', 'SYSTEM');

-- CreateEnum
CREATE TYPE "ChatMessageKind" AS ENUM ('TEXT', 'EVENT');

-- CreateEnum
CREATE TYPE "ChatOperationStatus" AS ENUM ('PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ChatFeedbackRating" AS ENUM ('POSITIVE', 'NEGATIVE');

-- CreateEnum
CREATE TYPE "MemoryCandidateStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "MemoryActionType" AS ENUM ('ACCEPT', 'REJECT', 'EDIT', 'DELETE', 'FORGET_TOPIC', 'CLEAR_ALL', 'EXPORT', 'SUMMARY_REGENERATE', 'SUMMARY_FEEDBACK');

-- CreateEnum
CREATE TYPE "MemorySummaryStatus" AS ENUM ('READY', 'GENERATING', 'FAILED');

-- CreateEnum
CREATE TYPE "ScheduleStatus" AS ENUM ('ACTIVE', 'PAUSED', 'CANCELLED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "ScheduleRunStatus" AS ENUM ('DUE', 'CLAIMED', 'SUCCEEDED', 'FAILED', 'MISSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DeliverySource" AS ENUM ('CHAT', 'SCHEDULE', 'WHATSAPP');

-- CreateEnum
CREATE TYPE "ProactiveDeliveryStatus" AS ENUM ('PENDING', 'READY', 'DELIVERING', 'DELIVERED', 'FAILED', 'EXPIRED', 'MISSED');

-- CreateEnum
CREATE TYPE "DeliveryAttemptStatus" AS ENUM ('PENDING', 'SENT', 'RECEIVED', 'PLAYED', 'FAILED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "WifiSecurity" AS ENUM ('OPEN', 'WPA_PSK');

-- CreateEnum
CREATE TYPE "WifiConfigurationStatus" AS ENUM ('PENDING', 'DELIVERED', 'APPLYING', 'CONNECTED', 'FAILED', 'ROLLED_BACK', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "DeviceLogLevel" AS ENUM ('DEBUG', 'INFO', 'WARN', 'ERROR');

-- CreateEnum
CREATE TYPE "IntegrationProvider" AS ENUM ('SPOTIFY', 'WHATSAPP');

-- CreateEnum
CREATE TYPE "IntegrationStatus" AS ENUM ('DISCONNECTED', 'PENDING', 'CONNECTED', 'ERROR');

-- CreateEnum
CREATE TYPE "SpotifyActionStatus" AS ENUM ('PENDING_CONFIRMATION', 'CONFIRMED', 'SUCCEEDED', 'FAILED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "WhatsAppRuleScope" AS ENUM ('ALL', 'CONTACT', 'GROUP');

-- CreateEnum
CREATE TYPE "WhatsAppSendStatus" AS ENUM ('PENDING_CONFIRMATION', 'CONFIRMED', 'SENDING', 'SUCCEEDED', 'FAILED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "WhatsAppDeliveryDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "WhatsAppDeliveryStatus" AS ENUM ('RECEIVED', 'QUEUED', 'DELIVERED', 'FAILED');

-- CreateEnum
CREATE TYPE "BugReportStatus" AS ENUM ('RECEIVED', 'TRIAGED', 'RESOLVED', 'CLOSED');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "avatarByteSize" INTEGER,
ADD COLUMN     "avatarContentType" VARCHAR(100),
ADD COLUMN     "avatarKey" VARCHAR(255),
ADD COLUMN     "dateOfBirth" DATE,
ADD COLUMN     "username" VARCHAR(30);

-- AlterTable
ALTER TABLE "DeviceSettings" ADD COLUMN     "appliedAt" TIMESTAMPTZ(3),
ADD COLUMN     "appliedVersion" INTEGER,
ADD COLUMN     "deliveredAt" TIMESTAMPTZ(3),
ADD COLUMN     "lastErrorCode" VARCHAR(64),
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "PasswordRecovery" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenVerifier" CHAR(64) NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "usedAt" TIMESTAMPTZ(3),
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL,
    "lastAttemptAt" TIMESTAMPTZ(3),
    "requestIpHash" CHAR(64),
    "requestUserAgentHash" CHAR(64),
    "requestId" VARCHAR(128),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PasswordRecovery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PersonalizationSettings" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "baseStyleTone" VARCHAR(32) NOT NULL DEFAULT 'default',
    "warmth" VARCHAR(32) NOT NULL DEFAULT 'default',
    "enthusiasm" VARCHAR(32) NOT NULL DEFAULT 'default',
    "headerAndLists" VARCHAR(32) NOT NULL DEFAULT 'default',
    "emoji" VARCHAR(32) NOT NULL DEFAULT 'default',
    "fastAnswers" BOOLEAN NOT NULL DEFAULT false,
    "customInstructions" VARCHAR(4000) NOT NULL DEFAULT '',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PersonalizationSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatSession" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "deviceId" UUID,
    "temporary" BOOLEAN NOT NULL DEFAULT false,
    "title" VARCHAR(200),
    "status" "ChatSessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastMessageCursor" BIGINT,
    "lastMessageAt" TIMESTAMPTZ(3),
    "expiresAt" TIMESTAMPTZ(3),
    "deletedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ChatSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatMessage" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "sourceDeviceId" UUID,
    "role" "ChatMessageRole" NOT NULL,
    "kind" "ChatMessageKind" NOT NULL DEFAULT 'TEXT',
    "content" TEXT NOT NULL,
    "metadata" JSONB,
    "cursor" BIGSERIAL NOT NULL,
    "idempotencyKey" VARCHAR(128),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatOperation" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "userMessageId" UUID NOT NULL,
    "idempotencyKey" VARCHAR(128) NOT NULL,
    "status" "ChatOperationStatus" NOT NULL DEFAULT 'PROCESSING',
    "errorCode" VARCHAR(64),
    "startedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMPTZ(3),
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ChatOperation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatMessageFeedback" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "messageId" UUID NOT NULL,
    "rating" "ChatFeedbackRating" NOT NULL,
    "reason" VARCHAR(500),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ChatMessageFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemoryRecord" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "topic" VARCHAR(120) NOT NULL,
    "category" VARCHAR(64) NOT NULL,
    "normalizedContent" TEXT NOT NULL,
    "importance" INTEGER NOT NULL,
    "source" VARCHAR(64) NOT NULL,
    "expiresAt" TIMESTAMPTZ(3),
    "deletedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "MemoryRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemoryCandidate" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "sourceMessageId" UUID,
    "proposedContent" TEXT NOT NULL,
    "topic" VARCHAR(120),
    "policyMetadata" JSONB,
    "status" "MemoryCandidateStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMPTZ(3),
    "reviewedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "MemoryCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemoryAction" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "actionType" "MemoryActionType" NOT NULL,
    "resourceType" VARCHAR(32) NOT NULL,
    "resourceId" UUID,
    "idempotencyKey" VARCHAR(128) NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MemoryAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemoryTopicForget" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "normalizedTopic" VARCHAR(120) NOT NULL,
    "idempotencyKey" VARCHAR(128) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MemoryTopicForget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemorySummary" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "content" TEXT,
    "status" "MemorySummaryStatus" NOT NULL DEFAULT 'GENERATING',
    "version" INTEGER NOT NULL DEFAULT 1,
    "feedback" VARCHAR(500),
    "generatedAt" TIMESTAMPTZ(3),
    "expiresAt" TIMESTAMPTZ(3),
    "deletedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "MemorySummary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Schedule" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "targetDeviceId" UUID,
    "status" "ScheduleStatus" NOT NULL DEFAULT 'ACTIVE',
    "timezone" VARCHAR(64) NOT NULL DEFAULT 'Asia/Jakarta',
    "recurrence" JSONB,
    "payload" JSONB NOT NULL,
    "nextRunAt" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "cancelledAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Schedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduleRun" (
    "id" UUID NOT NULL,
    "scheduleId" UUID NOT NULL,
    "dueAt" TIMESTAMPTZ(3) NOT NULL,
    "status" "ScheduleRunStatus" NOT NULL DEFAULT 'DUE',
    "leaseOwner" VARCHAR(128),
    "leaseExpiresAt" TIMESTAMPTZ(3),
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "retryAt" TIMESTAMPTZ(3),
    "missedAt" TIMESTAMPTZ(3),
    "result" JSONB,
    "errorCode" VARCHAR(64),
    "startedAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ScheduleRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProactiveDelivery" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "deviceId" UUID,
    "source" "DeliverySource" NOT NULL,
    "sourceResourceType" VARCHAR(32) NOT NULL,
    "sourceResourceId" UUID NOT NULL,
    "idempotencyKey" VARCHAR(128) NOT NULL,
    "status" "ProactiveDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "audioKey" VARCHAR(255),
    "audioExpiresAt" TIMESTAMPTZ(3),
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "errorCode" VARCHAR(64),
    "expiresAt" TIMESTAMPTZ(3),
    "deliveredAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ProactiveDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryAttempt" (
    "id" UUID NOT NULL,
    "deliveryId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "deviceId" UUID,
    "attemptNumber" INTEGER NOT NULL,
    "status" "DeliveryAttemptStatus" NOT NULL DEFAULT 'PENDING',
    "channel" VARCHAR(32) NOT NULL,
    "receiptId" VARCHAR(128),
    "errorCode" VARCHAR(64),
    "errorDetail" VARCHAR(500),
    "sentAt" TIMESTAMPTZ(3),
    "receivedAt" TIMESTAMPTZ(3),
    "playedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "DeliveryAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeviceWifiConfiguration" (
    "id" UUID NOT NULL,
    "deviceId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "ssid" VARCHAR(32) NOT NULL,
    "security" "WifiSecurity" NOT NULL,
    "secretCiphertext" TEXT,
    "secretNonce" VARCHAR(128),
    "secretTag" VARCHAR(128),
    "secretKeyVersion" INTEGER,
    "status" "WifiConfigurationStatus" NOT NULL DEFAULT 'PENDING',
    "deliveredAt" TIMESTAMPTZ(3),
    "applyingAt" TIMESTAMPTZ(3),
    "connectedAt" TIMESTAMPTZ(3),
    "failedAt" TIMESTAMPTZ(3),
    "rolledBackAt" TIMESTAMPTZ(3),
    "supersededAt" TIMESTAMPTZ(3),
    "errorCode" VARCHAR(64),
    "errorDetail" VARCHAR(500),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "DeviceWifiConfiguration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeviceTelemetryCurrent" (
    "id" UUID NOT NULL,
    "deviceId" UUID NOT NULL,
    "wifiConnected" BOOLEAN NOT NULL DEFAULT false,
    "wifiRssi" INTEGER,
    "batterySupported" BOOLEAN NOT NULL DEFAULT false,
    "batteryPercent" INTEGER,
    "firmwareVersion" VARCHAR(64),
    "observedAt" TIMESTAMPTZ(3) NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "DeviceTelemetryCurrent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeviceLog" (
    "id" UUID NOT NULL,
    "deviceId" UUID NOT NULL,
    "level" "DeviceLogLevel" NOT NULL,
    "code" VARCHAR(64) NOT NULL,
    "message" VARCHAR(1000) NOT NULL,
    "metadata" VARCHAR(2000),
    "observedAt" TIMESTAMPTZ(3) NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeviceLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationConnection" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "provider" "IntegrationProvider" NOT NULL,
    "status" "IntegrationStatus" NOT NULL DEFAULT 'DISCONNECTED',
    "externalReference" VARCHAR(255),
    "scopes" TEXT[],
    "statusMetadata" VARCHAR(2000),
    "connectedAt" TIMESTAMPTZ(3),
    "disconnectedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "IntegrationConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OAuthState" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "provider" "IntegrationProvider" NOT NULL,
    "stateVerifier" CHAR(64) NOT NULL,
    "redirectUri" VARCHAR(2048) NOT NULL,
    "requestId" VARCHAR(128),
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "usedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OAuthState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpotifyCredential" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "connectionId" UUID NOT NULL,
    "provider" "IntegrationProvider" NOT NULL DEFAULT 'SPOTIFY',
    "accessTokenCiphertext" TEXT NOT NULL,
    "accessTokenNonce" VARCHAR(128) NOT NULL,
    "accessTokenTag" VARCHAR(128) NOT NULL,
    "refreshTokenCiphertext" TEXT,
    "refreshTokenNonce" VARCHAR(128),
    "refreshTokenTag" VARCHAR(128),
    "keyVersion" INTEGER NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "scopes" TEXT[],
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "SpotifyCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpotifyAction" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "connectionId" UUID NOT NULL,
    "provider" "IntegrationProvider" NOT NULL DEFAULT 'SPOTIFY',
    "action" VARCHAR(64) NOT NULL,
    "payload" JSONB NOT NULL,
    "idempotencyKey" VARCHAR(128) NOT NULL,
    "status" "SpotifyActionStatus" NOT NULL DEFAULT 'PENDING_CONFIRMATION',
    "confirmationExpiresAt" TIMESTAMPTZ(3),
    "confirmedAt" TIMESTAMPTZ(3),
    "resultCode" VARCHAR(64),
    "resultMetadata" VARCHAR(2000),
    "errorCode" VARCHAR(64),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "SpotifyAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppNotificationRule" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "connectionId" UUID NOT NULL,
    "provider" "IntegrationProvider" NOT NULL DEFAULT 'WHATSAPP',
    "scope" "WhatsAppRuleScope" NOT NULL,
    "opaqueTargetRef" VARCHAR(255),
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "speakOnDevice" BOOLEAN NOT NULL DEFAULT false,
    "ruleMetadata" VARCHAR(2000),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "WhatsAppNotificationRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppSendRequest" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "connectionId" UUID NOT NULL,
    "provider" "IntegrationProvider" NOT NULL DEFAULT 'WHATSAPP',
    "opaqueRecipientRef" VARCHAR(255) NOT NULL,
    "preview" VARCHAR(1000) NOT NULL,
    "idempotencyKey" VARCHAR(128) NOT NULL,
    "status" "WhatsAppSendStatus" NOT NULL DEFAULT 'PENDING_CONFIRMATION',
    "confirmationExpiresAt" TIMESTAMPTZ(3) NOT NULL,
    "confirmedAt" TIMESTAMPTZ(3),
    "errorCode" VARCHAR(64),
    "expiresAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "WhatsAppSendRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppDelivery" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "connectionId" UUID NOT NULL,
    "provider" "IntegrationProvider" NOT NULL DEFAULT 'WHATSAPP',
    "sendRequestId" UUID,
    "direction" "WhatsAppDeliveryDirection" NOT NULL,
    "status" "WhatsAppDeliveryStatus" NOT NULL,
    "providerMessageRef" VARCHAR(255),
    "metadata" VARCHAR(2000),
    "errorCode" VARCHAR(64),
    "deliveredAt" TIMESTAMPTZ(3),
    "expiresAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "WhatsAppDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BugReport" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "category" VARCHAR(64) NOT NULL,
    "description" VARCHAR(4000) NOT NULL,
    "context" VARCHAR(4000),
    "status" "BugReportStatus" NOT NULL DEFAULT 'RECEIVED',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "resolvedAt" TIMESTAMPTZ(3),

    CONSTRAINT "BugReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BugReportAttachment" (
    "id" UUID NOT NULL,
    "bugReportId" UUID NOT NULL,
    "storageKey" VARCHAR(255) NOT NULL,
    "contentType" VARCHAR(100) NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "expiresAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BugReportAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PasswordRecovery_tokenVerifier_key" ON "PasswordRecovery"("tokenVerifier");

-- CreateIndex
CREATE INDEX "PasswordRecovery_userId_expiresAt_usedAt_idx" ON "PasswordRecovery"("userId", "expiresAt", "usedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PersonalizationSettings_userId_key" ON "PersonalizationSettings"("userId");

-- CreateIndex
CREATE INDEX "ChatSession_userId_status_updatedAt_idx" ON "ChatSession"("userId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "ChatSession_userId_deviceId_idx" ON "ChatSession"("userId", "deviceId");

-- CreateIndex
CREATE UNIQUE INDEX "ChatSession_id_userId_key" ON "ChatSession"("id", "userId");

-- CreateIndex
CREATE INDEX "ChatMessage_userId_sessionId_cursor_idx" ON "ChatMessage"("userId", "sessionId", "cursor");

-- CreateIndex
CREATE INDEX "ChatMessage_userId_sourceDeviceId_idx" ON "ChatMessage"("userId", "sourceDeviceId");

-- CreateIndex
CREATE UNIQUE INDEX "ChatMessage_id_userId_key" ON "ChatMessage"("id", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "ChatMessage_sessionId_cursor_key" ON "ChatMessage"("sessionId", "cursor");

-- CreateIndex
CREATE UNIQUE INDEX "ChatMessage_userId_idempotencyKey_key" ON "ChatMessage"("userId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "ChatOperation_userId_status_startedAt_idx" ON "ChatOperation"("userId", "status", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ChatOperation_userMessageId_key" ON "ChatOperation"("userMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "ChatOperation_userId_idempotencyKey_key" ON "ChatOperation"("userId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "ChatMessageFeedback_userId_messageId_key" ON "ChatMessageFeedback"("userId", "messageId");

-- CreateIndex
CREATE INDEX "MemoryRecord_userId_deletedAt_updatedAt_idx" ON "MemoryRecord"("userId", "deletedAt", "updatedAt");

-- CreateIndex
CREATE INDEX "MemoryRecord_userId_topic_idx" ON "MemoryRecord"("userId", "topic");

-- CreateIndex
CREATE INDEX "MemoryRecord_expiresAt_idx" ON "MemoryRecord"("expiresAt");

-- CreateIndex
CREATE INDEX "MemoryCandidate_userId_status_createdAt_idx" ON "MemoryCandidate"("userId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "MemoryCandidate_expiresAt_idx" ON "MemoryCandidate"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "MemoryCandidate_id_userId_key" ON "MemoryCandidate"("id", "userId");

-- CreateIndex
CREATE INDEX "MemoryAction_userId_resourceType_resourceId_createdAt_idx" ON "MemoryAction"("userId", "resourceType", "resourceId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MemoryAction_userId_idempotencyKey_key" ON "MemoryAction"("userId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "MemoryTopicForget_userId_normalizedTopic_createdAt_idx" ON "MemoryTopicForget"("userId", "normalizedTopic", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MemoryTopicForget_userId_idempotencyKey_key" ON "MemoryTopicForget"("userId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "MemorySummary_userId_key" ON "MemorySummary"("userId");

-- CreateIndex
CREATE INDEX "Schedule_status_nextRunAt_idx" ON "Schedule"("status", "nextRunAt");

-- CreateIndex
CREATE INDEX "Schedule_userId_status_updatedAt_idx" ON "Schedule"("userId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "Schedule_userId_targetDeviceId_idx" ON "Schedule"("userId", "targetDeviceId");

-- CreateIndex
CREATE UNIQUE INDEX "Schedule_id_userId_key" ON "Schedule"("id", "userId");

-- CreateIndex
CREATE INDEX "ScheduleRun_status_dueAt_leaseExpiresAt_idx" ON "ScheduleRun"("status", "dueAt", "leaseExpiresAt");

-- CreateIndex
CREATE INDEX "ScheduleRun_retryAt_idx" ON "ScheduleRun"("retryAt");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduleRun_scheduleId_dueAt_key" ON "ScheduleRun"("scheduleId", "dueAt");

-- CreateIndex
CREATE INDEX "ProactiveDelivery_status_createdAt_idx" ON "ProactiveDelivery"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ProactiveDelivery_userId_source_sourceResourceId_idx" ON "ProactiveDelivery"("userId", "source", "sourceResourceId");

-- CreateIndex
CREATE INDEX "ProactiveDelivery_userId_deviceId_idx" ON "ProactiveDelivery"("userId", "deviceId");

-- CreateIndex
CREATE INDEX "ProactiveDelivery_expiresAt_idx" ON "ProactiveDelivery"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProactiveDelivery_userId_idempotencyKey_key" ON "ProactiveDelivery"("userId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "ProactiveDelivery_id_userId_key" ON "ProactiveDelivery"("id", "userId");

-- CreateIndex
CREATE INDEX "DeliveryAttempt_userId_status_createdAt_idx" ON "DeliveryAttempt"("userId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "DeliveryAttempt_userId_deviceId_idx" ON "DeliveryAttempt"("userId", "deviceId");

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryAttempt_deliveryId_attemptNumber_key" ON "DeliveryAttempt"("deliveryId", "attemptNumber");

-- CreateIndex
CREATE INDEX "DeviceWifiConfiguration_deviceId_status_updatedAt_idx" ON "DeviceWifiConfiguration"("deviceId", "status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "DeviceWifiConfiguration_deviceId_version_key" ON "DeviceWifiConfiguration"("deviceId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "DeviceTelemetryCurrent_deviceId_key" ON "DeviceTelemetryCurrent"("deviceId");

-- CreateIndex
CREATE INDEX "DeviceLog_deviceId_observedAt_idx" ON "DeviceLog"("deviceId", "observedAt");

-- CreateIndex
CREATE INDEX "DeviceLog_expiresAt_idx" ON "DeviceLog"("expiresAt");

-- CreateIndex
CREATE INDEX "IntegrationConnection_status_updatedAt_idx" ON "IntegrationConnection"("status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationConnection_userId_provider_key" ON "IntegrationConnection"("userId", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationConnection_id_userId_provider_key" ON "IntegrationConnection"("id", "userId", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "OAuthState_stateVerifier_key" ON "OAuthState"("stateVerifier");

-- CreateIndex
CREATE INDEX "OAuthState_userId_provider_expiresAt_usedAt_idx" ON "OAuthState"("userId", "provider", "expiresAt", "usedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SpotifyCredential_userId_key" ON "SpotifyCredential"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "SpotifyCredential_connectionId_key" ON "SpotifyCredential"("connectionId");

-- CreateIndex
CREATE UNIQUE INDEX "SpotifyCredential_connectionId_userId_provider_key" ON "SpotifyCredential"("connectionId", "userId", "provider");

-- CreateIndex
CREATE INDEX "SpotifyAction_userId_status_createdAt_idx" ON "SpotifyAction"("userId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SpotifyAction_userId_idempotencyKey_key" ON "SpotifyAction"("userId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "WhatsAppNotificationRule_userId_enabled_updatedAt_idx" ON "WhatsAppNotificationRule"("userId", "enabled", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppNotificationRule_global_unique" ON "WhatsAppNotificationRule"("userId", "connectionId") WHERE "scope" = 'ALL';

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppNotificationRule_target_unique" ON "WhatsAppNotificationRule"("userId", "connectionId", "scope", "opaqueTargetRef") WHERE "scope" IN ('CONTACT', 'GROUP');

-- CreateIndex
CREATE INDEX "WhatsAppSendRequest_userId_status_createdAt_idx" ON "WhatsAppSendRequest"("userId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "WhatsAppSendRequest_expiresAt_idx" ON "WhatsAppSendRequest"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppSendRequest_id_userId_key" ON "WhatsAppSendRequest"("id", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppSendRequest_userId_idempotencyKey_key" ON "WhatsAppSendRequest"("userId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "WhatsAppDelivery_userId_status_createdAt_idx" ON "WhatsAppDelivery"("userId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "WhatsAppDelivery_connectionId_providerMessageRef_idx" ON "WhatsAppDelivery"("connectionId", "providerMessageRef");

-- CreateIndex
CREATE INDEX "WhatsAppDelivery_expiresAt_idx" ON "WhatsAppDelivery"("expiresAt");

-- CreateIndex
CREATE INDEX "BugReport_userId_status_createdAt_idx" ON "BugReport"("userId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "BugReportAttachment_storageKey_key" ON "BugReportAttachment"("storageKey");

-- CreateIndex
CREATE INDEX "BugReportAttachment_bugReportId_createdAt_idx" ON "BugReportAttachment"("bugReportId", "createdAt");

-- CreateIndex
CREATE INDEX "BugReportAttachment_expiresAt_idx" ON "BugReportAttachment"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "User_avatarKey_key" ON "User"("avatarKey");

-- AddForeignKey
ALTER TABLE "PasswordRecovery" ADD CONSTRAINT "PasswordRecovery_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonalizationSettings" ADD CONSTRAINT "PersonalizationSettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatSession" ADD CONSTRAINT "ChatSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatSession" ADD CONSTRAINT "ChatSession_device_owner_fkey" FOREIGN KEY ("deviceId", "userId") REFERENCES "Device"("id", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_sessionId_userId_fkey" FOREIGN KEY ("sessionId", "userId") REFERENCES "ChatSession"("id", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_source_device_owner_fkey" FOREIGN KEY ("sourceDeviceId", "userId") REFERENCES "Device"("id", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatOperation" ADD CONSTRAINT "ChatOperation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatOperation" ADD CONSTRAINT "ChatOperation_userMessageId_userId_fkey" FOREIGN KEY ("userMessageId", "userId") REFERENCES "ChatMessage"("id", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessageFeedback" ADD CONSTRAINT "ChatMessageFeedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessageFeedback" ADD CONSTRAINT "ChatMessageFeedback_messageId_userId_fkey" FOREIGN KEY ("messageId", "userId") REFERENCES "ChatMessage"("id", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemoryRecord" ADD CONSTRAINT "MemoryRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemoryCandidate" ADD CONSTRAINT "MemoryCandidate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemoryCandidate" ADD CONSTRAINT "MemoryCandidate_sourceMessageId_userId_fkey" FOREIGN KEY ("sourceMessageId", "userId") REFERENCES "ChatMessage"("id", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemoryAction" ADD CONSTRAINT "MemoryAction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemoryTopicForget" ADD CONSTRAINT "MemoryTopicForget_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemorySummary" ADD CONSTRAINT "MemorySummary_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Schedule" ADD CONSTRAINT "Schedule_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Schedule" ADD CONSTRAINT "Schedule_target_device_owner_fkey" FOREIGN KEY ("targetDeviceId", "userId") REFERENCES "Device"("id", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleRun" ADD CONSTRAINT "ScheduleRun_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "Schedule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProactiveDelivery" ADD CONSTRAINT "ProactiveDelivery_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProactiveDelivery" ADD CONSTRAINT "ProactiveDelivery_device_owner_fkey" FOREIGN KEY ("deviceId", "userId") REFERENCES "Device"("id", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryAttempt" ADD CONSTRAINT "DeliveryAttempt_delivery_owner_fkey" FOREIGN KEY ("deliveryId", "userId") REFERENCES "ProactiveDelivery"("id", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryAttempt" ADD CONSTRAINT "DeliveryAttempt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryAttempt" ADD CONSTRAINT "DeliveryAttempt_device_owner_fkey" FOREIGN KEY ("deviceId", "userId") REFERENCES "Device"("id", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceWifiConfiguration" ADD CONSTRAINT "DeviceWifiConfiguration_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceTelemetryCurrent" ADD CONSTRAINT "DeviceTelemetryCurrent_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceLog" ADD CONSTRAINT "DeviceLog_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationConnection" ADD CONSTRAINT "IntegrationConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OAuthState" ADD CONSTRAINT "OAuthState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpotifyCredential" ADD CONSTRAINT "SpotifyCredential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpotifyCredential" ADD CONSTRAINT "SpotifyCredential_connection_owner_provider_fkey" FOREIGN KEY ("connectionId", "userId", "provider") REFERENCES "IntegrationConnection"("id", "userId", "provider") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpotifyAction" ADD CONSTRAINT "SpotifyAction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpotifyAction" ADD CONSTRAINT "SpotifyAction_connection_owner_provider_fkey" FOREIGN KEY ("connectionId", "userId", "provider") REFERENCES "IntegrationConnection"("id", "userId", "provider") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppNotificationRule" ADD CONSTRAINT "WhatsAppNotificationRule_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppNotificationRule" ADD CONSTRAINT "WhatsAppNotificationRule_connection_owner_provider_fkey" FOREIGN KEY ("connectionId", "userId", "provider") REFERENCES "IntegrationConnection"("id", "userId", "provider") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppSendRequest" ADD CONSTRAINT "WhatsAppSendRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppSendRequest" ADD CONSTRAINT "WhatsAppSendRequest_connection_owner_provider_fkey" FOREIGN KEY ("connectionId", "userId", "provider") REFERENCES "IntegrationConnection"("id", "userId", "provider") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppDelivery" ADD CONSTRAINT "WhatsAppDelivery_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppDelivery" ADD CONSTRAINT "WhatsAppDelivery_connection_owner_provider_fkey" FOREIGN KEY ("connectionId", "userId", "provider") REFERENCES "IntegrationConnection"("id", "userId", "provider") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppDelivery" ADD CONSTRAINT "WhatsAppDelivery_sendRequestId_userId_fkey" FOREIGN KEY ("sendRequestId", "userId") REFERENCES "WhatsAppSendRequest"("id", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BugReport" ADD CONSTRAINT "BugReport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BugReportAttachment" ADD CONSTRAINT "BugReportAttachment_bugReportId_fkey" FOREIGN KEY ("bugReportId") REFERENCES "BugReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- AddCheckConstraints
ALTER TABLE "User"
  ADD CONSTRAINT "User_username_normalized_ck"
  CHECK ("username" IS NULL OR "username" = lower(btrim("username"))),
  ADD CONSTRAINT "User_avatar_metadata_ck"
  CHECK (
    ("avatarKey" IS NULL AND "avatarContentType" IS NULL AND "avatarByteSize" IS NULL)
    OR (
      "avatarKey" IS NOT NULL
      AND length(btrim("avatarKey")) > 0
      AND "avatarContentType" IS NOT NULL
      AND length(btrim("avatarContentType")) > 0
      AND "avatarByteSize" IS NOT NULL
      AND "avatarByteSize" > 0
    )
  );

ALTER TABLE "PasswordRecovery"
  ADD CONSTRAINT "PasswordRecovery_verifier_ck"
  CHECK ("tokenVerifier" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "PasswordRecovery_attempt_bounds_ck"
  CHECK ("attemptCount" >= 0 AND "maxAttempts" > 0 AND "attemptCount" <= "maxAttempts"),
  ADD CONSTRAINT "PasswordRecovery_audit_hashes_ck"
  CHECK (
    ("requestIpHash" IS NULL OR "requestIpHash" ~ '^[0-9a-f]{64}$')
    AND ("requestUserAgentHash" IS NULL OR "requestUserAgentHash" ~ '^[0-9a-f]{64}$')
  );

ALTER TABLE "ChatSession"
  ADD CONSTRAINT "ChatSession_cursor_ck"
  CHECK ("lastMessageCursor" IS NULL OR "lastMessageCursor" > 0);

ALTER TABLE "ChatMessage"
  ADD CONSTRAINT "ChatMessage_cursor_ck"
  CHECK ("cursor" > 0);

ALTER TABLE "MemoryRecord"
  ADD CONSTRAINT "MemoryRecord_importance_ck"
  CHECK ("importance" BETWEEN 0 AND 100);

ALTER TABLE "MemorySummary"
  ADD CONSTRAINT "MemorySummary_version_ck"
  CHECK ("version" > 0);

ALTER TABLE "Schedule"
  ADD CONSTRAINT "Schedule_timezone_ck"
  CHECK ("timezone" = 'Asia/Jakarta'),
  ADD CONSTRAINT "Schedule_version_ck"
  CHECK ("version" > 0);

ALTER TABLE "ScheduleRun"
  ADD CONSTRAINT "ScheduleRun_attempt_lease_ck"
  CHECK (
    "attemptCount" >= 0
    AND (("leaseOwner" IS NULL AND "leaseExpiresAt" IS NULL)
      OR ("leaseOwner" IS NOT NULL AND "leaseExpiresAt" IS NOT NULL))
  );

ALTER TABLE "ProactiveDelivery"
  ADD CONSTRAINT "ProactiveDelivery_attempt_count_ck"
  CHECK ("attemptCount" >= 0);

ALTER TABLE "DeliveryAttempt"
  ADD CONSTRAINT "DeliveryAttempt_number_ck"
  CHECK ("attemptNumber" > 0);

ALTER TABLE "DeviceWifiConfiguration"
  ADD CONSTRAINT "DeviceWifiConfiguration_version_ssid_ck"
  CHECK ("version" > 0 AND length(btrim("ssid")) > 0),
  ADD CONSTRAINT "DeviceWifiConfiguration_secret_shape_ck"
  CHECK (
    ("security" = 'OPEN'
      AND "secretCiphertext" IS NULL
      AND "secretNonce" IS NULL
      AND "secretTag" IS NULL
      AND "secretKeyVersion" IS NULL)
    OR
    ("security" = 'WPA_PSK'
      AND "secretCiphertext" IS NOT NULL
      AND length(btrim("secretCiphertext")) > 0
      AND "secretNonce" IS NOT NULL
      AND length(btrim("secretNonce")) > 0
      AND "secretTag" IS NOT NULL
      AND length(btrim("secretTag")) > 0
      AND "secretKeyVersion" IS NOT NULL
      AND "secretKeyVersion" > 0)
  );

ALTER TABLE "DeviceTelemetryCurrent"
  ADD CONSTRAINT "DeviceTelemetryCurrent_battery_ck"
  CHECK (
    ("batterySupported" = false AND "batteryPercent" IS NULL)
    OR ("batterySupported" = true
      AND "batteryPercent" IS NOT NULL
      AND "batteryPercent" BETWEEN 0 AND 100)
  ),
  ADD CONSTRAINT "DeviceTelemetryCurrent_rssi_ck"
  CHECK ("wifiRssi" IS NULL OR "wifiRssi" BETWEEN -127 AND 0);

ALTER TABLE "DeviceSettings"
  ADD CONSTRAINT "DeviceSettings_delivery_version_ck"
  CHECK (
    "version" > 0
    AND ("appliedVersion" IS NULL OR "appliedVersion" BETWEEN 1 AND "version")
    AND (("appliedVersion" IS NULL AND "appliedAt" IS NULL)
      OR ("appliedVersion" IS NOT NULL AND "appliedAt" IS NOT NULL))
  );

ALTER TABLE "DeviceLog"
  ADD CONSTRAINT "DeviceLog_expiry_ck"
  CHECK ("expiresAt" > "createdAt");

ALTER TABLE "OAuthState"
  ADD CONSTRAINT "OAuthState_verifier_expiry_ck"
  CHECK ("stateVerifier" ~ '^[0-9a-f]{64}$' AND "expiresAt" > "createdAt");

ALTER TABLE "SpotifyCredential"
  ADD CONSTRAINT "SpotifyCredential_provider_ck"
  CHECK ("provider" = 'SPOTIFY'),
  ADD CONSTRAINT "SpotifyCredential_encryption_shape_ck"
  CHECK (
    "keyVersion" > 0
    AND length(btrim("accessTokenCiphertext")) > 0
    AND length(btrim("accessTokenNonce")) > 0
    AND length(btrim("accessTokenTag")) > 0
    AND (
      ("refreshTokenCiphertext" IS NULL AND "refreshTokenNonce" IS NULL AND "refreshTokenTag" IS NULL)
      OR
      (
        "refreshTokenCiphertext" IS NOT NULL
        AND length(btrim("refreshTokenCiphertext")) > 0
        AND "refreshTokenNonce" IS NOT NULL
        AND length(btrim("refreshTokenNonce")) > 0
        AND "refreshTokenTag" IS NOT NULL
        AND length(btrim("refreshTokenTag")) > 0
      )
    )
  );

ALTER TABLE "SpotifyAction"
  ADD CONSTRAINT "SpotifyAction_provider_ck"
  CHECK ("provider" = 'SPOTIFY');

ALTER TABLE "WhatsAppNotificationRule"
  ADD CONSTRAINT "WhatsAppNotificationRule_provider_ck"
  CHECK ("provider" = 'WHATSAPP'),
  ADD CONSTRAINT "WhatsAppNotificationRule_target_shape_ck"
  CHECK (
    ("scope" = 'ALL' AND "opaqueTargetRef" IS NULL)
    OR
    (
      "scope" IN ('CONTACT', 'GROUP')
      AND "opaqueTargetRef" IS NOT NULL
      AND length(btrim("opaqueTargetRef")) > 0
    )
  );

ALTER TABLE "WhatsAppSendRequest"
  ADD CONSTRAINT "WhatsAppSendRequest_provider_ck"
  CHECK ("provider" = 'WHATSAPP');

ALTER TABLE "WhatsAppDelivery"
  ADD CONSTRAINT "WhatsAppDelivery_provider_ck"
  CHECK ("provider" = 'WHATSAPP');

ALTER TABLE "BugReportAttachment"
  ADD CONSTRAINT "BugReportAttachment_size_digest_ck"
  CHECK ("byteSize" > 0 AND "sha256" ~ '^[0-9a-f]{64}$');
