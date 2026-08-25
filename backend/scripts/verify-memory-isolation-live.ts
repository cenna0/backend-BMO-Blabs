import { webcrypto } from "node:crypto";
if (!globalThis.crypto) {
  globalThis.crypto = webcrypto as any;
}

import { readFileSync, existsSync } from "node:fs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { P9Repositories } from "../src/p9/db/repositories.js";
import { HermesResponsesClient } from "../src/services/hermes.client.js";
import { PostgresMemoryGateway } from "../src/p9/services/memory-gateway.service.js";
import { ChatService } from "../src/p9/services/chat.service.js";
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
  console.log("Starting Live E2E Memory & Identity Isolation Verification...");

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
    conversation: "live-e2e-test",
    hardTimeoutMs: 60_000,
  });

  const memoryGateway = new PostgresMemoryGateway(repositories);
  const mobileEvents = { sendToUser: () => 1 };

  const chatService = new ChatService({
    client,
    repositories,
    hermes,
    mobileEvents,
    memoryContext: memoryGateway,
    hardTimeoutMs: 60_000,
    maxConcurrent: 2,
    maxPending: 10,
  });

  const userA = await client.user.findFirst({ where: { email: "ranggabiner@gmail.com" } });
  const userB = await client.user.findFirst({ where: { email: "amel@gmail.com" } });

  if (!userA || !userB) {
    throw new Error(`Users not found. UserA: ${userA?.id}, UserB: ${userB?.id}`);
  }

  console.log(`User A (Rangga): ${userA.id}, displayName: ${userA.displayName}`);
  console.log(`User B (Amel): ${userB.id}, displayName: ${userB.displayName}`);

  await client.memoryRecord.deleteMany({ where: { userId: { in: [userA.id, userB.id] } } });
  await client.memoryCandidate.deleteMany({ where: { userId: { in: [userA.id, userB.id] } } });

  // ----------------------------------------------------
  // STEP 1: Session 1 for User A
  // ----------------------------------------------------
  console.log("\n=== STEP 1: User A Session 1 ===");
  const session1 = await chatService.createSession(userA.id, { temporary: false });
  console.log(`Created Session 1: ${session1.id}`);

  await chatService.submitMessage(userA.id, session1.id, {
    idempotencyKey: randomUUID(),
    text: "Nama saya Rangga dan saya suka makan ayam.",
    speakOnDevice: false,
  });
  console.log("Submitted message 1. Waiting for completion...");

  await chatService.waitForIdle();

  console.log("Waiting for asynchronous memory extraction to complete...");
  await new Promise((resolve) => setTimeout(resolve, 6000));

  const messages1 = await chatService.listMessages(userA.id, session1.id, { limit: 10 });
  console.log("Session 1 messages:", messages1.messages.map((m) => `[${m.sender}] ${m.text}`));

  const memoriesA = await client.memoryRecord.findMany({
    where: { userId: userA.id, deletedAt: null },
  });
  console.log("Extracted Memory Records in DB for User A:", memoriesA.map((m) => ({ topic: m.topic, content: m.normalizedContent, importance: m.importance })));

  if (memoriesA.length === 0) {
    throw new Error("FAILED: No memory records extracted into PostgreSQL for User A!");
  }

  // ----------------------------------------------------
  // STEP 2: Session 2 for User A (Brand New Session)
  // ----------------------------------------------------
  console.log("\n=== STEP 2: User A Session 2 (New Session) ===");
  const session2 = await chatService.createSession(userA.id, { temporary: false });
  console.log(`Created Session 2: ${session2.id}`);

  await chatService.submitMessage(userA.id, session2.id, {
    idempotencyKey: randomUUID(),
    text: "Aku suka makan apa?",
    speakOnDevice: false,
  });
  console.log("Submitted message 2. Waiting for completion...");

  await chatService.waitForIdle();

  const messages2 = await chatService.listMessages(userA.id, session2.id, { limit: 10 });
  console.log("Session 2 messages:", messages2.messages.map((m) => `[${m.sender}] ${m.text}`));

  const assistantReply2 = messages2.messages.find((m) => m.sender === "assistant")?.text || "";
  console.log(`Assistant Reply 2: "${assistantReply2}"`);

  const remembersChicken = /ayam|chicken/i.test(assistantReply2);
  console.log(`Did BMO remember favorite food (ayam)? ${remembersChicken ? "YES!" : "NO"}`);
  if (!remembersChicken) {
    throw new Error("FAILED: BMO did not remember favorite food (ayam) in Session 2!");
  }

  // ----------------------------------------------------
  // STEP 3: Session 3 for User B (Different User Isolation Check)
  // ----------------------------------------------------
  console.log("\n=== STEP 3: User B Session 3 (Isolation Check) ===");
  const session3 = await chatService.createSession(userB.id, { temporary: false });
  console.log(`Created Session 3 for User B: ${session3.id}`);

  await chatService.submitMessage(userB.id, session3.id, {
    idempotencyKey: randomUUID(),
    text: "Aku suka makan apa?",
    speakOnDevice: false,
  });
  console.log("Submitted message 3 for User B. Waiting for completion...");

  await chatService.waitForIdle();

  const messages3 = await chatService.listMessages(userB.id, session3.id, { limit: 10 });
  console.log("User B Session 3 messages:", messages3.messages.map((m) => `[${m.sender}] ${m.text}`));

  const assistantReply3 = messages3.messages.find((m) => m.sender === "assistant")?.text || "";
  console.log(`Assistant Reply 3 (User B): "${assistantReply3}"`);

  const leakedAyamToUserB = /ayam|chicken|Rangga/i.test(assistantReply3);
  console.log(`Did User B leak User A's data? ${leakedAyamToUserB ? "YES (LEAKED!)" : "NO (ISOLATED!)"}`);
  if (leakedAyamToUserB) {
    throw new Error("FAILED: User A's memory was leaked to User B!");
  }

  console.log("\n==========================================");
  console.log("ALL E2E MEMORY & ISOLATION CHECKS PASSED!");
  console.log("==========================================");

  await chatService.close();
  await client.$disconnect();
}

main().catch((err) => {
  console.error("E2E Verification Error:", err);
  process.exit(1);
});
