import { describe, expect, it, vi } from "vitest";

import { P9Error } from "../../src/p9/errors.js";
import { BoundedChatQueue, ChatService } from "../../src/p9/services/chat.service.js";

const userId = "00000000-0000-4000-8000-000000000001";
const otherUserId = "00000000-0000-4000-8000-000000000002";
const sessionId = "00000000-0000-4000-8000-000000000010";
const operationId = "00000000-0000-4000-8000-000000000020";
const userMessageId = "00000000-0000-4000-8000-000000000030";
const assistantMessageId = "00000000-0000-4000-8000-000000000040";
const memoryId = "00000000-0000-4000-8000-000000000060";
const candidateId = "00000000-0000-4000-8000-000000000070";
const key = "00000000-0000-4000-8000-000000000050";
const now = new Date("2026-08-12T08:00:00.000Z");

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function fixture() {
  const state = {
    session: {
      id: sessionId, userId, temporary: false, title: "Existing conversation" as string | null, status: "ACTIVE",
      lastMessageAt: null as Date | null, createdAt: now, updatedAt: now, deletedAt: null,
    },
    messages: [] as any[],
    operation: null as any,
  };
  let nextMessage = 0;
  const repositories: any = {
    lockUser: vi.fn().mockResolvedValue(undefined),
    databaseNow: vi.fn().mockResolvedValue(now),
    claimChatOperation: vi.fn().mockResolvedValue(true),
    renewChatOperationLease: vi.fn(async () =>
      state.session.deletedAt === null && (!state.operation || state.operation.record.status === "PROCESSING")
    ),
    findClaimableChatOperations: vi.fn(),
    user: {
      findUnique: vi.fn().mockResolvedValue({ displayName: "Finn", email: "user@example.com" }),
    },
    chatSession: {
      findFirst: vi.fn(async ({ where }: any) =>
        where.id === state.session.id && where.userId === state.session.userId &&
        state.session.status === "ACTIVE" ? state.session : null),
      findMany: vi.fn(async ({ where }: any = {}) => {
        let rows = [state.session].filter((s) => s.deletedAt === null && s.status === "ACTIVE");
        if (where?.userId) rows = rows.filter((s) => s.userId === where.userId);
        if (where?.temporary !== undefined) rows = rows.filter((s) => s.temporary === where.temporary);
        return rows;
      }),
      create: vi.fn(),
      updateMany: vi.fn(async () => ({ count: 1 })),
      update: vi.fn(async ({ data }: any) => Object.assign(state.session, data)),
    },
    chatMessage: {
      findMany: vi.fn(async ({ where, orderBy, take }: any) => {
        let rows = state.messages.filter((message) =>
          message.userId === where.userId && message.sessionId === where.sessionId && message.deletedAt === null);
        if (where.cursor?.gt !== undefined) rows = rows.filter((message) => message.cursor > where.cursor.gt);
        rows.sort((a, b) => Number(a.cursor - b.cursor));
        if (orderBy?.cursor === "desc") rows.reverse();
        return rows.slice(0, take);
      }),
      create: vi.fn(async ({ data }: any) => {
        nextMessage += 1;
        const message = {
          id: nextMessage === 1 ? userMessageId : assistantMessageId,
          cursor: BigInt(nextMessage), createdAt: new Date(now.getTime() + nextMessage), deletedAt: null,
          ...data,
        };
        state.messages.push(message);
        return message;
      }),
      updateMany: vi.fn(async () => ({ count: state.messages.length })),
    },
    chatOperation: {
      findUnique: vi.fn(async ({ where }: any) => {
        if (!state.operation || state.operation.userId_idempotencyKey.userId !== where.userId_idempotencyKey.userId ||
          state.operation.userId_idempotencyKey.idempotencyKey !== where.userId_idempotencyKey.idempotencyKey) return null;
        return { ...state.operation.record, userMessage: state.messages.find((m) => m.id === state.operation.record.userMessageId) };
      }),
      findFirst: vi.fn(async ({ where }: any) =>
        state.operation?.record.id === where.id && state.operation.record.userId === where.userId &&
        state.operation.record.status === where.status ? state.operation.record : null),
      create: vi.fn(async ({ data }: any) => {
        const record = { id: operationId, status: "PROCESSING", errorCode: null, completedAt: null, ...data };
        state.operation = { userId_idempotencyKey: { userId: data.userId, idempotencyKey: data.idempotencyKey }, record };
        return record;
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        if (!state.operation || state.operation.record.id !== where.id || state.operation.record.status !== where.status) return { count: 0 };
        Object.assign(state.operation.record, data);
        return { count: 1 };
      }),
      findMany: vi.fn().mockResolvedValue([]),
    },
    personalizationSettings: {
      upsert: vi.fn().mockResolvedValue({
        baseStyleTone: "friendly", warmth: "warm", enthusiasm: "medium",
        headerAndLists: "minimal", emoji: "none", fastAnswers: true,
        customInstructions: "Call me Finn.",
      }),
    },
    device: { findFirst: vi.fn().mockResolvedValue(null) },
    chatMessageFeedback: { upsert: vi.fn() },
    auditEvent: { create: vi.fn().mockResolvedValue(undefined) },
    memoryRecord: {
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: memoryId }),
    },
    memoryCandidate: {
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: candidateId }),
    },
    memoryTopicForget: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    searchActiveMemories: vi.fn().mockResolvedValue([]),
  };
  let transactionTail = Promise.resolve();
  const transaction = async <T>(work: (repositories: any) => Promise<T>): Promise<T> => {
    const previous = transactionTail;
    let release!: () => void;
    transactionTail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try { return await work(repositories); } finally { release(); }
  };
  const hermes = { generate: vi.fn().mockResolvedValue("**Hi!** https://secret.invalid") };
  const mobileEvents = { sendToUser: vi.fn().mockReturnValue(1) };
  const memoryContext = { search: vi.fn().mockResolvedValue([]) };
  const service = new ChatService({
    repositories, transaction, hermes, mobileEvents, memoryContext,
    hardTimeoutMs: 1_000, maxConcurrent: 1, maxPending: 4,
  });
  return { service, state, repositories, hermes, mobileEvents, memoryContext };
}

describe("chat service durable orchestration", () => {
  it("does not let one blocked session consume global slots needed by another session", async () => {
    const queue = new BoundedChatQueue(2, 4);
    const first = deferred<void>();
    const started: string[] = [];
    const reserve = (key: string, label: string, work: () => Promise<void>) => {
      const reservation = queue.reserve();
      expect(reservation).not.toBeNull();
      reservation!.commit(key, async () => { started.push(label); await work(); });
    };
    reserve("s1", "a1", () => first.promise);
    reserve("s1", "a2", () => Promise.resolve());
    reserve("s2", "b1", () => Promise.resolve());

    expect(started).toEqual(["a1", "b1"]);
    first.resolve();
    await queue.waitForIdle();
    expect(started).toEqual(["a1", "b1", "a2"]);
  });

  it("persists once under a concurrent idempotency race and invokes Hermes once", async () => {
    const f = fixture();
    const input = { idempotencyKey: key, text: "Hello BMO", speakOnDevice: false };
    const [first, retry] = await Promise.all([
      f.service.submitMessage(userId, sessionId, input, "request-a"),
      f.service.submitMessage(userId, sessionId, input, "request-b"),
    ]);

    expect(first).toEqual(retry);
    expect(first).toMatchObject({
      userMessage: { id: userMessageId, sender: "user", text: "Hello BMO" },
      assistant: { status: "processing", operationId },
    });
    expect(f.repositories.chatMessage.create).toHaveBeenCalledTimes(1);
    expect(f.repositories.chatOperation.create).toHaveBeenCalledTimes(1);

    await f.service.waitForIdle();
    expect(f.hermes.generate).toHaveBeenCalledTimes(1);
    expect(f.hermes.generate).toHaveBeenCalledWith(
      expect.any(String), expect.any(AbortSignal), { conversation: `chat:${userId}:${sessionId}`, sessionKey: `bmo:user:${userId}` },
    );
    expect(f.state.messages).toHaveLength(2);
    expect(f.state.operation.record).toMatchObject({ status: "SUCCEEDED", errorCode: null });
    expect(f.mobileEvents.sendToUser).toHaveBeenCalledWith(userId, {
      event: "chat_thinking", sessionId, messageId: userMessageId,
    });
    expect(f.mobileEvents.sendToUser).toHaveBeenCalledWith(userId, {
      event: "chat_message", sessionId,
      message: { id: assistantMessageId, sender: "assistant", text: "Hi!", createdAt: expect.any(String) },
    });
  });

  it("serializes provider work for one user/session in message order", async () => {
    const f = fixture();
    const first = deferred<string>();
    let active = 0;
    let maxActive = 0;
    const calls: string[] = [];
    f.hermes.generate.mockImplementation(async (prompt: string) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      calls.push(prompt);
      try {
        if (calls.length === 1) return await first.promise;
        return "Second answer.";
      } finally { active -= 1; }
    });
    const operationTwo = "00000000-0000-4000-8000-000000000021";
    const leases = new Map<string, string>();
    f.repositories.chatOperation.updateMany.mockImplementation(async ({ where, data }: any) => {
      if (data?.status === "PROCESSING" && data?.errorCode) {
        leases.set(where.id, data.errorCode);
        return { count: 1 };
      }
      if (data?.status === "SUCCEEDED" && leases.get(where.id) === where.errorCode) {
        leases.delete(where.id);
        return { count: 1 };
      }
      return { count: 0 };
    });

    const runFirst = f.service.processAcceptedOperation({
      userId, sessionId, userMessageId, operationId, text: "first",
    });
    const runSecond = f.service.processAcceptedOperation({
      userId, sessionId, userMessageId: "00000000-0000-4000-8000-000000000031", operationId: operationTwo, text: "second",
    });

    await new Promise<void>((resolve) => { setTimeout(resolve, 20); });
    expect(f.hermes.generate).toHaveBeenCalledTimes(1);
    first.resolve("First answer.");
    await Promise.all([runFirst, runSecond]);

    expect(f.hermes.generate).toHaveBeenCalledTimes(2);
    expect(maxActive).toBe(1);
    expect(f.repositories.claimChatOperation).toHaveBeenCalledWith(expect.objectContaining({ operationId }));
    expect(f.repositories.claimChatOperation).toHaveBeenCalledWith(expect.objectContaining({ operationId: operationTwo }));
  });

  it("claims a durable operation before provider work so overlapping workers invoke Hermes once", async () => {
    const f = fixture();
    const provider = deferred<string>();
    f.hermes.generate.mockReturnValue(provider.promise);
    let lease: string | null = null;
    f.repositories.claimChatOperation.mockImplementation(async ({ leaseToken }: any) => {
      if (lease !== null) return false;
      lease = leaseToken;
      return true;
    });
    const secondService = new ChatService({
      repositories: f.repositories,
      transaction: async (work) => work(f.repositories),
      hermes: f.hermes,
      mobileEvents: f.mobileEvents,
      memoryContext: f.memoryContext,
      hardTimeoutMs: 1_000,
      maxConcurrent: 1,
      maxPending: 4,
    });
    const job = { userId, sessionId, userMessageId, operationId, text: "hello" };

    const firstWorker = f.service.processAcceptedOperation(job);
    await vi.waitFor(() => expect(f.hermes.generate).toHaveBeenCalledTimes(1));
    await secondService.processAcceptedOperation(job);
    provider.resolve("Only answer.");
    await firstWorker;

    expect(f.hermes.generate).toHaveBeenCalledTimes(1);
  });

  it("orders one session durably across service instances while allowing another session concurrently", async () => {
    const f = fixture();
    const first = deferred<string>();
    const other = deferred<string>();
    const lowerOperation = operationId;
    const upperOperation = "00000000-0000-4000-8000-000000000021";
    const otherSession = "00000000-0000-4000-8000-000000000011";
    const otherOperation = "00000000-0000-4000-8000-000000000022";
    let lowerProcessing = true;
    let active = 0;
    let maxActive = 0;
    f.repositories.claimChatOperation.mockImplementation(async ({ operationId: candidate }: any) => {
      if (candidate === upperOperation && lowerProcessing) return false;
      return true;
    });
    f.repositories.chatOperation.updateMany.mockImplementation(async ({ where, data }: any) => {
      if (data.status === "SUCCEEDED") lowerProcessing = false;
      return { count: 1 };
    });
    f.hermes.generate.mockImplementation(async (_prompt: string, _signal: AbortSignal, options: any) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      try {
        if (options.conversation.endsWith(sessionId)) return await first.promise;
        return await other.promise;
      } finally { active -= 1; }
    });
    const secondService = new ChatService({
      repositories: f.repositories, transaction: async (work) => work(f.repositories),
      hermes: f.hermes, mobileEvents: f.mobileEvents, memoryContext: f.memoryContext,
      hardTimeoutMs: 1_000, maxConcurrent: 2,
    });

    const lower = f.service.processAcceptedOperation({ userId, sessionId, userMessageId, operationId: lowerOperation, text: "lower" });
    await vi.waitFor(() => expect(f.hermes.generate).toHaveBeenCalledTimes(1));
    await secondService.processAcceptedOperation({ userId, sessionId, userMessageId: "m-upper", operationId: upperOperation, text: "upper" });
    expect(f.hermes.generate).toHaveBeenCalledTimes(1);
    const different = secondService.processAcceptedOperation({ userId, sessionId: otherSession, userMessageId: "m-other", operationId: otherOperation, text: "other" });
    await vi.waitFor(() => expect(f.hermes.generate).toHaveBeenCalledTimes(2));
    expect(maxActive).toBe(2);
    other.resolve("Other answer");
    first.resolve("First answer");
    await Promise.all([lower, different]);

    lowerProcessing = false;
    f.hermes.generate.mockResolvedValueOnce("Upper answer");
    await secondService.processAcceptedOperation({ userId, sessionId, userMessageId: "m-upper", operationId: upperOperation, text: "upper" });
    expect(f.hermes.generate).toHaveBeenCalledTimes(3);
  });

  it("renews with the database clock after slow context so a stale takeover cannot overlap Hermes", async () => {
    const f = fixture();
    const slowContext = deferred<readonly string[]>();
    f.memoryContext.search.mockImplementationOnce(() => slowContext.promise).mockResolvedValue([]);
    let currentLease = "";
    let firstLease = "";
    f.repositories.claimChatOperation.mockImplementation(async ({ leaseToken }: any) => {
      if (!firstLease) firstLease = leaseToken;
      currentLease = leaseToken;
      return true;
    });
    f.repositories.renewChatOperationLease.mockImplementation(async ({ leaseToken }: any) => leaseToken === currentLease);
    const secondService = new ChatService({
      repositories: f.repositories, transaction: async (work) => work(f.repositories),
      hermes: f.hermes, mobileEvents: f.mobileEvents, memoryContext: f.memoryContext,
      hardTimeoutMs: 1_000,
    });
    const job = { userId, sessionId, userMessageId, operationId, text: "slow context" };

    const slowWorker = f.service.processAcceptedOperation(job);
    await vi.waitFor(() => expect(firstLease).not.toBe(""));
    const takeoverWorker = secondService.processAcceptedOperation(job);
    await vi.waitFor(() => expect(currentLease).not.toBe(firstLease));
    await takeoverWorker;
    slowContext.resolve([]);
    await slowWorker;

    expect(f.hermes.generate).toHaveBeenCalledTimes(1);
    expect(f.repositories.renewChatOperationLease).toHaveBeenCalledTimes(2);
    expect(f.repositories.databaseNow).toHaveBeenCalled();
  });

  it("checks durable cancellation before queued provider work", async () => {
    const f = fixture();
    const blocker = deferred<string>();
    f.hermes.generate.mockImplementationOnce(() => blocker.promise).mockResolvedValue("Must not send deleted text");
    await f.service.submitMessage(userId, sessionId, {
      idempotencyKey: key, text: "blocker", speakOnDevice: false,
    });
    const secondTurn = f.service.submitMessage(userId, sessionId, {
      idempotencyKey: "00000000-0000-4000-8000-000000000051", text: "deleted secret", speakOnDevice: false,
    });
    await f.service.deleteSession(userId, sessionId);
    blocker.resolve("First answer");
    await secondTurn;
    await f.service.waitForIdle();

    const chatCalls = f.hermes.generate.mock.calls.filter((c: any) =>
      c[2]?.conversation?.startsWith("chat:")
    );
    expect(chatCalls).toHaveLength(1);
    expect(JSON.stringify(f.hermes.generate.mock.calls)).not.toContain("deleted secret");
  });

  it("aborts active Hermes work on deletion and persists no assistant or completion event", async () => {
    const f = fixture();
    let providerSignal: AbortSignal | undefined;
    f.hermes.generate.mockImplementation((_prompt: string, signal: AbortSignal) => {
      providerSignal = signal;
      return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
    });

    const pendingTurn = f.service.submitMessage(userId, sessionId, {
      idempotencyKey: key, text: "cancel me", speakOnDevice: false,
    });
    await vi.waitFor(() => expect(providerSignal).toBeDefined());
    await f.service.deleteSession(userId, sessionId, "request-del");
    await pendingTurn;
    await f.service.waitForIdle();

    expect(providerSignal?.aborted).toBe(true);
    expect(f.state.messages.filter((m) => m.role === "ASSISTANT")).toHaveLength(0);
    expect(f.mobileEvents.sendToUser).not.toHaveBeenCalledWith(userId, expect.objectContaining({ event: "chat_message" }));
  });

  it("drains more than one recovery page and exposes transient resume failures for retry", async () => {
    const f = fixture();
    const rows = Array.from({ length: 130 }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      userId,
      userMessageId: `00000000-0000-4000-8000-m${String(index + 1).padStart(11, "0")}`,
      userMessage: { sessionId, content: `msg-${index + 1}` },
    }));
    let page = 0;
    f.repositories.findClaimableChatOperations.mockImplementation(async () => {
      page += 1;
      if (page === 1) return rows.slice(0, 64);
      if (page === 2) return rows.slice(64, 128);
      if (page === 3) return rows.slice(128);
      return [];
    });

    await expect(f.service.resumePending()).resolves.toBe(130);
    expect(f.repositories.findClaimableChatOperations).toHaveBeenCalledTimes(4);
  });

  it("stops a blocked recovery page, progresses an unrelated head, and coalesces overlapping recovery loops", async () => {
    const f = fixture();
    const blockedHead = {
      id: "00000000-0000-4000-8000-000000000021",
      userId,
      userMessageId: "00000000-0000-4000-8000-000000000031",
      userMessage: { sessionId, content: "blocked" },
    };
    const unrelatedSession = "00000000-0000-4000-8000-000000000019";
    const unrelatedHead = {
      id: "00000000-0000-4000-8000-000000000022",
      userId,
      userMessageId: "00000000-0000-4000-8000-000000000032",
      userMessage: { sessionId: unrelatedSession, content: "progresses" },
    };
    let pass = 0;
    f.repositories.findClaimableChatOperations.mockImplementation(async () => {
      pass += 1;
      if (pass === 1) return [blockedHead, unrelatedHead];
      return [];
    });
    f.repositories.claimChatOperation.mockImplementation(async ({ operationId }: any) => {
      return operationId === unrelatedHead.id;
    });
    f.hermes.generate.mockResolvedValue("Other answer");

    const firstRecovery = f.service.resumePending();
    const overlapping = f.service.resumePending();
    expect(overlapping).toBe(firstRecovery);

    await expect(firstRecovery).resolves.toBe(1);
    await f.service.waitForIdle();

    expect(f.repositories.claimChatOperation).toHaveBeenCalledWith(expect.objectContaining({ operationId: unrelatedHead.id }));
    expect(f.hermes.generate).toHaveBeenCalledTimes(1);
    expect(String(f.hermes.generate.mock.calls[0]?.[2]?.conversation)).toContain(unrelatedSession);
  });

  it("discovers an unrelated claimable head beyond sixty-four blocked upper rows", async () => {
    const f = fixture();
    const unrelatedSession = "00000000-0000-4000-8000-000000000019";
    const unrelatedHead = {
      id: "00000000-0000-4000-8000-000000000099",
      userId,
      userMessageId: "00000000-0000-4000-8000-000000000099",
      userMessage: { sessionId: unrelatedSession, content: "other head" },
    };
    f.repositories.findClaimableChatOperations = vi.fn()
      .mockResolvedValueOnce([unrelatedHead])
      .mockResolvedValueOnce([]);
    f.repositories.claimChatOperation.mockResolvedValue(true);
    f.hermes.generate.mockResolvedValue("Other answer");

    await expect(f.service.resumePending()).resolves.toBe(1);

    expect(f.repositories.findClaimableChatOperations).toHaveBeenCalledWith(expect.objectContaining({ limit: 64 }));
    expect(f.repositories.chatOperation.findMany).not.toHaveBeenCalled();
    expect(f.repositories.claimChatOperation).toHaveBeenCalledWith(expect.objectContaining({ operationId: unrelatedHead.id }));
    expect(f.hermes.generate).toHaveBeenCalledTimes(1);
  });

  it("builds bounded server-owned personalization/history/empty-memory context without infrastructure secrets", async () => {
    const f = fixture();
    await f.service.submitMessage(userId, sessionId, {
      idempotencyKey: key, text: "What should we do?", speakOnDevice: false,
    });
    await f.service.waitForIdle();

    const prompt = String(f.hermes.generate.mock.calls[0]?.[0]);
    expect(prompt).toContain("Call me Finn.");
    expect(prompt).toContain("What should we do?");
    expect(prompt).toContain('"memory":[]');
    expect(prompt).toContain('"displayName":"Finn"');
    expect(prompt).not.toContain("bmo-secret");
  });

  it("resolves user displayName from identity memory fallback when displayName is null", async () => {
    const f = fixture();
    f.repositories.user.findUnique.mockResolvedValue({ displayName: null, email: "user@example.com" });
    f.repositories.searchActiveMemories = vi.fn().mockResolvedValue(["nama user adalah Rangga"]);

    await f.service.submitMessage(userId, sessionId, {
      idempotencyKey: key, text: "Halo BMO!", speakOnDevice: false,
    });
    await f.service.waitForIdle();

    const prompt = JSON.parse(String(f.hermes.generate.mock.calls[0]?.[0]));
    expect(prompt.user.displayName).toBe("Rangga");
  });

  it("extracts and persists factual memories asynchronously after turn completes", async () => {
    const f = fixture();
    f.hermes.generate.mockImplementation(async (_prompt: string, _signal?: AbortSignal, options?: any) => {
      if (options?.conversation?.startsWith("memory-extract:")) {
        return JSON.stringify([
          { topic: "name", category: "profile", normalizedContent: "Nama user adalah Rangga", importance: 10 },
          { topic: "food_preference", category: "preference", normalizedContent: "Suka makan ayam", importance: 8 },
          { topic: "bad_topic", category: "fact", normalizedContent: "Forgotten info", importance: 5 },
        ]);
      }
      return "Halo Rangga! Senang berkenalan denganmu.";
    });

    f.repositories.memoryTopicForget.findMany.mockResolvedValue([{ normalizedTopic: "bad_topic" }]);
    f.repositories.memoryRecord.findMany.mockResolvedValue([]);

    await f.service.submitMessage(userId, sessionId, {
      idempotencyKey: key, text: "Nama saya Rangga dan saya suka makan ayam", speakOnDevice: false,
    });
    await f.service.waitForIdle();

    // Allow async non-blocking extraction promise to settle
    await new Promise<void>((resolve) => { setTimeout(resolve, 50); });

    expect(f.repositories.memoryRecord.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId,
        topic: "name",
        normalizedContent: "Nama user adalah Rangga",
        importance: 10,
        source: "conversation",
      }),
    });
    expect(f.repositories.memoryRecord.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId,
        topic: "food_preference",
        normalizedContent: "Suka makan ayam",
        importance: 8,
        source: "conversation",
      }),
    });
    expect(f.repositories.memoryCandidate.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId,
        topic: "name",
        status: "ACCEPTED",
      }),
    });
  });

  it("generates a dynamic title via Hermes on initial exchange and emits chat_title_updated", async () => {
    const f = fixture();
    f.state.session.title = null;
    f.hermes.generate.mockImplementation(async (_prompt: string, _signal?: AbortSignal, options?: any) => {
      if (options?.conversation?.startsWith("title-generate:")) {
        return "**Tips Merawat Kucing Persia**";
      }
      return "Halo! BMO bisa bantu kamu merawat kucing.";
    });

    await f.service.submitMessage(userId, sessionId, {
      idempotencyKey: key,
      text: "Bagaimana cara merawat kucing persia?",
      speakOnDevice: false,
    });

    await f.service.waitForIdle();
    await new Promise<void>((resolve) => { setTimeout(resolve, 50); });

    expect(f.repositories.chatSession.updateMany).toHaveBeenCalledWith({
      where: { id: sessionId, userId, status: "ACTIVE", deletedAt: null },
      data: { title: "Tips Merawat Kucing Persia" },
    });
    expect(f.mobileEvents.sendToUser).toHaveBeenCalledWith(userId, {
      event: "chat_title_updated",
      sessionId,
      title: "Bagaimana cara merawat kucing persia?",
    });
    expect(f.mobileEvents.sendToUser).toHaveBeenCalledWith(userId, {
      event: "chat_title_updated",
      sessionId,
      title: "Tips Merawat Kucing Persia",
    });
  });

  it("falls back to heuristic title when Hermes title generation fails or times out", async () => {
    const f = fixture();
    f.state.session.title = null;
    f.hermes.generate.mockImplementation(async (_prompt: string, _signal?: AbortSignal, options?: any) => {
      if (options?.conversation?.startsWith("title-generate:")) {
        throw new Error("Hermes title generation timeout");
      }
      return "Tentu! Ini rekomendasi liburan di Bali.";
    });

    await f.service.submitMessage(userId, sessionId, {
      idempotencyKey: key,
      text: "Rencana liburan keluarga akhir tahun ke Bali",
      speakOnDevice: false,
    });

    await f.service.waitForIdle();
    await new Promise<void>((resolve) => { setTimeout(resolve, 50); });

    expect(f.state.session.title).toBe("Rencana liburan keluarga akhir tahun...");
    expect(f.mobileEvents.sendToUser).toHaveBeenCalledWith(userId, {
      event: "chat_title_updated",
      sessionId,
      title: "Rencana liburan keluarga akhir tahun...",
    });
  });

  it("does not generate or overwrite title if session already has a title", async () => {
    const f = fixture();
    f.state.session.title = "Existing Chat Title";
    f.hermes.generate.mockResolvedValue("Jawaban untuk sesi yang sudah ada.");

    await f.service.submitMessage(userId, sessionId, {
      idempotencyKey: key,
      text: "Lanjutkan obrolan kita kemarin",
      speakOnDevice: false,
    });

    await f.service.waitForIdle();
    await new Promise<void>((resolve) => { setTimeout(resolve, 50); });

    const titleCalls = f.hermes.generate.mock.calls.filter((c: any) =>
      c[2]?.conversation?.startsWith("title-generate:")
    );
    expect(titleCalls).toHaveLength(0);
    const titleUpdatedEvents = f.mobileEvents.sendToUser.mock.calls.filter((c: any) =>
      c[1]?.event === "chat_title_updated"
    );
    expect(titleUpdatedEvents).toHaveLength(0);
  });

  it("persists a safe provider failure and audit without leaking provider details", async () => {
    const f = fixture();
    f.hermes.generate.mockRejectedValue(new Error("upstream api key sk-live-secret rejected"));
    await f.service.submitMessage(userId, sessionId, {
      idempotencyKey: key, text: "Hello", speakOnDevice: false,
    }, "request-failure");
    await f.service.waitForIdle();

    expect(f.state.operation.record).toMatchObject({ status: "FAILED", errorCode: "HERMES_FAILED" });
    expect(JSON.stringify(f.state.operation.record)).not.toContain("sk-live-secret");
    expect(f.repositories.auditEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      eventType: "CHAT_OPERATION_FAILED", outcome: "failure", requestId: "request-failure",
      metadata: expect.not.objectContaining({ message: expect.anything() }),
    }) });
  });

  it("enforces its own hard deadline even when a Hermes adapter ignores abort", async () => {
    const f = fixture();
    const never = new Promise<string>(() => undefined);
    f.hermes.generate.mockReturnValue(never);
    const service = new ChatService({
      repositories: f.repositories,
      transaction: async (work) => work(f.repositories),
      hermes: f.hermes,
      mobileEvents: f.mobileEvents,
      memoryContext: f.memoryContext,
      hardTimeoutMs: 5,
      maxConcurrent: 1,
      maxPending: 1,
    });

    await service.submitMessage(userId, sessionId, {
      idempotencyKey: key, text: "Hello", speakOnDevice: false,
    }, "request-timeout");
    await service.waitForIdle();

    expect(f.state.operation.record).toMatchObject({ status: "FAILED", errorCode: "HERMES_FAILED" });
  });

  it("denies cross-owner sessions and rejects the not-yet-implemented physical speech boundary", async () => {
    const f = fixture();
    await expect(f.service.submitMessage(otherUserId, sessionId, {
      idempotencyKey: key, text: "steal", speakOnDevice: false,
    })).rejects.toMatchObject({ code: "OWNERSHIP_DENIED", status: 404 });
    await expect(f.service.submitMessage(userId, sessionId, {
      idempotencyKey: key, text: "speak", speakOnDevice: true,
    })).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE", status: 503 });
  });

  it("returns deterministic user-scoped cursor history and soft-deletes only an owned session", async () => {
    const f = fixture();
    f.state.messages.push(
      { id: userMessageId, userId, sessionId, role: "USER", content: "one", cursor: 1n, createdAt: now, deletedAt: null },
      { id: assistantMessageId, userId, sessionId, role: "ASSISTANT", content: "two", cursor: 2n, createdAt: now, deletedAt: null },
    );
    const first = await f.service.listMessages(userId, sessionId, { limit: 1 });
    expect(first).toEqual({
      messages: [{ id: userMessageId, sender: "user", text: "one", createdAt: now.toISOString(), cursor: "1" }],
      nextCursor: "1",
    });
    const second = await f.service.listMessages(userId, sessionId, { cursor: first.nextCursor!, limit: 1 });
    expect(second.messages[0]).toMatchObject({ id: assistantMessageId, cursor: "2" });
    expect(second.nextCursor).toBeNull();

    await f.service.deleteSession(userId, sessionId, "request-delete");
    expect(f.repositories.chatSession.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: sessionId, userId, status: "ACTIVE", deletedAt: null },
    }));
    expect(f.repositories.chatMessage.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { sessionId, userId, deletedAt: null },
    }));
  });

  it("upserts feedback only for an owned assistant message", async () => {
    const f = fixture();
    f.repositories.chatMessage.findFirst = vi.fn().mockResolvedValue({ id: assistantMessageId, userId, role: "ASSISTANT" });
    f.repositories.chatMessageFeedback.upsert.mockResolvedValue({
      messageId: assistantMessageId, rating: "POSITIVE", reason: "Helpful", updatedAt: now,
    });
    expect(await f.service.setFeedback(userId, assistantMessageId, { rating: "positive", reason: "Helpful" }, "feedback-1"))
      .toEqual({ messageId: assistantMessageId, rating: "positive", reason: "Helpful", updatedAt: now.toISOString() });
    expect(f.repositories.chatMessageFeedback.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId_messageId: { userId, messageId: assistantMessageId } },
    }));
  });
  it("excludes temporary sessions from listSessions", async () => {
    const f = fixture();
    const tempSession = {
      id: "00000000-0000-4000-8000-000000000099",
      userId,
      temporary: true,
      title: null,
      status: "ACTIVE",
      lastMessageAt: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    f.repositories.chatSession.findMany.mockImplementation(async ({ where }: any = {}) => {
      const all = [f.state.session, tempSession];
      return all.filter((s) => s.deletedAt === null && s.status === "ACTIVE" && (where?.temporary === undefined || s.temporary === where.temporary));
    });

    const res = await f.service.listSessions(userId);
    expect(res.sessions).toHaveLength(1);
    expect(res.sessions[0]!.id).toBe(sessionId);
    expect(f.repositories.chatSession.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId, status: "ACTIVE", deletedAt: null, temporary: false },
    }));
  });

  it("isolates memory and does not query memoryContext when session is temporary", async () => {
    const f = fixture();
    f.state.session.temporary = true;
    f.memoryContext.search.mockResolvedValue(["User prefers dark mode"]);
    f.repositories.searchActiveMemories.mockResolvedValue(["nama: Finn"]);
    f.hermes.generate.mockResolvedValue("Halo!");

    await f.service.submitMessage(userId, sessionId, {
      idempotencyKey: key,
      text: "Hello in temporary mode",
      speakOnDevice: false,
    });
    await f.service.waitForIdle();

    expect(f.memoryContext.search).not.toHaveBeenCalled();
    expect(f.repositories.searchActiveMemories).not.toHaveBeenCalled();

    const promptCall = String(f.hermes.generate.mock.calls[0]?.[0] ?? "{}");
    const parsedPrompt = JSON.parse(promptCall);
    expect(parsedPrompt.memory).toEqual([]);
  });

  it("does not extract memory or generate title for temporary sessions", async () => {
    const f = fixture();
    f.state.session.temporary = true;
    f.state.session.title = null;
    f.hermes.generate.mockResolvedValue("Ini jawaban rahasia.");

    await f.service.submitMessage(userId, sessionId, {
      idempotencyKey: key,
      text: "Ingat ini: PIN saya 1234",
      speakOnDevice: false,
    });
    await f.service.waitForIdle();
    await new Promise<void>((resolve) => { setTimeout(resolve, 50); });

    expect(f.repositories.memoryRecord.create).not.toHaveBeenCalled();
    expect(f.repositories.memoryCandidate.create).not.toHaveBeenCalled();

    const titleCalls = f.hermes.generate.mock.calls.filter((c: any) =>
      c[2]?.conversation?.startsWith("title-generate:") || c[2]?.conversation?.startsWith("memory-extract:")
    );
    expect(titleCalls).toHaveLength(0);
    const titleUpdatedEvents = f.mobileEvents.sendToUser.mock.calls.filter((c: any) =>
      c[1]?.event === "chat_title_updated"
    );
    expect(titleUpdatedEvents).toHaveLength(0);
  });
});
