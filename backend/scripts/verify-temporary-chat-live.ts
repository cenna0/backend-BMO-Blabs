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
  console.log("Starting Live Temporary Chat Isolation Verification...");

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
    conversation: "temporary-live-test",
    hardTimeoutMs: 60_000,
  });

  const memoryGateway = new PostgresMemoryGateway(repositories);
  const events: any[] = [];
  const mobileEvents = {
    sendToUser: (userId: string, event: any) => {
      events.push({ userId, event });
      return 1;
    }
  };

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

  const user = await client.user.findFirst({ where: { email: "ranggabiner@gmail.com" } });
  if (!user) throw new Error("User ranggabiner@gmail.com not found");

  const initialMemoryCount = await client.memoryRecord.count({ where: { userId: user.id } });

  console.log(`[TEST] Creating temporary session for user ${user.id}...`);
  const tempSession = await chatService.createSession(user.id, { temporary: true });
  console.log(`[TEST] Created temporary session: ${tempSession.id}, temporary=${tempSession.temporary}`);
  if (!tempSession.temporary) throw new Error("Session should be temporary");

  console.log(`[TEST] Verifying listSessions excludes temporary session...`);
  const { sessions } = await chatService.listSessions(user.id);
  const foundInList = sessions.some(s => s.id === tempSession.id);
  console.log(`[TEST] Temporary session in listSessions: ${foundInList}`);
  if (foundInList) throw new Error("Temporary session MUST NOT appear in listSessions!");

  console.log(`[TEST] Submitting message in temporary session...`);
  const result = await chatService.submitMessage(user.id, tempSession.id, {
    idempotencyKey: randomUUID(),
    text: "Halo BMO, ini pesan rahasia: Kode brankas saya adalah 987654.",
    speakOnDevice: false,
  });
  console.log(`[TEST] Message submitted, userMessageId: ${result.userMessage.id}`);

  console.log(`[TEST] Waiting for chatService to process and idle...`);
  await chatService.waitForIdle();
  await new Promise((r) => setTimeout(r, 2000));

  // Check messages
  const msgResult = await chatService.listMessages(user.id, tempSession.id, { limit: 10 });
  console.log(`[TEST] Total messages in temporary session: ${msgResult.messages.length}`);
  const assistantMsg = msgResult.messages.find(m => m.sender === "assistant");
  console.log(`[TEST] Assistant response: ${assistantMsg?.text}`);
  if (!assistantMsg) throw new Error("Expected assistant reply");

  // Check that session title was NOT generated
  const dbSession = await client.chatSession.findUnique({ where: { id: tempSession.id } });
  console.log(`[TEST] Session title in DB: ${dbSession?.title}`);
  if (dbSession?.title !== null) throw new Error("Temporary session MUST NOT have an auto-generated title!");

  // Check that NO memories were extracted
  const finalMemoryCount = await client.memoryRecord.count({ where: { userId: user.id } });
  console.log(`[TEST] Memory count before: ${initialMemoryCount}, after: ${finalMemoryCount}`);
  if (finalMemoryCount !== initialMemoryCount) {
    throw new Error("Temporary session MUST NOT create or extract new memories!");
  }

  console.log(`[TEST] Submitting turn 2 to verify multi-turn context retention in temporary session...`);
  const result2 = await chatService.submitMessage(user.id, tempSession.id, {
    idempotencyKey: randomUUID(),
    text: "Berapa kode brankas yang tadi saya sebutkan?",
    speakOnDevice: false,
  });
  await chatService.waitForIdle();
  await new Promise((r) => setTimeout(r, 2000));

  const msgResult2 = await chatService.listMessages(user.id, tempSession.id, { limit: 10 });
  const lastAssistant = msgResult2.messages[msgResult2.messages.length - 1];
  console.log(`[TEST] Turn 2 Assistant response: ${lastAssistant?.text}`);

  // Cleanup test session
  await client.chatMessage.deleteMany({ where: { sessionId: tempSession.id } });
  await client.chatOperation.deleteMany({ where: { userMessage: { sessionId: tempSession.id } } });
  await client.chatSession.delete({ where: { id: tempSession.id } });
  await client.$disconnect();

  console.log("\n>>> ALL TEMPORARY CHAT ISOLATION TESTS PASSED SUCCESSFULLY! <<<");
}

main().catch(err => {
  console.error("FAILED:", err);
  process.exit(1);
});