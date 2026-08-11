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
