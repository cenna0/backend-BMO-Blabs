import type { PrismaClient, Prisma } from "../../generated/prisma/client.js";
import type { P9Client } from "./client.js";

export class P9Repositories {
  constructor(private readonly db: P9Client) {}

  async healthCheck(): Promise<void> {
    await this.db.$queryRaw`SELECT 1`;
  }

  async lockUser(userId: string): Promise<void> {
    await this.db.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${userId}, 0))`;
  }

  async databaseNow(): Promise<Date> {
    const rows = await this.db.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS "now"`;
    const now = rows[0]?.now;
    if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw new Error("database clock unavailable");
    return now;
  }

  async searchActiveMemories(input: { userId: string; terms: string[]; limit: number }): Promise<string[]> {
    const rows = await this.db.$queryRaw<Array<{ normalizedContent: string }>>`
      SELECT memory."normalizedContent"
      FROM "MemoryRecord" AS memory
      WHERE memory."userId" = ${input.userId}::uuid
        AND memory."deletedAt" IS NULL
        AND (memory."expiresAt" IS NULL OR memory."expiresAt" > clock_timestamp())
        AND NOT EXISTS (
          SELECT 1
          FROM "MemoryTopicForget" AS forgotten
          WHERE forgotten."userId" = memory."userId"
            AND lower(forgotten."normalizedTopic") = lower(memory.topic)
        )
        AND EXISTS (
          SELECT 1
          FROM unnest(${input.terms}::text[]) AS term(value)
          WHERE memory.topic ILIKE ('%' || term.value || '%')
             OR memory."normalizedContent" ILIKE ('%' || term.value || '%')
        )
      ORDER BY memory.importance DESC, memory."updatedAt" DESC, memory.id ASC
      LIMIT ${input.limit}
    `;
    return rows.map((row) => row.normalizedContent);
  }

  async claimChatOperation(input: {
    operationId: string;
    userId: string;
    sessionId: string;
    leaseToken: string;
    leaseTtlMs: number;
  }): Promise<boolean> {
    const leaseSeconds = input.leaseTtlMs / 1_000;
    const rows = await this.db.$queryRaw<Array<{ id: string }>>`
      UPDATE "ChatOperation" AS candidate
      SET "errorCode" = ${input.leaseToken}, "updatedAt" = clock_timestamp()
      FROM "ChatMessage" AS candidate_message, "ChatSession" AS candidate_session
      WHERE candidate.id = ${input.operationId}::uuid
        AND candidate."userId" = ${input.userId}::uuid
        AND candidate.status = 'PROCESSING'
        AND candidate."userMessageId" = candidate_message.id
        AND candidate_message."sessionId" = ${input.sessionId}::uuid
        AND candidate_message."deletedAt" IS NULL
        AND candidate_session.id = candidate_message."sessionId"
        AND candidate_session."userId" = candidate."userId"
        AND candidate_session.status = 'ACTIVE'
        AND candidate_session."deletedAt" IS NULL
        AND (
          candidate."errorCode" IS NULL
          OR (
            candidate."errorCode" LIKE 'LEASE:%'
            AND candidate."updatedAt" < clock_timestamp() - (${leaseSeconds} * interval '1 second')
          )
        )
        AND NOT EXISTS (
          SELECT 1
          FROM "ChatOperation" AS prior
          JOIN "ChatMessage" AS prior_message ON prior_message.id = prior."userMessageId"
          WHERE prior."userId" = candidate."userId"
            AND prior.status = 'PROCESSING'
            AND prior_message."sessionId" = candidate_message."sessionId"
            AND prior_message."deletedAt" IS NULL
            AND prior_message.cursor < candidate_message.cursor
        )
      RETURNING candidate.id
    `;
    return rows.length === 1;
  }

  async renewChatOperationLease(input: {
    operationId: string;
    userId: string;
    sessionId: string;
    leaseToken: string;
  }): Promise<boolean> {
    const rows = await this.db.$queryRaw<Array<{ id: string }>>`
      UPDATE "ChatOperation" AS candidate
      SET "updatedAt" = clock_timestamp()
      FROM "ChatMessage" AS candidate_message, "ChatSession" AS candidate_session
      WHERE candidate.id = ${input.operationId}::uuid
        AND candidate."userId" = ${input.userId}::uuid
        AND candidate.status = 'PROCESSING'
        AND candidate."errorCode" = ${input.leaseToken}
        AND candidate."userMessageId" = candidate_message.id
        AND candidate_message."sessionId" = ${input.sessionId}::uuid
        AND candidate_message."deletedAt" IS NULL
        AND candidate_session.id = candidate_message."sessionId"
        AND candidate_session."userId" = candidate."userId"
        AND candidate_session.status = 'ACTIVE'
        AND candidate_session."deletedAt" IS NULL
        AND NOT EXISTS (
          SELECT 1
          FROM "ChatOperation" AS prior
          JOIN "ChatMessage" AS prior_message ON prior_message.id = prior."userMessageId"
          WHERE prior."userId" = candidate."userId"
            AND prior.status = 'PROCESSING'
            AND prior_message."sessionId" = candidate_message."sessionId"
            AND prior_message."deletedAt" IS NULL
            AND prior_message.cursor < candidate_message.cursor
        )
      RETURNING candidate.id
    `;
    return rows.length === 1;
  }

  async findClaimableChatOperations(input: { leaseTtlMs: number; limit: number }): Promise<Array<{
    id: string;
    userId: string;
    userMessageId: string;
    userMessage: { sessionId: string; content: string };
  }>> {
    const leaseSeconds = input.leaseTtlMs / 1_000;
    const rows = await this.db.$queryRaw<Array<{
      id: string;
      userId: string;
      userMessageId: string;
      sessionId: string;
      content: string;
    }>>`
      SELECT operation.id,
             operation."userId" AS "userId",
             operation."userMessageId" AS "userMessageId",
             message."sessionId" AS "sessionId",
             message.content
      FROM "ChatOperation" AS operation
      JOIN "ChatMessage" AS message ON message.id = operation."userMessageId"
      JOIN "ChatSession" AS session ON session.id = message."sessionId"
                                    AND session."userId" = operation."userId"
      WHERE operation.status = 'PROCESSING'
        AND message."deletedAt" IS NULL
        AND session.status = 'ACTIVE'
        AND session."deletedAt" IS NULL
        AND (
          operation."errorCode" IS NULL
          OR (
            operation."errorCode" LIKE 'LEASE:%'
            AND operation."updatedAt" < clock_timestamp() - (${leaseSeconds} * interval '1 second')
          )
        )
        AND NOT EXISTS (
          SELECT 1
          FROM "ChatOperation" AS prior
          JOIN "ChatMessage" AS prior_message ON prior_message.id = prior."userMessageId"
          WHERE prior."userId" = operation."userId"
            AND prior.status = 'PROCESSING'
            AND prior_message."sessionId" = message."sessionId"
            AND prior_message."deletedAt" IS NULL
            AND prior_message.cursor < message.cursor
        )
      ORDER BY operation."startedAt" ASC, operation.id ASC
      LIMIT ${input.limit}
    `;
    return rows.map((row) => ({
      id: row.id,
      userId: row.userId,
      userMessageId: row.userMessageId,
      userMessage: { sessionId: row.sessionId, content: row.content },
    }));
  }

  async migrationStatus(): Promise<Array<{ name: string; finishedAt: Date | null }>> {
    const rows = await this.db.$queryRaw<Array<{ migration_name: string; finished_at: Date | null }>>`
      SELECT migration_name, finished_at
      FROM "_prisma_migrations"
      ORDER BY started_at ASC
    `;
    return rows.map((row) => ({ name: row.migration_name, finishedAt: row.finished_at }));
  }

  get client(): PrismaClient | Prisma.TransactionClient {
    return this.db;
  }

  get user() {
    return this.db.user;
  }

  get passwordCredential() {
    return this.db.passwordCredential;
  }

  get authIdentity() {
    return this.db.authIdentity;
  }

  get invitation() {
    return this.db.invitation;
  }

  get session() {
    return this.db.session;
  }

  get refreshToken() {
    return this.db.refreshToken;
  }

  get device() {
    return this.db.device;
  }

  get devicePairing() {
    return this.db.devicePairing;
  }

  get userSettings() {
    return this.db.userSettings;
  }

  get deviceSettings() {
    return this.db.deviceSettings;
  }

  get auditEvent() {
    return this.db.auditEvent;
  }

  get passwordRecovery() {
    return this.db.passwordRecovery;
  }

  get personalizationSettings() {
    return this.db.personalizationSettings;
  }

  get chatSession() {
    return this.db.chatSession;
  }

  get chatMessage() {
    return this.db.chatMessage;
  }

  get chatOperation() {
    return this.db.chatOperation;
  }

  get chatMessageFeedback() {
    return this.db.chatMessageFeedback;
  }

  get memoryRecord() {
    return this.db.memoryRecord;
  }

  get memoryCandidate() {
    return this.db.memoryCandidate;
  }

  get memoryAction() {
    return this.db.memoryAction;
  }

  get memoryTopicForget() {
    return this.db.memoryTopicForget;
  }

  get memorySummary() {
    return this.db.memorySummary;
  }

  get schedule() {
    return this.db.schedule;
  }

  get scheduleRun() {
    return this.db.scheduleRun;
  }

  get proactiveDelivery() {
    return this.db.proactiveDelivery;
  }

  get deliveryAttempt() {
    return this.db.deliveryAttempt;
  }

  get deviceWifiConfiguration() {
    return this.db.deviceWifiConfiguration;
  }

  get deviceTelemetryCurrent() {
    return this.db.deviceTelemetryCurrent;
  }

  get deviceLog() {
    return this.db.deviceLog;
  }

  get integrationConnection() {
    return this.db.integrationConnection;
  }

  get oAuthState() {
    return this.db.oAuthState;
  }

  get spotifyCredential() {
    return this.db.spotifyCredential;
  }

  get spotifyAction() {
    return this.db.spotifyAction;
  }

  get whatsAppNotificationRule() {
    return this.db.whatsAppNotificationRule;
  }

  get whatsAppSendRequest() {
    return this.db.whatsAppSendRequest;
  }

  get whatsAppDelivery() {
    return this.db.whatsAppDelivery;
  }

  get bugReport() {
    return this.db.bugReport;
  }

  get bugReportAttachment() {
    return this.db.bugReportAttachment;
  }
}
