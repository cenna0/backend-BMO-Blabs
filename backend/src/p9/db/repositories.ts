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
}
