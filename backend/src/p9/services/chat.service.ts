import { randomUUID } from "node:crypto";

import type { PrismaClient } from "../../generated/prisma/client.js";
import { ChatFeedbackRating } from "../../generated/prisma/enums.js";
import type { HermesGenerateClient } from "../../services/hermes.client.js";
import { sanitizeHermesOutput } from "../../services/hermes.client.js";
import { withP9Transaction } from "../db/client.js";
import { P9Repositories } from "../db/repositories.js";
import { P9Error } from "../errors.js";
import type { MobileOutboundEvent } from "../websocket/mobile-events.js";
import { AuditService } from "./audit.service.js";

export interface ChatMemoryContextProvider {
  search(userId: string, query: string, limit: number): Promise<readonly string[]>;
}

export class EmptyChatMemoryContextProvider implements ChatMemoryContextProvider {
  async search(_userId: string, _query: string, _limit: number): Promise<readonly string[]> {
    return [];
  }
}

export interface MobileEventPublisher {
  sendToUser(userId: string, event: MobileOutboundEvent): number;
}

export interface ChatSessionInput {
  temporary: boolean;
}

export interface ChatMessageInput {
  idempotencyKey: string;
  text: string;
  speakOnDevice: boolean;
  deviceId?: string;
}

export interface ChatFeedbackInput {
  rating: "positive" | "negative";
  reason?: string;
}

interface QueueReservation {
  commit(key: string, job: () => Promise<void>): void;
  release(): void;
}

export class BoundedChatQueue {
  readonly #waiting: Array<{ key: string; job: () => Promise<void> }> = [];
  readonly #idleWaiters = new Set<() => void>();
  readonly #activeKeys = new Set<string>();
  #active = 0;
  #reserved = 0;
  #closed = false;

  constructor(private readonly maxConcurrent: number, private readonly maxPending: number) {}

  reserve(): QueueReservation | null {
    if (this.#closed || this.#active + this.#waiting.length + this.#reserved >= this.maxConcurrent + this.maxPending) {
      return null;
    }
    this.#reserved += 1;
    let consumed = false;
    return {
      commit: (key, job) => {
        if (consumed) throw new Error("chat queue reservation already consumed");
        consumed = true;
        this.#reserved -= 1;
        this.#waiting.push({ key, job });
        this.#drain();
      },
      release: () => {
        if (consumed) return;
        consumed = true;
        this.#reserved -= 1;
        this.#resolveIdle();
      },
    };
  }

  async waitForIdle(): Promise<void> {
    if (this.#active === 0 && this.#waiting.length === 0 && this.#reserved === 0) return;
    await new Promise<void>((resolve) => this.#idleWaiters.add(resolve));
  }

  async close(): Promise<void> {
    this.#closed = true;
    await this.waitForIdle();
  }

  #drain(): void {
    while (this.#active < this.maxConcurrent) {
      const index = this.#waiting.findIndex(({ key }) => !this.#activeKeys.has(key));
      if (index < 0) break;
      const [entry] = this.#waiting.splice(index, 1);
      if (!entry) break;
      this.#active += 1;
      this.#activeKeys.add(entry.key);
      void entry.job().catch(() => undefined).finally(() => {
        this.#active -= 1;
        this.#activeKeys.delete(entry.key);
        this.#drain();
        this.#resolveIdle();
      });
    }
  }

  #resolveIdle(): void {
    if (this.#active !== 0 || this.#waiting.length !== 0 || this.#reserved !== 0) return;
    for (const resolve of this.#idleWaiters) resolve();
    this.#idleWaiters.clear();
  }
}

class KeyedChatQueue {
  readonly #tails = new Map<string, Promise<void>>();

  async run<T>(key: string, work: () => Promise<T>): Promise<T> {
    const previous = this.#tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    const tail = previous.catch(() => undefined).then(() => current);
    this.#tails.set(key, tail);
    await previous;
    try {
      return await work();
    } finally {
      release();
      if (this.#tails.get(key) === tail) this.#tails.delete(key);
    }
  }
}

interface ChatServiceOptions {
  client?: PrismaClient;
  repositories: P9Repositories;
  transaction?: <T>(work: (repositories: P9Repositories) => Promise<T>) => Promise<T>;
  hermes: HermesGenerateClient;
  mobileEvents: MobileEventPublisher;
  memoryContext?: ChatMemoryContextProvider;
  hardTimeoutMs: number;
  maxConcurrent?: number;
  maxPending?: number;
}

interface AcceptedMessage {
  userMessage: { id: string; sender: "user"; text: string; createdAt: string };
  assistant: {
    status: "processing" | "succeeded" | "failed" | "cancelled";
    operationId: string;
    errorCode?: string;
  };
}

export interface ChatJob {
  userId: string;
  sessionId: string;
  userMessageId: string;
  operationId: string;
  text: string;
  requestId?: string;
}

function publicMessage(message: { id: string; role: string; content: string; createdAt: Date; cursor?: bigint }):
  { id: string; sender: "user" | "assistant" | "system"; text: string; createdAt: string; cursor?: string } {
  const sender = message.role === "ASSISTANT" ? "assistant" : message.role === "SYSTEM" ? "system" : "user";
  return {
    id: message.id,
    sender,
    text: message.content,
    createdAt: message.createdAt.toISOString(),
    ...(message.cursor === undefined ? {} : { cursor: message.cursor.toString() }),
  };
}

function publicSession(session: {
  id: string;
  temporary: boolean;
  title: string | null;
  lastMessageAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: session.id,
    temporary: session.temporary,
    title: session.title,
    lastMessageAt: session.lastMessageAt?.toISOString() ?? null,
    createdAt: session.createdAt.toISOString(),
    updatedAt: session.updatedAt.toISOString(),
  };
}

function operationStatus(status: string): AcceptedMessage["assistant"]["status"] {
  if (status === "SUCCEEDED") return "succeeded";
  if (status === "FAILED") return "failed";
  if (status === "CANCELLED") return "cancelled";
  return "processing";
}

export class ChatService {
  readonly #transaction: <T>(work: (repositories: P9Repositories) => Promise<T>) => Promise<T>;
  readonly #memory: ChatMemoryContextProvider;
  readonly #queue: BoundedChatQueue;
  readonly #sessionQueue = new KeyedChatQueue();
  readonly #activeControllers = new Map<string, AbortController>();
  #recoveryFlight: Promise<number> | null = null;

  constructor(private readonly options: ChatServiceOptions) {
    if (!options.transaction && !options.client) throw new Error("ChatService requires a transaction boundary");
    this.#transaction = options.transaction ?? ((work) => withP9Transaction(options.client!, async (tx) => work(new P9Repositories(tx))));
    this.#memory = options.memoryContext ?? new EmptyChatMemoryContextProvider();
    this.#queue = new BoundedChatQueue(options.maxConcurrent ?? 2, options.maxPending ?? 64);
  }

  async listSessions(userId: string) {
    const sessions = await this.options.repositories.chatSession.findMany({
      where: { userId, status: "ACTIVE", deletedAt: null, temporary: false },
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      take: 100,
    });
    return { sessions: sessions.map(publicSession) };
  }

  async createSession(userId: string, input: ChatSessionInput, requestId?: string) {
    return this.#transaction(async (repositories) => {
      await repositories.lockUser(userId);
      const session = await repositories.chatSession.create({ data: { userId, temporary: input.temporary } });
      await new AuditService(repositories).record({
        eventType: "CHAT_SESSION_CREATED", outcome: "success", actorType: "user",
        resourceType: "chat_session", resourceId: session.id, userId,
        ...(requestId === undefined ? {} : { context: { requestId } }),
      });
      return publicSession(session);
    });
  }

  async listMessages(userId: string, sessionId: string, options: { cursor?: string; limit: number }) {
    await this.#requireOwnedSession(this.options.repositories, userId, sessionId);
    const rows = await this.options.repositories.chatMessage.findMany({
      where: {
        userId, sessionId, deletedAt: null,
        ...(options.cursor === undefined ? {} : { cursor: { gt: BigInt(options.cursor) } }),
      },
      orderBy: { cursor: "asc" },
      take: options.limit + 1,
    });
    const hasMore = rows.length > options.limit;
    const visible = hasMore ? rows.slice(0, options.limit) : rows;
    return {
      messages: visible.map(publicMessage),
      nextCursor: hasMore ? visible.at(-1)?.cursor.toString() ?? null : null,
    };
  }

  async submitMessage(
    userId: string,
    sessionId: string,
    input: ChatMessageInput,
    requestId?: string,
  ): Promise<AcceptedMessage> {
    if (input.speakOnDevice) {
      throw new P9Error("SERVICE_UNAVAILABLE", 503, "Physical proactive delivery is not available yet");
    }

    const discovered = await this.#findOperation(this.options.repositories, userId, input.idempotencyKey);
    if (discovered) return this.#existingResponse(discovered, sessionId, input);

    const reservation = this.#queue.reserve();
    if (!reservation) throw new P9Error("SERVICE_UNAVAILABLE", 503, "Chat processing queue is full");
    try {
      const accepted = await this.#transaction(async (repositories) => {
        await repositories.lockUser(userId);
        const existing = await this.#findOperation(repositories, userId, input.idempotencyKey);
        if (existing) return { response: this.#existingResponse(existing, sessionId, input), job: null, heuristicTitle: null, shouldGenerateTitle: false };
        const session = await this.#requireOwnedSession(repositories, userId, sessionId);
        if (input.deviceId) {
          const device = await repositories.device.findFirst({
            where: { id: input.deviceId, userId, status: "ACTIVE" }, select: { id: true },
          });
          if (!device) throw new P9Error("OWNERSHIP_DENIED", 404, "Device not found");
        }
        const userMessage = await repositories.chatMessage.create({
          data: {
            userId, sessionId, role: "USER", kind: "TEXT", content: input.text,
            idempotencyKey: input.idempotencyKey,
            ...(input.deviceId === undefined ? {} : { sourceDeviceId: input.deviceId }),
            metadata: { source: "mobile", speakOnDevice: false },
          },
        });
        const operation = await repositories.chatOperation.create({
          data: { userId, userMessageId: userMessage.id, idempotencyKey: input.idempotencyKey },
        });
        const isInitialTitle = session.title === null && !session.temporary;
        const heuristicTitle = isInitialTitle ? this.#generateHeuristicTitle(input.text) : undefined;
        await repositories.chatSession.update({
          where: { id: sessionId },
          data: {
            lastMessageCursor: userMessage.cursor,
            lastMessageAt: userMessage.createdAt,
            ...(heuristicTitle !== undefined ? { title: heuristicTitle } : {}),
          },
        });
        return {
          response: {
            userMessage: {
              id: userMessage.id,
              sender: "user" as const,
              text: userMessage.content,
              createdAt: userMessage.createdAt.toISOString(),
            },
            assistant: { status: "processing" as const, operationId: operation.id },
          },
          job: {
            userId, sessionId, userMessageId: userMessage.id, operationId: operation.id,
            text: input.text, ...(requestId === undefined ? {} : { requestId }),
          } satisfies ChatJob,
          heuristicTitle: heuristicTitle ?? null,
          shouldGenerateTitle: isInitialTitle,
        };
      });
      if (accepted.heuristicTitle) {
        this.#emit(userId, {
          event: "chat_title_updated",
          sessionId,
          title: accepted.heuristicTitle,
        });
      }
      if (accepted.shouldGenerateTitle) {
        void this.#generateTitleAsync(userId, sessionId, input.text);
      }
      if (accepted.job) reservation.commit(
        `${accepted.job.userId}:${accepted.job.sessionId}`,
        () => this.processAcceptedOperation(accepted.job!),
      );
      else reservation.release();
      return accepted.response;
    } catch (error) {
      reservation.release();
      throw error;
    }
  }

  async deleteSession(userId: string, sessionId: string, requestId?: string): Promise<void> {
    const cancelledOperationIds = await this.#transaction(async (repositories) => {
      await repositories.lockUser(userId);
      await this.#requireOwnedSession(repositories, userId, sessionId);
      const now = await repositories.databaseNow();
      const updated = await repositories.chatSession.updateMany({
        where: { id: sessionId, userId, status: "ACTIVE", deletedAt: null },
        data: { status: "DELETED", deletedAt: now },
      });
      if (updated.count !== 1) throw new P9Error("OWNERSHIP_DENIED", 404, "Chat session not found");
      const processing = await repositories.chatOperation.findMany({
        where: { userId, userMessage: { sessionId }, status: "PROCESSING" },
        select: { id: true },
      });
      await repositories.chatMessage.updateMany({
        where: { sessionId, userId, deletedAt: null }, data: { deletedAt: now },
      });
      await repositories.chatOperation.updateMany({
        where: { userId, userMessage: { sessionId }, status: "PROCESSING" },
        data: { status: "CANCELLED", errorCode: "SESSION_DELETED", completedAt: now },
      });
      await new AuditService(repositories).record({
        eventType: "CHAT_SESSION_DELETED", outcome: "success", actorType: "user",
        resourceType: "chat_session", resourceId: sessionId, userId,
        ...(requestId === undefined ? {} : { context: { requestId } }),
      });
      return processing.map((operation) => operation.id);
    });
    for (const operationId of cancelledOperationIds) this.#activeControllers.get(operationId)?.abort();
  }

  async setFeedback(userId: string, messageId: string, input: ChatFeedbackInput, requestId?: string) {
    return this.#transaction(async (repositories) => {
      await repositories.lockUser(userId);
      const message = await repositories.chatMessage.findFirst({
        where: { id: messageId, userId, role: "ASSISTANT", deletedAt: null }, select: { id: true },
      });
      if (!message) throw new P9Error("OWNERSHIP_DENIED", 404, "Chat message not found");
      const feedback = await repositories.chatMessageFeedback.upsert({
        where: { userId_messageId: { userId, messageId } },
        update: { rating: input.rating === "positive" ? ChatFeedbackRating.POSITIVE : ChatFeedbackRating.NEGATIVE, reason: input.reason ?? null },
        create: { userId, messageId, rating: input.rating === "positive" ? ChatFeedbackRating.POSITIVE : ChatFeedbackRating.NEGATIVE, reason: input.reason ?? null },
      });
      await new AuditService(repositories).record({
        eventType: "CHAT_MESSAGE_FEEDBACK_UPDATED", outcome: "success", actorType: "user",
        resourceType: "chat_message", resourceId: messageId, userId,
        ...(requestId === undefined ? {} : { context: { requestId } }),
      });
      return {
        messageId: feedback.messageId,
        rating: feedback.rating.toLowerCase(),
        reason: feedback.reason,
        updatedAt: feedback.updatedAt.toISOString(),
      };
    });
  }

  resumePending(): Promise<number> {
    if (this.#recoveryFlight) return this.#recoveryFlight;
    const flight = this.#resumePendingOnce();
    this.#recoveryFlight = flight;
    void flight.finally(() => {
      if (this.#recoveryFlight === flight) this.#recoveryFlight = null;
    }).catch(() => undefined);
    return flight;
  }

  async #resumePendingOnce(): Promise<number> {
    let resumed = 0;
    while (true) {
      const pending = await this.options.repositories.findClaimableChatOperations({
        leaseTtlMs: this.#leaseTtlMs(),
        limit: 64,
      });
      if (pending.length === 0) return resumed;
      let pageProgress = 0;
      for (const operation of pending) {
        const claimed = await this.#prepareRecoveredOperation({
          userId: operation.userId,
          sessionId: operation.userMessage.sessionId,
          userMessageId: operation.userMessageId,
          operationId: operation.id,
          text: operation.userMessage.content,
        });
        if (!claimed) continue;
        pageProgress += 1;
        resumed += 1;
      }
      if (pageProgress === 0) return resumed;
      await this.#queue.waitForIdle();
    }
  }

  waitForIdle(): Promise<void> {
    return this.#queue.waitForIdle();
  }

  close(): Promise<void> {
    return this.#queue.close();
  }

  processAcceptedOperation(job: ChatJob): Promise<void> {
    return this.#sessionQueue.run(`${job.userId}:${job.sessionId}`, () => this.#process(job));
  }

  async #prepareRecoveredOperation(job: ChatJob): Promise<boolean> {
    const leaseToken = `LEASE:${randomUUID()}`;
    if (!await this.#claim(job, leaseToken)) return false;
    let reservation = this.#queue.reserve();
    if (!reservation) {
      await this.#queue.waitForIdle();
      reservation = this.#queue.reserve();
    }
    if (!reservation) {
      await this.#releaseLease(job, leaseToken);
      return false;
    }
    reservation.commit(`${job.userId}:${job.sessionId}`, () =>
      this.#sessionQueue.run(`${job.userId}:${job.sessionId}`, () => this.#processClaimed(job, leaseToken)));
    return true;
  }

  async #process(job: ChatJob): Promise<void> {
    const leaseToken = `LEASE:${randomUUID()}`;
    const claimed = await this.#claim(job, leaseToken);
    if (!claimed) return;
    await this.#processClaimed(job, leaseToken);
  }

  async #processClaimed(job: ChatJob, leaseToken: string): Promise<void> {
    let controller: AbortController | undefined;
    try {
      const activeController = new AbortController();
      controller = activeController;
      this.#activeControllers.set(job.operationId, activeController);
      this.#emit(job.userId, { event: "chat_thinking", sessionId: job.sessionId, messageId: job.userMessageId });
      const prompt = await this.#buildContext(job);
      if (!await this.#renewLease(job, leaseToken)) return;
      let rejectDeadline!: (error: Error) => void;
      const deadline = new Promise<never>((_resolve, reject) => { rejectDeadline = reject; });
      const timer = setTimeout(() => {
        activeController.abort();
        rejectDeadline(new Error("Hermes hard deadline exceeded"));
      }, this.options.hardTimeoutMs);
      let raw: string;
      try {
        raw = await Promise.race([
          this.options.hermes.generate(prompt, activeController.signal, {
            conversation: `chat:${job.userId}:${job.sessionId}`,
            sessionKey: `bmo:user:${job.userId}`,
          }),
          deadline,
        ]);
      } finally {
        clearTimeout(timer);
      }
      const text = sanitizeHermesOutput(raw);
      const assistant = await this.#transaction(async (repositories) => {
        await repositories.lockUser(job.userId);
        const operation = await repositories.chatOperation.findFirst({
          where: { id: job.operationId, userId: job.userId, status: "PROCESSING", errorCode: leaseToken }, select: { id: true },
        });
        const session = await repositories.chatSession.findFirst({
          where: { id: job.sessionId, userId: job.userId, status: "ACTIVE", deletedAt: null }, select: { id: true, temporary: true },
        });
        if (!operation || !session) return null;
        const message = await repositories.chatMessage.create({
          data: {
            userId: job.userId, sessionId: job.sessionId, role: "ASSISTANT", kind: "TEXT", content: text,
            metadata: { source: "hermes", operationId: job.operationId },
          },
        });
        const completedAt = await repositories.databaseNow();
        await repositories.chatOperation.updateMany({
          where: { id: job.operationId, userId: job.userId, status: "PROCESSING", errorCode: leaseToken },
          data: { status: "SUCCEEDED", errorCode: null, completedAt },
        });
        await repositories.chatSession.update({
          where: { id: job.sessionId }, data: { lastMessageCursor: message.cursor, lastMessageAt: message.createdAt },
        });
        return { message, isTemporary: session.temporary };
      });
      if (assistant) {
        this.#emit(job.userId, {
          event: "chat_message", sessionId: job.sessionId,
          message: { id: assistant.message.id, sender: "assistant", text: assistant.message.content, createdAt: assistant.message.createdAt.toISOString() },
        });
        if (!assistant.isTemporary) {
          void this.#extractMemoriesAsync(job.userId, job.userMessageId, job.text, assistant.message.content);
        }
      }
    } catch {
      await this.#recordFailure(job, leaseToken);
    } finally {
      this.#activeControllers.delete(job.operationId);
    }
  }

  async #releaseLease(job: ChatJob, leaseToken: string): Promise<void> {
    await this.options.repositories.chatOperation.updateMany({
      where: { id: job.operationId, userId: job.userId, status: "PROCESSING", errorCode: leaseToken },
      data: { errorCode: null },
    });
  }

  async #claim(job: ChatJob, leaseToken: string): Promise<boolean> {
    return this.#transaction(async (repositories) => {
      await repositories.lockUser(job.userId);
      return repositories.claimChatOperation({
        operationId: job.operationId,
        userId: job.userId,
        sessionId: job.sessionId,
        leaseToken,
        leaseTtlMs: this.#leaseTtlMs(),
      });
    });
  }

  async #renewLease(job: ChatJob, leaseToken: string): Promise<boolean> {
    return this.#transaction(async (repositories) => {
      await repositories.lockUser(job.userId);
      await repositories.databaseNow();
      return repositories.renewChatOperationLease({
        operationId: job.operationId,
        userId: job.userId,
        sessionId: job.sessionId,
        leaseToken,
      });
    });
  }

  #leaseTtlMs(): number {
    return this.options.hardTimeoutMs + 30_000;
  }

  async #recordFailure(job: ChatJob, leaseToken: string): Promise<void> {
    try {
      await this.#transaction(async (repositories) => {
        await repositories.lockUser(job.userId);
        const now = await repositories.databaseNow();
        const updated = await repositories.chatOperation.updateMany({
          where: { id: job.operationId, userId: job.userId, status: "PROCESSING", errorCode: leaseToken },
          data: { status: "FAILED", errorCode: "HERMES_FAILED", completedAt: now },
        });
        if (updated.count !== 1) return;
        await new AuditService(repositories).record({
          eventType: "CHAT_OPERATION_FAILED", outcome: "failure", actorType: "system",
          resourceType: "chat_operation", resourceId: job.operationId, userId: job.userId,
          ...(job.requestId === undefined ? {} : { context: { requestId: job.requestId } }),
          metadata: { reason: "HERMES_FAILED" },
        });
      });
    } catch {
      // The durable PROCESSING row is intentionally recoverable on the next start.
    }
  }

  async #buildContext(job: ChatJob): Promise<string> {
    const session = await this.options.repositories.chatSession.findFirst({
      where: { id: job.sessionId, userId: job.userId, status: "ACTIVE", deletedAt: null },
      select: { temporary: true },
    });
    const isTemporary = session?.temporary ?? false;

    const [user, personalization, memory, recentDescending, identityRecords] = await Promise.all([
      this.options.repositories.user.findUnique({
        where: { id: job.userId }, select: { displayName: true, email: true },
      }),
      this.options.repositories.personalizationSettings.upsert({
        where: { userId: job.userId }, update: {}, create: { userId: job.userId },
      }),
      isTemporary ? Promise.resolve([]) : this.#memory.search(job.userId, job.text, 8),
      this.options.repositories.chatMessage.findMany({
        where: { userId: job.userId, sessionId: job.sessionId, deletedAt: null },
        orderBy: { cursor: "desc" }, take: 12,
        select: { role: true, content: true },
      }),
      !isTemporary && typeof this.options.repositories.searchActiveMemories === "function"
        ? this.options.repositories.searchActiveMemories({
            userId: job.userId,
            terms: ["name", "nama", "identity"],
            limit: 3,
          })
        : Promise.resolve([]),
    ]);

    let resolvedDisplayName: string | null = user?.displayName ?? null;
    if (!resolvedDisplayName && Array.isArray(identityRecords)) {
      for (const record of identityRecords) {
        const match = record.match(/(?:nama\s+(?:user\s+adalah|saya\s+adalah|saya|ku|adalah)|name\s+(?:is|:))\s+([^\n.,!?;]+)/i);
        if (match?.[1]?.trim()) {
          resolvedDisplayName = match[1].trim();
          break;
        } else if (record.trim() && record.length <= 60 && !record.includes("\n")) {
          resolvedDisplayName = record.trim();
          break;
        }
      }
    }

    const history = recentDescending.reverse().map((message) => ({
      role: message.role.toLowerCase(), content: message.content.slice(0, 4_000),
    }));
    return JSON.stringify({
      user: {
        displayName: resolvedDisplayName,
        email: user?.email ?? null,
      },
      currentMessage: job.text,
      personalization: {
        baseStyleTone: personalization.baseStyleTone,
        warmth: personalization.warmth,
        enthusiasm: personalization.enthusiasm,
        headerAndLists: personalization.headerAndLists,
        emoji: personalization.emoji,
        fastAnswers: personalization.fastAnswers,
        customInstructions: personalization.customInstructions,
      },
      memory: memory.slice(0, 8).map((item) => item.slice(0, 1_000)),
      history,
    });
  }

  #sanitizeTitle(raw: string): string {
    const cleaned = sanitizeHermesOutput(raw)
      .replace(/^[\s"“'«`#*]+|[\s"”'»`#*]+$/g, "")
      .replace(/^[Tt]itle\s*:\s*/i, "")
      .replace(/[\r\n\t]+/g, " ")
      .replace(/\s+/g, " ")
      .replace(/[.]+$/, "")
      .trim();
    return cleaned.slice(0, 80).trim();
  }

  #generateHeuristicTitle(userText: string): string {
    const firstLine = userText.trim().split(/\r?\n/)[0] ?? "";
    const cleaned = firstLine
      .replace(/[\r\n\t]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (cleaned.length === 0) return "New chat";
    return cleaned.length > 40 ? `${cleaned.slice(0, 37).trim()}...` : cleaned;
  }

  async #generateTitleAsync(
    userId: string,
    sessionId: string,
    userText: string,
  ): Promise<void> {
    try {
      const session = await this.options.repositories.chatSession.findFirst({
        where: { id: sessionId, userId, status: "ACTIVE", deletedAt: null },
        select: { id: true, title: true, temporary: true },
      });
      if (!session || session.temporary) {
        return;
      }

      const heuristicTitle = this.#generateHeuristicTitle(userText);
      let generatedTitle: string | null = null;
      try {
        const titlePrompt = `User message: ${userText.slice(0, 1000)}\n\nTitle:`;
        const titleInstructions = `You are a chat title generator. Generate a concise, descriptive title (3 to 5 words maximum) for a chat conversation that begins with the user message. Output ONLY the title text with no quotes, no markdown, and no punctuation. Use Indonesian if the user message is primarily Indonesian, or English if English.`;

        const controller = new AbortController();
        const timeoutMs = 15000;
        let rejectDeadline!: (error: Error) => void;
        const deadline = new Promise<never>((_resolve, reject) => { rejectDeadline = reject; });
        const timer = setTimeout(() => {
          controller.abort();
          rejectDeadline(new Error("Title generation deadline exceeded"));
        }, timeoutMs);

        try {
          const raw = await Promise.race([
            this.options.hermes.generate(titlePrompt, controller.signal, {
              conversation: `title-generate:${sessionId}`,
              sessionKey: `bmo:user:${userId}`,
              instructions: titleInstructions,
            }),
            deadline,
          ]);
          generatedTitle = this.#sanitizeTitle(raw);
        } finally {
          clearTimeout(timer);
        }
      } catch {
        // Fallback: heuristic title is already active in database
      }

      if (!generatedTitle || generatedTitle.length === 0 || generatedTitle === heuristicTitle || generatedTitle === session.title) {
        return;
      }

      const updated = await this.#transaction(async (repositories) => {
        await repositories.lockUser(userId);
        return repositories.chatSession.updateMany({
          where: { id: sessionId, userId, status: "ACTIVE", deletedAt: null },
          data: { title: generatedTitle },
        });
      });

      if (updated.count > 0) {
        this.#emit(userId, {
          event: "chat_title_updated",
          sessionId,
          title: generatedTitle,
        });
      }
    } catch {
      // Title generation is best-effort and must never disrupt chat delivery.
    }
  }

  async #extractMemoriesAsync(
    userId: string,
    userMessageId: string,
    userText: string,
    assistantText: string,
  ): Promise<void> {
    try {
      const trimmed = userText.trim();
      if (trimmed.length < 4) return;
      if (/^(hi|halo|hello|hai|hey|test|tes|ok|oke|okay|siap|makasih|thanks|thank you|bye|dadah)(\s+(bmo|friend|there|all|bro|sis))?[!.?]*$/i.test(trimmed)) {
        return;
      }

      const extractionPrompt = `You are a factual memory extraction engine for an AI companion.
Analyze this single conversational exchange between a User and Assistant.
Extract permanent or notable user facts, user preferences (e.g. favorite food, drinks, hobbies), user identity (name, job, location), relationships, or habits stated by the User.
Do NOT extract:
- Temporary states (e.g. "I am tired right now", "I am walking")
- Greetings, acknowledgments, or questions asked by the user with no user facts
- Assistant claims, personality traits, or assistant actions

Output MUST be a valid JSON array of objects with keys: "topic", "category", "normalizedContent", "importance".
- "topic": short lowercase string (e.g. "food_preference", "name", "job", "hobby", "location")
- "category": "preference" | "profile" | "habit" | "fact"
- "normalizedContent": concise statement of the fact in English or Indonesian (e.g. "Suka makan ayam", "Nama user adalah Rangga", "Lives in Jakarta")
- "importance": integer from 1 to 10

If NO user facts are present, output an empty JSON array: []

User: ${userText}
Assistant: ${assistantText}

JSON Array:`;

      let rawExtraction: string;
      try {
        rawExtraction = await this.options.hermes.generate(extractionPrompt, undefined, {
          conversation: `memory-extract:${userId}`,
          sessionKey: `bmo:user:${userId}`,
          instructions: "You are a factual memory extraction engine for an AI companion. Output only a valid JSON array of objects.",
        });
      } catch {
        return;
      }

      const cleaned = rawExtraction.replace(/```json/gi, "").replace(/```/g, "").trim();
      const match = cleaned.match(/\[[\s\S]*\]/);
      if (!match) return;

      let extractedItems: Array<{
        topic?: string;
        category?: string;
        normalizedContent?: string;
        importance?: number;
      }>;
      try {
        const parsed = JSON.parse(match[0]);
        if (!Array.isArray(parsed) || parsed.length === 0) return;
        extractedItems = parsed;
      } catch {
        return;
      }

      await this.#transaction(async (repositories) => {
        await repositories.lockUser(userId);

        const forgotten = await repositories.memoryTopicForget.findMany({
          where: { userId },
          select: { normalizedTopic: true },
        });
        const forgottenSet = new Set(forgotten.map((f: { normalizedTopic: string }) => f.normalizedTopic.toLowerCase().trim()));

        const existingRecords = await repositories.memoryRecord.findMany({
          where: { userId, deletedAt: null },
          select: { topic: true, normalizedContent: true },
        });

        for (const item of extractedItems) {
          if (!item || typeof item.normalizedContent !== "string" || !item.normalizedContent.trim()) {
            continue;
          }
          const topic = (typeof item.topic === "string" && item.topic.trim()) ? item.topic.trim().toLowerCase().slice(0, 120) : "general";
          if (forgottenSet.has(topic)) {
            continue;
          }

          const normalizedContent = item.normalizedContent.trim().slice(0, 1000);
          const category = (typeof item.category === "string" && item.category.trim()) ? item.category.trim().toLowerCase().slice(0, 64) : "fact";
          const importance = Math.max(1, Math.min(Math.round(Number(item.importance) || 5), 10));

          const isDuplicate = existingRecords.some((rec: { topic: string; normalizedContent: string }) =>
            rec.normalizedContent.toLowerCase().trim() === normalizedContent.toLowerCase().trim() ||
            (rec.topic.toLowerCase().trim() === topic && rec.normalizedContent.toLowerCase().includes(normalizedContent.toLowerCase()))
          );
          if (isDuplicate) {
            continue;
          }

          await repositories.memoryRecord.create({
            data: {
              userId,
              topic,
              category,
              normalizedContent,
              importance,
              source: "conversation",
            },
          });

          await repositories.memoryCandidate.create({
            data: {
              userId,
              sourceMessageId: userMessageId,
              proposedContent: normalizedContent,
              topic,
              status: "ACCEPTED",
            },
          });

          existingRecords.push({ topic, normalizedContent });
        }
      });
    } catch {
      // Memory extraction is best-effort and must never disrupt chat delivery.
    }
  }

  async #requireOwnedSession(repositories: P9Repositories, userId: string, sessionId: string) {
    const session = await repositories.chatSession.findFirst({
      where: { id: sessionId, userId, status: "ACTIVE", deletedAt: null },
    });
    if (!session) throw new P9Error("OWNERSHIP_DENIED", 404, "Chat session not found");
    return session;
  }

  async #findOperation(repositories: P9Repositories, userId: string, idempotencyKey: string) {
    return repositories.chatOperation.findUnique({
      where: { userId_idempotencyKey: { userId, idempotencyKey } }, include: { userMessage: true },
    });
  }

  #existingResponse(operation: any, sessionId: string, input: ChatMessageInput): AcceptedMessage {
    if (
      operation.userMessage.sessionId !== sessionId ||
      operation.userMessage.content !== input.text ||
      (operation.userMessage.sourceDeviceId ?? undefined) !== input.deviceId
    ) {
      throw new P9Error("CONFLICT", 409, "Idempotency key was already used for different input");
    }
    return {
      userMessage: {
        id: operation.userMessage.id,
        sender: "user",
        text: operation.userMessage.content,
        createdAt: operation.userMessage.createdAt.toISOString(),
      },
      assistant: {
        status: operationStatus(operation.status), operationId: operation.id,
        ...(operation.status !== "PROCESSING" && operation.errorCode ? { errorCode: operation.errorCode } : {}),
      },
    };
  }

  #emit(userId: string, event: MobileOutboundEvent): void {
    try { this.options.mobileEvents.sendToUser(userId, event); } catch { /* realtime is best effort */ }
  }
}
