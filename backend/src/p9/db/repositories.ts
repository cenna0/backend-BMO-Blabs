import type { PrismaClient, Prisma } from "../../generated/prisma/client.js";
import type { P9Client } from "./client.js";

export class P9Repositories {
  constructor(private readonly db: P9Client) {}

  async healthCheck(): Promise<void> {
    await this.db.$queryRaw`SELECT 1`;
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
}
