import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient, type Prisma } from "../../generated/prisma/client.js";
import type { P9Config } from "../config.js";

export type P9Client = PrismaClient | Prisma.TransactionClient;

export function createP9Client(config: P9Config): PrismaClient {
  if (!config.enabled || !config.databaseUrl) {
    throw new Error("P9 database configuration is not enabled");
  }
  const adapter = new PrismaPg({
    connectionString: config.databaseUrl,
    max: config.prismaPoolSize,
    connectionTimeoutMillis: 2_000,
    idleTimeoutMillis: 10_000,
  });
  return new PrismaClient({ adapter });
}

export async function disconnectP9Client(client: PrismaClient): Promise<void> {
  await client.$disconnect();
}

export async function withP9Transaction<T>(
  client: PrismaClient,
  work: (transaction: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return client.$transaction(work, { maxWait: 5_000, timeout: 10_000 });
}
