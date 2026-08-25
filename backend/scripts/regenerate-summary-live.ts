import { webcrypto } from "node:crypto";
if (!globalThis.crypto) {
  globalThis.crypto = webcrypto as any;
}

import { readFileSync, existsSync } from "node:fs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { P9Repositories } from "../src/p9/db/repositories.js";
import { HermesResponsesClient } from "../src/services/hermes.client.js";
import { MemoryService } from "../src/p9/services/memory.service.js";
import { randomUUID } from "node:crypto";

function getEnvVar(key: string, envFile?: string): string | undefined {
  if (process.env[key]) return process.env[key];
  if (envFile && existsSync(envFile)) {
    const lines = readFileSync(envFile, "utf-8").split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith(`${key}=`)) {
        return trimmed.slice(key.length + 1).replace(/^["']|["']$/g, "");
      }
    }
  }
  return undefined;
}

async function main() {
  console.log("Regenerating Memory Summary for user ranggabiner...");

  const backendEnvFile = "/opt/bmo/config/p9.1/backend.env";
  const hermesApiKey = getEnvVar("HERMES_API_KEY", backendEnvFile) || "8ed6463bcfae8982e9b28225cf00c4d62caaca6dbf49becbf001c1be910f9ec1";
  const hermesApiUrl = getEnvVar("HERMES_API_URL", backendEnvFile) || "http://127.0.0.1:8642";

  const password = process.env.P9_POSTGRES_PASSWORD || (existsSync("/opt/bmo/config/p9.1/postgres-password") ? readFileSync("/opt/bmo/config/p9.1/postgres-password", "utf-8").trim() : "bmo");
  const databaseUrl = process.env.DATABASE_URL || `postgresql://bmo:${password}@localhost/bmo?host=/var/lib/docker/volumes/bmo-production-p9_p9_production_postgres_socket/_data`;

  const adapter = new PrismaPg({ connectionString: databaseUrl });
  const client = new PrismaClient({ adapter });
  const repositories = new P9Repositories(client);

  const hermes = new HermesResponsesClient({
    baseUrl: hermesApiUrl,
    apiKey: hermesApiKey,
    model: "hermes-agent",
    conversation: "memory-dream",
    hardTimeoutMs: 60_000,
  });

  const memoryService = new MemoryService({ client, repositories, hermes });

  const user = await client.user.findFirst({ where: { username: "ranggabiner" } });
  if (!user) throw new Error("User ranggabiner not found");

  console.log(`Found user: ${user.id} (${user.username})`);

  const res = await memoryService.regenerateSummary(user.id, { idempotencyKey: randomUUID() });
  console.log("=== REGENERATION RESULT ===");
  console.log("Status:", res.summary.status);
  console.log("RuntimeStatus:", res.generation?.runtimeStatus);
  console.log("Content:\n" + res.summary.content);

  await client.$disconnect();
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
