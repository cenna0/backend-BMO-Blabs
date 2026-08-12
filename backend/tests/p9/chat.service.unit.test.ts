import { describe, expect, it, vi } from "vitest";

import { P9Error } from "../../src/p9/errors.js";
import { BoundedChatQueue, ChatService } from "../../src/p9/services/chat.service.js";

const userId = "00000000-0000-4000-8000-000000000001";
const otherUserId = "00000000-0000-4000-8000-000000000002";
const sessionId = "00000000-0000-4000-8000-000000000010";
const operationId = "00000000-0000-4000-8000-000000000020";
const userMessageId = "00000000-0000-4000-8000-000000000030";
const assistantMessageId = "00000000-0000-4000-8000-000000000040";
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
      id: sessionId, userId, temporary: false, title: null, status: "ACTIVE",
      lastMessageAt: null as Date | null, createdAt: now, updatedAt: now, deletedAt: null,
    },
    messages: [] as any[],
    operation: null as any,
  };
  let nextMessage = 0;
  const repositories: any = {
    lockUser: vi.fn().mockResolvedValue(undefined),
    databaseNow: vi.fn().mockResolvedValue(now),
    chatSession: {
      findFirst: vi.fn(async ({ where }: any) =>
        where.id === state.session.id && where.userId === state.session.userId &&
        state.session.status === "ACTIVE" ? state.session : null),
      findMany: vi.fn().mockResolvedValue([state.session]),
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

    reserve("session-a", "a1", () => first.promise);
    reserve("session-a", "a2", async () => undefined);
    reserve("session-b", "b1", async () => undefined);
    await vi.waitFor(() => expect(started).toEqual(["a1", "b1"]));
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
      expect.any(String), expect.any(AbortSignal), { conversation: `chat:${userId}:${sessionId}` },
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
      if (typeof data.errorCode === "string" && data.errorCode.startsWith("LEASE:")) {
        if (leases.has(where.id)) return { count: 0 };
        leases.set(where.id, data.errorCode);
        return { count: 1 };
      }
      return { count: leases.get(where.id) === where.errorCode ? 1 : 0 };
    });
    f.repositories.chatOperation.findFirst.mockImplementation(async ({ where }: any) =>
      leases.get(where.id) === where.errorCode ? { id: where.id } : null);

    const runFirst = f.service.processAcceptedOperation({
      userId, sessionId, userMessageId, operationId, text: "First",
    });
    const runSecond = f.service.processAcceptedOperation({
      userId, sessionId,
      userMessageId: "00000000-0000-4000-8000-000000000031",
      operationId: operationTwo,
      text: "Second",
    });
    await new Promise<void>((resolve) => { setTimeout(resolve, 20); });
    expect(f.hermes.generate).toHaveBeenCalledTimes(1);
    first.resolve("First answer.");
    await Promise.all([runFirst, runSecond]);

    expect(f.hermes.generate).toHaveBeenCalledTimes(2);
    expect(maxActive).toBe(1);
    expect(f.repositories.chatOperation.updateMany.mock.calls[0]?.[0]?.where.id).toBe(operationId);
    expect(f.repositories.chatOperation.updateMany.mock.calls.some((call: any[]) => call[0]?.where?.id === operationTwo)).toBe(true);
  });

  it("claims a durable operation before provider work so overlapping workers invoke Hermes once", async () => {
    const f = fixture();
    const provider = deferred<string>();
    f.hermes.generate.mockReturnValue(provider.promise);
    let lease: string | null = null;
    f.repositories.chatOperation.updateMany.mockImplementation(async ({ data }: any) => {
      if (typeof data.errorCode === "string" && data.errorCode.startsWith("LEASE:") && lease === null) {
        lease = data.errorCode;
        return { count: 1 };
      }
      if (typeof data.errorCode === "string" && data.errorCode.startsWith("LEASE:")) return { count: 0 };
      return { count: 1 };
    });
    f.repositories.chatOperation.findFirst.mockImplementation(async ({ where }: any) =>
      where.errorCode === lease ? { id: operationId } : null);
    const job = {
      userId, sessionId, userMessageId, operationId, text: "Hello",
    };
    const secondService = new ChatService({
      repositories: f.repositories,
      transaction: async (work) => work(f.repositories),
      hermes: f.hermes,
      mobileEvents: f.mobileEvents,
      memoryContext: f.memoryContext,
      hardTimeoutMs: 1_000,
    });

    const firstWorker = f.service.processAcceptedOperation(job);
    await vi.waitFor(() => expect(f.hermes.generate).toHaveBeenCalledTimes(1));
    await secondService.processAcceptedOperation(job);
    provider.resolve("Only answer.");
    await firstWorker;

    expect(f.hermes.generate).toHaveBeenCalledTimes(1);
  });

  it("checks durable cancellation before queued provider work", async () => {
    const f = fixture();
    const blocker = deferred<string>();
    f.hermes.generate.mockImplementationOnce(() => blocker.promise).mockResolvedValue("Must not send deleted text");
    await f.service.submitMessage(userId, sessionId, {
      idempotencyKey: key, text: "blocker", speakOnDevice: false,
    });
    await f.service.submitMessage(userId, sessionId, {
      idempotencyKey: "00000000-0000-4000-8000-000000000051", text: "deleted secret", speakOnDevice: false,
    });
    f.state.session.status = "DELETED";
    blocker.resolve("Done");
    await f.service.waitForIdle();

    expect(f.hermes.generate).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(f.hermes.generate.mock.calls)).not.toContain("deleted secret");
  });

  it("drains more than one recovery page and exposes transient resume failures for retry", async () => {
    const f = fixture();
    const operations = Array.from({ length: 70 }, (_, index) => ({
      id: `operation-${index}`, userId, userMessageId: `message-${index}`,
      userMessage: { sessionId, content: `message ${index}` },
    }));
    f.repositories.chatOperation.findMany
      .mockResolvedValueOnce(operations.slice(0, 64))
      .mockResolvedValueOnce(operations.slice(64))
      .mockResolvedValueOnce([]);
    f.service.processAcceptedOperation = vi.fn().mockResolvedValue(undefined) as any;

    expect(await f.service.resumePending()).toBe(70);
    expect(f.repositories.chatOperation.findMany).toHaveBeenCalledTimes(3);

    f.repositories.chatOperation.findMany.mockRejectedValueOnce(new Error("transient database error"));
    await expect(f.service.resumePending()).rejects.toThrow("transient database error");
  });

  it("builds bounded server-owned personalization/history/empty-memory context without infrastructure secrets", async () => {
    const f = fixture();
    await f.service.submitMessage(userId, sessionId, {
      idempotencyKey: key, text: "What should we do?", speakOnDevice: false,
    }, "request-a");
    await f.service.waitForIdle();

    const prompt = String(f.hermes.generate.mock.calls[0]?.[0]);
    expect(prompt).toContain("Call me Finn.");
    expect(prompt).toContain("What should we do?");
    expect(prompt).toContain('"memory":[]');
    expect(prompt).not.toContain("HERMES_API_KEY");
    expect(prompt).not.toContain("DATABASE_URL");
    expect(prompt.length).toBeLessThan(100_000);
    expect(f.memoryContext.search).toHaveBeenCalledWith(userId, "What should we do?", 8);
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
});
