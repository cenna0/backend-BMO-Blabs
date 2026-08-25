import type { PrismaClient } from "../../generated/prisma/client.js";
import { withP9Transaction } from "../db/client.js";
import { P9Repositories } from "../db/repositories.js";
import { P9Error } from "../errors.js";
import { decodeMemoryCursor, encodeMemoryCursor } from "../memory.validation.js";
import { AuditService } from "./audit.service.js";
import { createHash } from "node:crypto";
import type { HermesGenerateClient } from "../../services/hermes.client.js";

type Transaction = <T>(work: (repositories: P9Repositories) => Promise<T>) => Promise<T>;

export const JOY_DREAM_SYSTEM_INSTRUCTIONS = `You are Joy, synthesizing a comprehensive long-term memory summary about the user.
Write the memory summary directly from your perspective (Joy / "aku") addressing the user as "kamu".
Consolidate the user's durable personal context, preferences, habits, speaking style, projects, commitments, and background into structured markdown sections starting with '## '.

Rules:
- 1 to 6 thematic sections. Each section MUST start with '## Section Title' followed by 1-3 concise, informative paragraphs.
- Standard section headers: '## Profile & Identity', '## Work & Projects', '## Preferences & Interests', '## Habits & Routines', '## Communication & Style'.
- Point of View: Always address the user directly as "kamu". When referencing yourself, use "aku" or "Joy".
- Strictly FORBIDDEN clinical/third-person phrasing: NEVER use "pengguna", "user", "ia", "dia", "asistennya", "asisten AI", or "teman AI".
- Language: Natural, warm Indonesian matching the user's conversation style.
- Rewrite stale facts (past commitments that have passed, superseded plans).
- Skip greetings, one-off moods, jokes, and system errors.
- If the user provides a specific instruction/feedback, apply it directly.
- Plain markdown only. No conversational replies, no intro commentary, no code fences.`;

export const BMO_DREAM_SYSTEM_INSTRUCTIONS = JOY_DREAM_SYSTEM_INSTRUCTIONS;

interface MemoryServiceOptions {
  client?: PrismaClient;
  repositories: P9Repositories;
  transaction?: Transaction;
  hermes?: HermesGenerateClient | undefined;
}

interface ActionInput { idempotencyKey: string }
interface AcceptInput extends ActionInput { category?: string; importance?: number; expiresAt?: string | null }
interface PatchInput extends ActionInput {
  topic?: string; category?: string; normalizedContent?: string; importance?: number; expiresAt?: string | null;
}

interface MemoryRecordRow {
  id: string;
  topic: string;
  category: string;
  normalizedContent: string;
  importance: number;
  source: string;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface MemoryCandidateRow {
  id: string;
  sourceMessageId: string | null;
  proposedContent: string;
  topic: string | null;
  status: string;
  expiresAt: Date | null;
  reviewedAt: Date | null;
  createdAt: Date;
}

interface MemorySummaryRow {
  id: string;
  userId?: string;
  content: string | null;
  status: string;
  version: number;
  feedback: string | null;
  generatedAt: Date | null;
  expiresAt: Date | null;
  deletedAt?: Date | null;
  createdAt?: Date;
  updatedAt: Date;
}

interface MemoryActionRow {
  actionType: string;
  resourceType: string;
  resourceId?: string | null;
  metadata?: unknown;
}

interface ChatMessageSummaryRow {
  role: string;
  content: string;
}

function publicMemory(row: MemoryRecordRow) {
  return {
    id: row.id, topic: row.topic, category: row.category, content: row.normalizedContent,
    importance: row.importance, source: row.source,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
  };
}

function publicCandidate(row: MemoryCandidateRow) {
  return {
    id: row.id, sourceMessageId: row.sourceMessageId, proposedContent: row.proposedContent,
    topic: row.topic, status: row.status.toLowerCase(), expiresAt: row.expiresAt?.toISOString() ?? null,
    reviewedAt: row.reviewedAt?.toISOString() ?? null, createdAt: row.createdAt.toISOString(),
  };
}

function publicSummary(row: MemorySummaryRow | null | undefined, now = new Date()) {
  if (!row || row.deletedAt || (row.expiresAt && row.expiresAt <= now)) return null;
  return {
    content: row.content, status: row.status.toLowerCase(), version: row.version, feedback: row.feedback,
    generatedAt: row.generatedAt?.toISOString() ?? null, expiresAt: row.expiresAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function fingerprint(value: unknown): string {
  const ordered = Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)));
  return createHash("sha256").update(JSON.stringify(ordered)).digest("hex");
}

export class MemoryService {
  readonly #transaction: Transaction;

  constructor(private readonly options: MemoryServiceOptions) {
    if (!options.transaction && !options.client) throw new Error("MemoryService requires a transaction boundary");
    this.#transaction = options.transaction ?? ((work) => withP9Transaction(options.client!, async (tx) => work(new P9Repositories(tx))));
  }

  async getSettings(userId: string) {
    const row = await this.options.repositories.userSettings.findUnique({ where: { userId }, select: { automaticMemoryCandidates: true } });
    if (!row) throw new P9Error("OWNERSHIP_DENIED", 404, "Memory settings not found");
    return { automaticMemoryCandidates: row.automaticMemoryCandidates };
  }

  updateSettings(userId: string, input: { automaticMemoryCandidates: boolean }, requestId?: string) {
    return this.#transaction(async (repositories) => {
      await repositories.lockUser(userId);
      const current = await repositories.userSettings.findUnique({ where: { userId }, select: { id: true } });
      if (!current) throw new P9Error("OWNERSHIP_DENIED", 404, "Memory settings not found");
      const updated = await repositories.userSettings.update({ where: { userId }, data: input });
      await this.#audit(repositories, userId, "MEMORY_SETTINGS_CHANGED", "memory_settings", updated.id, requestId);
      return { automaticMemoryCandidates: updated.automaticMemoryCandidates };
    });
  }

  async list(userId: string, input: { cursor?: string; limit: number }) {
    const cursor = input.cursor ? decodeMemoryCursor(input.cursor) : undefined;
    const now = new Date();
    const rows = await this.options.repositories.memoryRecord.findMany({
      where: {
        userId, deletedAt: null,
        AND: [
          { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
          ...(cursor ? [{ OR: [{ updatedAt: { lt: cursor.at } }, { updatedAt: cursor.at, id: { gt: cursor.id } }] }] : []),
        ],
      },
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }], take: input.limit + 1,
    });
    const hasMore = rows.length > input.limit;
    const visible = hasMore ? rows.slice(0, input.limit) : rows;
    const last = visible.at(-1);
    return {
      memories: visible.map(publicMemory),
      nextCursor: hasMore && last ? encodeMemoryCursor({ at: last.updatedAt, id: last.id }) : null,
    };
  }

  async get(userId: string, memoryId: string) {
    const row = await this.options.repositories.memoryRecord.findFirst({
      where: { id: memoryId, userId, deletedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
    });
    if (!row) throw new P9Error("OWNERSHIP_DENIED", 404, "Memory not found");
    return publicMemory(row);
  }

  update(userId: string, memoryId: string, input: PatchInput, requestId?: string) {
    return this.#transaction(async (repositories) => {
      await repositories.lockUser(userId);
      const existing = await this.#action(repositories, userId, input.idempotencyKey);
      if (existing) {
        this.#assertAction(existing, "EDIT", "memory", memoryId);
        this.#assertFingerprint(existing, input);
        return this.#ownedMemory(repositories, userId, memoryId);
      }
      await this.#ownedMemory(repositories, userId, memoryId);
      if (input.topic !== undefined) await this.#assertTopicNotForgotten(repositories, userId, input.topic);
      const data = {
        ...(input.topic === undefined ? {} : { topic: input.topic }),
        ...(input.category === undefined ? {} : { category: input.category }),
        ...(input.normalizedContent === undefined ? {} : { normalizedContent: input.normalizedContent }),
        ...(input.importance === undefined ? {} : { importance: input.importance }),
        ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt === null ? null : new Date(input.expiresAt) }),
      };
      const changed = await repositories.memoryRecord.updateMany({ where: { id: memoryId, userId, deletedAt: null }, data });
      if (changed.count !== 1) throw new P9Error("OWNERSHIP_DENIED", 404, "Memory not found");
      await repositories.memoryAction.create({ data: { userId, actionType: "EDIT", resourceType: "memory", resourceId: memoryId, idempotencyKey: input.idempotencyKey, metadata: { fingerprint: fingerprint(input) } } });
      await this.#audit(repositories, userId, "MEMORY_EDITED", "memory", memoryId, requestId);
      return this.#ownedMemory(repositories, userId, memoryId);
    });
  }

  async delete(userId: string, memoryId: string, idempotencyKey: string, requestId?: string): Promise<void> {
    await this.#transaction(async (repositories) => {
      await repositories.lockUser(userId);
      const existing = await this.#action(repositories, userId, idempotencyKey);
      if (existing) { this.#assertAction(existing, "DELETE", "memory", memoryId); return; }
      await this.#ownedMemory(repositories, userId, memoryId);
      const now = await repositories.databaseNow();
      const changed = await repositories.memoryRecord.updateMany({ where: { id: memoryId, userId, deletedAt: null }, data: { deletedAt: now } });
      if (changed.count !== 1) throw new P9Error("OWNERSHIP_DENIED", 404, "Memory not found");
      await repositories.memoryAction.create({ data: { userId, actionType: "DELETE", resourceType: "memory", resourceId: memoryId, idempotencyKey, metadata: {} } });
      await this.#audit(repositories, userId, "MEMORY_DELETED", "memory", memoryId, requestId);
    });
  }

  async listCandidates(userId: string, input: { cursor?: string; limit: number }) {
    const cursor = input.cursor ? decodeMemoryCursor(input.cursor) : undefined;
    const now = new Date();
    const rows = await this.options.repositories.memoryCandidate.findMany({
      where: {
        userId, status: "PENDING",
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        ...(cursor ? { AND: [{ OR: [{ createdAt: { lt: cursor.at } }, { createdAt: cursor.at, id: { gt: cursor.id } }] }] } : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }], take: input.limit + 1,
    });
    const hasMore = rows.length > input.limit;
    const visible = hasMore ? rows.slice(0, input.limit) : rows;
    const last = visible.at(-1);
    return { candidates: visible.map(publicCandidate), nextCursor: hasMore && last ? encodeMemoryCursor({ at: last.createdAt, id: last.id }) : null };
  }

  acceptCandidate(userId: string, candidateId: string, input: AcceptInput, requestId?: string) {
    return this.#transaction(async (repositories) => {
      await repositories.lockUser(userId);
      const existing = await this.#action(repositories, userId, input.idempotencyKey);
      if (existing) {
        this.#assertAction(existing, "ACCEPT", "memory_candidate", undefined, candidateId);
        this.#assertFingerprint(existing, input);
        const metadata = existing.metadata && typeof existing.metadata === "object" && !Array.isArray(existing.metadata)
          ? existing.metadata as Record<string, unknown> : {};
        if (typeof metadata.memoryId !== "string") throw new P9Error("CONFLICT", 409, "Idempotency replay is unavailable");
        return this.#ownedMemory(repositories, userId, metadata.memoryId);
      }
      const candidate = await this.#ownedPendingCandidate(repositories, userId, candidateId);
      const effectiveTopic = candidate.topic ?? "general";
      await this.#assertTopicNotForgotten(repositories, userId, effectiveTopic);
      const now = await repositories.databaseNow();
      const memory = await repositories.memoryRecord.create({ data: {
        userId, topic: effectiveTopic, category: input.category ?? "general",
        normalizedContent: candidate.proposedContent, importance: input.importance ?? 50,
        source: "candidate", expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
      } });
      const changed = await repositories.memoryCandidate.updateMany({ where: { id: candidateId, userId, status: "PENDING" }, data: { status: "ACCEPTED", reviewedAt: now } });
      if (changed.count !== 1) throw new P9Error("CONFLICT", 409, "Memory candidate was already reviewed");
      await repositories.memoryAction.create({ data: { userId, actionType: "ACCEPT", resourceType: "memory_candidate", resourceId: candidateId, idempotencyKey: input.idempotencyKey, metadata: { candidateId, memoryId: memory.id, fingerprint: fingerprint(input) } } });
      await this.#audit(repositories, userId, "MEMORY_CANDIDATE_ACCEPTED", "memory_candidate", candidateId, requestId);
      return publicMemory(memory);
    });
  }

  rejectCandidate(userId: string, candidateId: string, input: ActionInput, requestId?: string) {
    return this.#transaction(async (repositories) => {
      await repositories.lockUser(userId);
      const existing = await this.#action(repositories, userId, input.idempotencyKey);
      if (existing) {
        this.#assertAction(existing, "REJECT", "memory_candidate", candidateId);
        return this.#ownedCandidate(repositories, userId, candidateId);
      }
      await this.#ownedPendingCandidate(repositories, userId, candidateId);
      const now = await repositories.databaseNow();
      const changed = await repositories.memoryCandidate.updateMany({ where: { id: candidateId, userId, status: "PENDING" }, data: { status: "REJECTED", reviewedAt: now } });
      if (changed.count !== 1) throw new P9Error("CONFLICT", 409, "Memory candidate was already reviewed");
      await repositories.memoryAction.create({ data: { userId, actionType: "REJECT", resourceType: "memory_candidate", resourceId: candidateId, idempotencyKey: input.idempotencyKey, metadata: {} } });
      await this.#audit(repositories, userId, "MEMORY_CANDIDATE_REJECTED", "memory_candidate", candidateId, requestId);
      return this.#ownedCandidate(repositories, userId, candidateId);
    });
  }

  forgetTopic(userId: string, input: ActionInput & { topic: string }, requestId?: string) {
    return this.#transaction(async (repositories) => {
      await repositories.lockUser(userId);
      const normalizedTopic = input.topic.normalize("NFKC").trim().toLowerCase();
      const existing = await this.#action(repositories, userId, input.idempotencyKey);
      if (existing) {
        this.#assertAction(existing, "FORGET_TOPIC", "memory_topic", undefined, normalizedTopic);
        return this.#counts(existing.metadata, { forgotten: 0, rejectedCandidates: 0, topic: normalizedTopic });
      }
      const now = await repositories.databaseNow();
      const forgotten = await repositories.memoryRecord.updateMany({ where: { userId, deletedAt: null, topic: { equals: normalizedTopic, mode: "insensitive" } }, data: { deletedAt: now } });
      const candidateTopic = { equals: normalizedTopic, mode: "insensitive" as const };
      const rejected = await repositories.memoryCandidate.updateMany({
        where: {
          userId,
          status: "PENDING",
          ...(normalizedTopic === "general"
            ? { OR: [{ topic: candidateTopic }, { topic: null }] }
            : { topic: candidateTopic }),
        },
        data: { status: "REJECTED", reviewedAt: now },
      });
      await repositories.memoryTopicForget.create({ data: { userId, normalizedTopic, idempotencyKey: input.idempotencyKey } });
      const result = { forgotten: forgotten.count, rejectedCandidates: rejected.count, topic: normalizedTopic };
      await repositories.memoryAction.create({ data: { userId, actionType: "FORGET_TOPIC", resourceType: "memory_topic", resourceId: null, idempotencyKey: input.idempotencyKey, metadata: result } });
      await this.#audit(repositories, userId, "MEMORY_TOPIC_FORGOTTEN", "memory_topic", undefined, requestId, { count: forgotten.count });
      return result;
    });
  }

  clearAll(userId: string, input: ActionInput, requestId?: string) {
    return this.#transaction(async (repositories) => {
      await repositories.lockUser(userId);
      const existing = await this.#action(repositories, userId, input.idempotencyKey);
      if (existing) { this.#assertAction(existing, "CLEAR_ALL", "memory_collection"); return this.#counts(existing.metadata, { cleared: 0, rejectedCandidates: 0, summaryDeleted: false }); }
      const now = await repositories.databaseNow();
      const cleared = await repositories.memoryRecord.updateMany({ where: { userId, deletedAt: null }, data: { deletedAt: now } });
      const rejected = await repositories.memoryCandidate.updateMany({ where: { userId, status: "PENDING" }, data: { status: "REJECTED", reviewedAt: now } });
      const summary = await repositories.memorySummary.updateMany({ where: { userId, deletedAt: null }, data: { deletedAt: now } });
      const result = { cleared: cleared.count, rejectedCandidates: rejected.count, summaryDeleted: summary.count === 1 };
      await repositories.memoryAction.create({ data: { userId, actionType: "CLEAR_ALL", resourceType: "memory_collection", resourceId: null, idempotencyKey: input.idempotencyKey, metadata: result } });
      await this.#audit(repositories, userId, "MEMORIES_CLEARED", "memory_collection", undefined, requestId, { count: cleared.count });
      return result;
    });
  }

  export(userId: string, input: ActionInput, requestId?: string) {
    return this.#transaction(async (repositories) => {
      await repositories.lockUser(userId);
      const existing = await this.#action(repositories, userId, input.idempotencyKey);
      if (existing) this.#assertAction(existing, "EXPORT", "memory_collection");
      const now = await repositories.databaseNow();
      const [memories, candidates, actions, topicForgets, summary] = await Promise.all([
        repositories.memoryRecord.findMany({ where: { userId, deletedAt: null, AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }] }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
        repositories.memoryCandidate.findMany({ where: { userId, status: "PENDING", OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
        repositories.memoryAction.findMany({ where: { userId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
        repositories.memoryTopicForget.findMany({ where: { userId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
        repositories.memorySummary.findFirst({
          where: {
            userId,
            deletedAt: null,
            OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
          },
        }),
      ]);
      if (!existing) {
        await repositories.memoryAction.create({ data: { userId, actionType: "EXPORT", resourceType: "memory_collection", resourceId: null, idempotencyKey: input.idempotencyKey, metadata: {} } });
        await this.#audit(repositories, userId, "MEMORIES_EXPORTED", "memory_collection", undefined, requestId, { count: memories.length });
      }
      return {
        format: "json", exportedAt: now.toISOString(), memories: memories.map(publicMemory),
        candidates: candidates.map(publicCandidate),
        actions: actions.map((row: MemoryActionRow & { createdAt: Date }) => ({ actionType: row.actionType.toLowerCase(), resourceType: row.resourceType, resourceId: row.resourceId, createdAt: row.createdAt.toISOString() })),
        topicForgets: topicForgets.map((row: { normalizedTopic: string; createdAt: Date }) => ({ topic: row.normalizedTopic, createdAt: row.createdAt.toISOString() })),
        summary: publicSummary(summary, now),
      };
    });
  }

  async getSummary(userId: string) {
    const row = await this.options.repositories.memorySummary.findUnique({ where: { userId } });
    if (!row || row.deletedAt || (row.expiresAt && row.expiresAt <= new Date())) return { summary: null };
    return { summary: publicSummary(row, new Date()) };
  }

  async regenerateSummary(userId: string, input: ActionInput, requestId?: string) {
    const existing = await this.options.repositories.memoryAction.findUnique({
      where: { userId_idempotencyKey: { userId, idempotencyKey: input.idempotencyKey } },
    });
    if (existing) {
      this.#assertAction(existing, "SUMMARY_REGENERATE", "memory_summary");
      const current = await this.options.repositories.memorySummary.findUnique({ where: { userId } });
      if (!current || current.deletedAt) throw new P9Error("OWNERSHIP_DENIED", 404, "Memory summary not found");
      const metadata = existing.metadata && typeof existing.metadata === "object" && !Array.isArray(existing.metadata)
        ? existing.metadata as Record<string, unknown>
        : {};
      const runtimeStatus = typeof metadata.status === "string" ? metadata.status : "completed";
      return { summary: publicSummary(current), generation: { source: "memory_records", runtimeStatus } };
    }

    const { synthesizedContent, runtimeStatus } = await this.#synthesizeContent(this.options.repositories, userId);

    return this.#transaction(async (repositories) => {
      await repositories.lockUser(userId);
      const concurrent = await this.#action(repositories, userId, input.idempotencyKey);
      if (concurrent) {
        this.#assertAction(concurrent, "SUMMARY_REGENERATE", "memory_summary");
        const current = await repositories.memorySummary.findUnique({ where: { userId } });
        if (!current || current.deletedAt) throw new P9Error("OWNERSHIP_DENIED", 404, "Memory summary not found");
        return { summary: publicSummary(current), generation: { source: "memory_records", runtimeStatus } };
      }

      const now = await repositories.databaseNow();
      const summary = await repositories.memorySummary.upsert({
        where: { userId },
        update: {
          status: "READY",
          content: synthesizedContent,
          feedback: null,
          generatedAt: now,
          deletedAt: null,
          expiresAt: null,
          version: { increment: 1 },
        },
        create: {
          userId,
          status: "READY",
          content: synthesizedContent,
          feedback: null,
          generatedAt: now,
          version: 1,
        },
      });

      await repositories.memoryAction.create({
        data: {
          userId,
          actionType: "SUMMARY_REGENERATE",
          resourceType: "memory_summary",
          resourceId: summary.id ?? null,
          idempotencyKey: input.idempotencyKey,
          metadata: { status: runtimeStatus },
        },
      });
      await this.#audit(repositories, userId, "MEMORY_SUMMARY_REGENERATED", "memory_summary", summary.id, requestId, { status: runtimeStatus });
      return { summary: publicSummary(summary), generation: { source: "memory_records", runtimeStatus } };
    });
  }

  async setSummaryFeedback(userId: string, input: ActionInput & { feedback: string }, requestId?: string) {
    const existing = await this.options.repositories.memoryAction.findUnique({
      where: { userId_idempotencyKey: { userId, idempotencyKey: input.idempotencyKey } },
    });
    if (existing) {
      this.#assertAction(existing, "SUMMARY_FEEDBACK", "memory_summary");
      this.#assertFingerprint(existing, input);
      return this.getSummary(userId);
    }

    const { synthesizedContent, runtimeStatus } = await this.#synthesizeContent(this.options.repositories, userId, { instruction: input.feedback });

    return this.#transaction(async (repositories) => {
      await repositories.lockUser(userId);
      const concurrent = await this.#action(repositories, userId, input.idempotencyKey);
      if (concurrent) {
        this.#assertAction(concurrent, "SUMMARY_FEEDBACK", "memory_summary");
        this.#assertFingerprint(concurrent, input);
        return this.getSummary(userId);
      }

      const now = await repositories.databaseNow();
      const summary = await repositories.memorySummary.upsert({
        where: { userId },
        update: {
          status: "READY",
          content: synthesizedContent,
          feedback: input.feedback,
          generatedAt: now,
          deletedAt: null,
          expiresAt: null,
          version: { increment: 1 },
        },
        create: {
          userId,
          status: "READY",
          content: synthesizedContent,
          feedback: input.feedback,
          generatedAt: now,
          version: 1,
        },
      });

      await repositories.memoryAction.create({
        data: {
          userId,
          actionType: "SUMMARY_FEEDBACK",
          resourceType: "memory_summary",
          resourceId: summary.id ?? null,
          idempotencyKey: input.idempotencyKey,
          metadata: { fingerprint: fingerprint(input), status: runtimeStatus },
        },
      });
      await this.#audit(repositories, userId, "MEMORY_SUMMARY_FEEDBACK_UPDATED", "memory_summary", summary.id, requestId);
      return { summary: publicSummary(summary) };
    });
  }

  async #synthesizeContent(
    repositories: P9Repositories,
    userId: string,
    options: { instruction?: string } = {},
  ): Promise<{ synthesizedContent: string; runtimeStatus: string }> {
    const now = new Date();
    const [user, personalization, memoryRecords, currentSummary, recentChats] = await Promise.all([
      repositories.user.findUnique({ where: { id: userId }, select: { displayName: true, username: true } }).catch(() => null),
      repositories.personalizationSettings.findUnique({ where: { userId }, select: { customInstructions: true, baseStyleTone: true, warmth: true, enthusiasm: true } }).catch(() => null),
      repositories.memoryRecord.findMany({
        where: { userId, deletedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
        orderBy: [{ importance: "desc" }, { updatedAt: "desc" }],
        take: 30,
      }),
      repositories.memorySummary.findUnique({ where: { userId } }),
      repositories.chatMessage.findMany({
        where: { userId, deletedAt: null },
        orderBy: { createdAt: "desc" },
        take: 60,
      }).catch(() => []),
    ]);

    const contextPayload = {
      user: {
        displayName: user?.displayName ?? null,
        username: user?.username ?? null,
        customInstructions: personalization?.customInstructions || null,
      },
      storedMemoryRecords: memoryRecords.map((m) => ({
        topic: m.topic,
        category: m.category,
        content: m.normalizedContent,
        importance: m.importance,
      })),
      previousSummary: currentSummary?.content ?? null,
      userInstruction: options.instruction ?? null,
      recentChatTranscript: (recentChats ?? [])
        .slice()
        .reverse()
        .map((msg: ChatMessageSummaryRow) => `${msg.role}: ${msg.content}`)
        .join("\n"),
    };

    let synthesizedContent: string;
    let runtimeStatus = "completed";

    if (this.options.hermes) {
      try {
        const prompt = JSON.stringify(contextPayload, null, 2);
        const rawOutput = await this.options.hermes.generate(prompt, undefined, {
          conversation: `memory-dream:${userId}`,
          sessionKey: `bmo:user:${userId}`,
          instructions: BMO_DREAM_SYSTEM_INSTRUCTIONS,
          raw: true,
        });
        synthesizedContent = this.#formatDreamOutput(rawOutput, memoryRecords, user);
      } catch {
        synthesizedContent = this.#fallbackSynthesize(memoryRecords, user);
        runtimeStatus = "fallback";
      }
    } else {
      synthesizedContent = this.#fallbackSynthesize(memoryRecords, user);
      runtimeStatus = "not_configured";
    }

    return { synthesizedContent, runtimeStatus };
  }

  #formatDreamOutput(
    raw: string,
    memoryRecords: Array<{ topic?: string; category?: string; normalizedContent: string }>,
    user?: { displayName?: string | null } | null,
  ): string {
    const cleaned = raw
      .replace(/^```(?:markdown|md)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    if (!cleaned) {
      return this.#fallbackSynthesize(memoryRecords, user);
    }
    if (!cleaned.startsWith("## ")) {
      return `## Overview\n${cleaned}`;
    }
    return cleaned;
  }

  #fallbackSynthesize(
    memoryRecords: Array<{ topic?: string; category?: string; normalizedContent: string }>,
    user?: { displayName?: string | null } | null,
  ): string {
    const sections: string[] = [];
    if (user?.displayName) {
      sections.push(`## Profile & Identity\nNama kamu ${user.displayName}.`);
    }
    if (memoryRecords.length > 0) {
      const facts = memoryRecords.map((m) => `- ${m.normalizedContent}`).join("\n");
      sections.push(`## Preferences & Interests\n${facts}`);
    } else if (!user?.displayName) {
      sections.push("## Overview\nJoy siap mengingat hal-hal tentang kamu.");
    }
    return sections.join("\n\n");
  }

  async #ownedMemory(repositories: P9Repositories, userId: string, id: string) {
    const row = await repositories.memoryRecord.findFirst({ where: { id, userId, deletedAt: null } });
    if (!row) throw new P9Error("OWNERSHIP_DENIED", 404, "Memory not found");
    return publicMemory(row);
  }

  async #ownedPendingCandidate(repositories: P9Repositories, userId: string, id: string) {
    const row = await repositories.memoryCandidate.findFirst({ where: { id, userId, status: "PENDING", OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] } });
    if (!row) throw new P9Error("OWNERSHIP_DENIED", 404, "Memory candidate not found");
    return row;
  }

  async #ownedCandidate(repositories: P9Repositories, userId: string, id: string) {
    const row = await repositories.memoryCandidate.findFirst({ where: { id, userId } });
    if (!row) throw new P9Error("OWNERSHIP_DENIED", 404, "Memory candidate not found");
    return publicCandidate(row);
  }

  #action(repositories: P9Repositories, userId: string, idempotencyKey: string) {
    return repositories.memoryAction.findUnique({ where: { userId_idempotencyKey: { userId, idempotencyKey } } });
  }

  async #assertTopicNotForgotten(repositories: P9Repositories, userId: string, topic: string): Promise<void> {
    const forgotten = await repositories.memoryTopicForget.findMany({
      where: { userId, normalizedTopic: topic.normalize("NFKC").trim().toLowerCase() },
      take: 1,
      select: { id: true },
    });
    if (forgotten.length > 0) throw new P9Error("CONFLICT", 409, "Memory topic was forgotten");
  }

  #assertAction(action: MemoryActionRow, type: string, resourceType: string, resourceId?: string, metadataIdentity?: string): void {
    const metadata = action.metadata && typeof action.metadata === "object" && !Array.isArray(action.metadata)
      ? action.metadata as Record<string, unknown>
      : {};
    if (action.actionType !== type || action.resourceType !== resourceType ||
      (resourceId !== undefined && action.resourceId !== resourceId) ||
      (metadataIdentity !== undefined && metadata.candidateId !== metadataIdentity && metadata.topic !== metadataIdentity)) {
      throw new P9Error("CONFLICT", 409, "Idempotency key was already used for different input");
    }
  }

  #assertFingerprint(action: MemoryActionRow, input: unknown, requireExisting = true): void {
    const metadata = action.metadata && typeof action.metadata === "object" && !Array.isArray(action.metadata)
      ? action.metadata as Record<string, unknown>
      : {};
    if ((requireExisting || metadata.fingerprint !== undefined) && metadata.fingerprint !== fingerprint(input)) {
      throw new P9Error("CONFLICT", 409, "Idempotency key was already used for different input");
    }
  }

  #counts<T extends object>(metadata: unknown, fallback: T): T {
    return metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata as T : fallback;
  }

  #audit(repositories: P9Repositories, userId: string, eventType: string, resourceType: string, resourceId?: string, requestId?: string, metadata?: unknown) {
    return new AuditService(repositories).record({
      eventType, outcome: "success", actorType: "user", resourceType, userId,
      ...(resourceId === undefined ? {} : { resourceId }),
      ...(requestId === undefined ? {} : { context: { requestId } }),
      ...(metadata === undefined ? {} : { metadata }),
    });
  }
}
