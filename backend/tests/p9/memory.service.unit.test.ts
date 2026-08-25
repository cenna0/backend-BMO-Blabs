import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

import { P9Error } from "../../src/p9/errors.js";
import { encodeMemoryCursor } from "../../src/p9/memory.validation.js";
import { BMO_DREAM_SYSTEM_INSTRUCTIONS, JOY_DREAM_SYSTEM_INSTRUCTIONS, MemoryService } from "../../src/p9/services/memory.service.js";
import type { HermesGenerateClient } from "../../src/services/hermes.client.js";

const userId = "00000000-0000-4000-8000-000000000001";
const otherUserId = "00000000-0000-4000-8000-000000000002";
const memoryId = "00000000-0000-4000-8000-000000000010";
const candidateId = "00000000-0000-4000-8000-000000000020";
const key = "00000000-0000-4000-8000-000000000030";
const now = new Date("2026-08-12T08:00:00.000Z");
const actionFingerprint = (value: unknown) => createHash("sha256").update(JSON.stringify(
  Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right))),
)).digest("hex");

const memoryRow = (overrides: Record<string, unknown> = {}) => ({
  id: memoryId, userId, topic: "Travel", category: "preference",
  normalizedContent: "Prefers window seats", importance: 70, source: "candidate",
  expiresAt: null, deletedAt: null, createdAt: now, updatedAt: now, ...overrides,
});

const candidateRow = (overrides: Record<string, unknown> = {}) => ({
  id: candidateId, userId, sourceMessageId: null, proposedContent: "Prefers window seats",
  topic: "Travel", policyMetadata: null, status: "PENDING", expiresAt: null,
  reviewedAt: null, createdAt: now, updatedAt: now, ...overrides,
});

function fixture(options: { hermes?: HermesGenerateClient } = {}) {
  const repositories: Record<string, any> = {
    lockUser: vi.fn().mockResolvedValue(undefined),
    databaseNow: vi.fn().mockResolvedValue(now),
    user: { findUnique: vi.fn().mockResolvedValue({ displayName: "Rangga", username: "rangga" }) },
    personalizationSettings: { findUnique: vi.fn().mockResolvedValue({ customInstructions: "Be helpful" }) },
    chatMessage: { findMany: vi.fn().mockResolvedValue([]) },
    userSettings: { findUnique: vi.fn(), update: vi.fn() },
    memoryRecord: {
      findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn(), create: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    memoryCandidate: {
      findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn(), updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    memoryAction: { findUnique: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]), create: vi.fn() },
    memoryTopicForget: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn() },
    memorySummary: {
      findUnique: vi.fn().mockResolvedValue(null),
      findFirst: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockImplementation(async ({ update, create }: any) => ({
        id: "summary-id",
        userId,
        content: update?.content ?? create?.content ?? null,
        status: update?.status ?? create?.status ?? "READY",
        version: 1,
        feedback: update?.feedback ?? create?.feedback ?? null,
        generatedAt: now,
        expiresAt: null,
        deletedAt: null,
        createdAt: now,
        updatedAt: now,
      })),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    auditEvent: { create: vi.fn().mockResolvedValue(undefined) },
  };
  const service = new MemoryService({
    repositories: repositories as any,
    transaction: async (work) => work(repositories as any),
    ...(options.hermes ? { hermes: options.hermes } : {}),
  });
  return { service, repositories };
}

describe("memory lifecycle service", () => {
  it("returns exact memory settings and audits exact updates", async () => {
    const f = fixture();
    f.repositories.userSettings.findUnique.mockResolvedValue({ automaticMemoryCandidates: true });
    f.repositories.userSettings.update.mockResolvedValue({ id: "settings", automaticMemoryCandidates: false });
    await expect(f.service.getSettings(userId)).resolves.toEqual({ automaticMemoryCandidates: true });
    await expect(f.service.updateSettings(userId, { automaticMemoryCandidates: false }, "request-1"))
      .resolves.toEqual({ automaticMemoryCandidates: false });
    expect(f.repositories.userSettings.update).toHaveBeenCalledWith({ where: { userId }, data: { automaticMemoryCandidates: false } });
    expect(f.repositories.auditEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ userId, requestId: "request-1", eventType: "MEMORY_SETTINGS_CHANGED" }) });
  });

  it("uses deterministic owner-scoped cursor pagination and hides expired/deleted records", async () => {
    const f = fixture();
    const older = memoryRow({ id: "00000000-0000-4000-8000-000000000011", updatedAt: new Date("2026-08-11T08:00:00Z") });
    f.repositories.memoryRecord.findMany.mockResolvedValue([memoryRow(), older]);
    const cursor = encodeMemoryCursor({ at: now, id: memoryId });
    const result = await f.service.list(userId, { cursor, limit: 1 });
    expect(result).toEqual({ memories: [expect.objectContaining({ id: memoryId })], nextCursor: expect.any(String) });
    expect(f.repositories.memoryRecord.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ userId, deletedAt: null, AND: expect.any(Array) }),
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }], take: 2,
    }));
  });

  it("never returns another owner's record", async () => {
    const f = fixture();
    f.repositories.memoryRecord.findFirst.mockResolvedValue(null);
    await expect(f.service.get(userId, memoryId)).rejects.toMatchObject({ code: "OWNERSHIP_DENIED", status: 404 } satisfies Partial<P9Error>);
    expect(f.repositories.memoryRecord.findFirst).toHaveBeenCalledWith({ where: expect.objectContaining({ id: memoryId, userId }) });
    expect(f.repositories.memoryRecord.findFirst).not.toHaveBeenCalledWith(expect.objectContaining({ where: { id: memoryId, userId: otherUserId } }));
  });

  it("accepts a candidate once and replays the same idempotent result without duplicate writes", async () => {
    const f = fixture();
    const candidate = candidateRow();
    const accepted = memoryRow();
    f.repositories.memoryCandidate.findFirst.mockResolvedValue(candidate);
    f.repositories.memoryRecord.create.mockResolvedValue(accepted);
    f.repositories.memoryCandidate.updateMany.mockResolvedValue({ count: 1 });
    f.repositories.memoryAction.create.mockResolvedValue({});
    await expect(f.service.acceptCandidate(userId, candidateId, { idempotencyKey: key }, "request-2"))
      .resolves.toEqual(expect.objectContaining({ id: memoryId }));
    expect(f.repositories.memoryRecord.create).toHaveBeenCalledTimes(1);
    expect(f.repositories.auditEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ requestId: "request-2", eventType: "MEMORY_CANDIDATE_ACCEPTED" }) });

    f.repositories.memoryAction.findUnique.mockResolvedValue({
      actionType: "ACCEPT", resourceType: "memory_candidate", resourceId: candidateId,
      metadata: { candidateId, memoryId, fingerprint: actionFingerprint({ idempotencyKey: key }) },
    });
    f.repositories.memoryRecord.findFirst.mockResolvedValue(accepted);
    await expect(f.service.acceptCandidate(userId, candidateId, { idempotencyKey: key }, "request-replay"))
      .resolves.toEqual(expect.objectContaining({ id: memoryId }));
    expect(f.repositories.memoryRecord.create).toHaveBeenCalledTimes(1);
  });

  it("rejects idempotency key reuse for a different action or candidate", async () => {
    const f = fixture();
    f.repositories.memoryAction.findUnique.mockResolvedValue({ actionType: "REJECT", resourceType: "memory_candidate", resourceId: candidateId, metadata: {} });
    await expect(f.service.acceptCandidate(userId, candidateId, { idempotencyKey: key })).rejects.toMatchObject({ code: "CONFLICT", status: 409 } satisfies Partial<P9Error>);
  });

  it("rejects same-action replay when the mutation payload changes", async () => {
    const f = fixture();
    f.repositories.memoryAction.findUnique.mockResolvedValue({
      actionType: "EDIT", resourceType: "memory", resourceId: memoryId,
      metadata: { fingerprint: "different" },
    });
    await expect(f.service.update(userId, memoryId, { idempotencyKey: key, topic: "Flights" }))
      .rejects.toMatchObject({ code: "CONFLICT", status: 409 });

    f.repositories.memoryAction.findUnique.mockResolvedValue({
      actionType: "SUMMARY_FEEDBACK", resourceType: "memory_summary", resourceId: "summary",
      metadata: { fingerprint: "different" },
    });
    await expect(f.service.setSummaryFeedback(userId, { idempotencyKey: key, feedback: "Changed" }))
      .rejects.toMatchObject({ code: "CONFLICT", status: 409 });
  });

  it("rejects a candidate idempotently and does not create a memory", async () => {
    const f = fixture();
    let candidateStatus = "PENDING";
    f.repositories.memoryCandidate.findFirst.mockImplementation(async () => candidateRow({
      status: candidateStatus,
      reviewedAt: candidateStatus === "REJECTED" ? now : null,
    }));
    f.repositories.memoryCandidate.updateMany.mockResolvedValue({ count: 1 });
    f.repositories.memoryCandidate.updateMany.mockImplementation(async () => { candidateStatus = "REJECTED"; return { count: 1 }; });
    await expect(f.service.rejectCandidate(userId, candidateId, { idempotencyKey: key }, "request-3"))
      .resolves.toEqual(expect.objectContaining({ id: candidateId, status: "rejected" }));
    expect(f.repositories.memoryRecord.create).not.toHaveBeenCalled();

    f.repositories.memoryAction.findUnique.mockResolvedValue({ actionType: "REJECT", resourceType: "memory_candidate", resourceId: candidateId, metadata: {} });
    await expect(f.service.rejectCandidate(userId, candidateId, { idempotencyKey: key }, "request-replay"))
      .resolves.toEqual(expect.objectContaining({ id: candidateId, status: "rejected" }));
    expect(f.repositories.memoryCandidate.updateMany).toHaveBeenCalledTimes(1);
  });

  it("does not accept an expired or cross-owner candidate", async () => {
    const f = fixture();
    f.repositories.memoryCandidate.findFirst.mockResolvedValue(null);
    await expect(f.service.acceptCandidate(userId, candidateId, { idempotencyKey: key }))
      .rejects.toMatchObject({ code: "OWNERSHIP_DENIED", status: 404 });
    expect(f.repositories.memoryCandidate.findFirst).toHaveBeenCalledWith({ where: expect.objectContaining({ id: candidateId, userId, status: "PENDING" }) });
    expect(f.repositories.memoryRecord.create).not.toHaveBeenCalled();
  });

  it("does not accept a candidate for a previously forgotten topic", async () => {
    const f = fixture();
    f.repositories.memoryCandidate.findFirst.mockResolvedValue(candidateRow());
    f.repositories.memoryTopicForget.findMany.mockResolvedValue([{ normalizedTopic: "travel" }]);
    await expect(f.service.acceptCandidate(userId, candidateId, { idempotencyKey: key }))
      .rejects.toMatchObject({ code: "CONFLICT", status: 409 });
    expect(f.repositories.memoryRecord.create).not.toHaveBeenCalled();
  });

  it("does not accept a null-topic candidate after general was forgotten", async () => {
    const f = fixture();
    f.repositories.memoryCandidate.findFirst.mockResolvedValue(candidateRow({ topic: null }));
    f.repositories.memoryTopicForget.findMany.mockResolvedValue([{ normalizedTopic: "general" }]);
    await expect(f.service.acceptCandidate(userId, candidateId, { idempotencyKey: key }))
      .rejects.toMatchObject({ code: "CONFLICT", status: 409 });
    expect(f.repositories.memoryTopicForget.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId, normalizedTopic: "general" },
    }));
    expect(f.repositories.memoryRecord.create).not.toHaveBeenCalled();
  });

  it("does not edit a memory into a previously forgotten topic", async () => {
    const f = fixture();
    f.repositories.memoryRecord.findFirst.mockResolvedValue(memoryRow());
    f.repositories.memoryTopicForget.findMany.mockResolvedValue([{ normalizedTopic: "travel" }]);
    await expect(f.service.update(userId, memoryId, { idempotencyKey: key, topic: "Travel" }))
      .rejects.toMatchObject({ code: "CONFLICT", status: 409 });
    expect(f.repositories.memoryRecord.updateMany).not.toHaveBeenCalled();
  });

  it("edits and deletes only active owned records with idempotent audit actions", async () => {
    const f = fixture();
    f.repositories.memoryRecord.findFirst.mockResolvedValue(memoryRow());
    f.repositories.memoryRecord.updateMany.mockResolvedValue({ count: 1 });
    await f.service.update(userId, memoryId, { idempotencyKey: key, topic: "Flights" }, "request-4");
    expect(f.repositories.memoryRecord.updateMany).toHaveBeenCalledWith({ where: { id: memoryId, userId, deletedAt: null }, data: { topic: "Flights" } });
    expect(f.repositories.memoryAction.create).toHaveBeenCalledWith({ data: expect.objectContaining({ userId, actionType: "EDIT", resourceId: memoryId, idempotencyKey: key }) });

    f.repositories.memoryAction.findUnique.mockResolvedValue(null);
    await f.service.delete(userId, memoryId, "delete-key", "request-5");
    expect(f.repositories.memoryRecord.updateMany).toHaveBeenLastCalledWith({ where: { id: memoryId, userId, deletedAt: null }, data: { deletedAt: now } });
  });

  it("forget-topic and clear-all suppress records, pending candidates, and summaries", async () => {
    const f = fixture();
    f.repositories.memoryRecord.updateMany.mockResolvedValue({ count: 2 });
    f.repositories.memoryCandidate.updateMany.mockResolvedValue({ count: 1 });
    f.repositories.memoryTopicForget.create.mockResolvedValue({ id: "forget" });
    await expect(f.service.forgetTopic(userId, { idempotencyKey: key, topic: "  Travel  " }, "request-6"))
      .resolves.toEqual({ forgotten: 2, rejectedCandidates: 1, topic: "travel" });
    expect(f.repositories.memoryRecord.updateMany).toHaveBeenCalledWith({ where: { userId, deletedAt: null, topic: { equals: "travel", mode: "insensitive" } }, data: { deletedAt: now } });

    f.repositories.memoryAction.findUnique.mockResolvedValue(null);
    await expect(f.service.clearAll(userId, { idempotencyKey: "clear-key" }, "request-7"))
      .resolves.toEqual({ cleared: 2, rejectedCandidates: 1, summaryDeleted: false });
    expect(f.repositories.memorySummary.updateMany).toHaveBeenCalledWith({ where: { userId, deletedAt: null }, data: { deletedAt: now } });
  });

  it("forgetting general rejects both explicit-general and null-topic pending candidates", async () => {
    const f = fixture();
    f.repositories.memoryRecord.updateMany.mockResolvedValue({ count: 0 });
    f.repositories.memoryCandidate.updateMany.mockResolvedValue({ count: 2 });
    f.repositories.memoryTopicForget.create.mockResolvedValue({ id: "forget" });

    await expect(f.service.forgetTopic(userId, { idempotencyKey: key, topic: "general" }))
      .resolves.toEqual({ forgotten: 0, rejectedCandidates: 2, topic: "general" });
    expect(f.repositories.memoryCandidate.updateMany).toHaveBeenCalledWith({
      where: {
        userId,
        status: "PENDING",
        OR: [{ topic: { equals: "general", mode: "insensitive" } }, { topic: null }],
      },
      data: { status: "REJECTED", reviewedAt: now },
    });
  });

  it("exports only active unexpired content plus action metadata and audits the export", async () => {
    const f = fixture();
    f.repositories.memoryRecord.findMany.mockResolvedValue([memoryRow()]);
    f.repositories.memoryCandidate.findMany.mockResolvedValue([candidateRow({ status: "ACCEPTED" })]);
    f.repositories.memoryAction.findMany.mockResolvedValue([{ actionType: "ACCEPT", resourceType: "memory_candidate", resourceId: memoryId, createdAt: now }]);
    f.repositories.memoryTopicForget.findMany.mockResolvedValue([]);
    f.repositories.memorySummary.findFirst.mockResolvedValue(null);
    const exported = await f.service.export(userId, { idempotencyKey: key }, "request-8");
    expect(exported).toEqual(expect.objectContaining({ format: "json", exportedAt: now.toISOString(), memories: [expect.objectContaining({ id: memoryId })] }));
    expect(f.repositories.memoryRecord.findMany).toHaveBeenCalledWith({ where: expect.objectContaining({ userId, deletedAt: null, AND: expect.any(Array) }), orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    expect(f.repositories.memoryCandidate.findMany).toHaveBeenCalledWith({ where: expect.objectContaining({ userId, status: "PENDING", OR: expect.any(Array) }), orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  });

  it("does not export an expired summary", async () => {
    const f = fixture();
    f.repositories.memorySummary.findFirst.mockResolvedValue({
      id: "summary", userId, content: "stale", status: "READY", version: 1, feedback: null,
      generatedAt: now, expiresAt: new Date(now.getTime() - 1), deletedAt: null,
      createdAt: now, updatedAt: now,
    });
    const exported = await f.service.export(userId, { idempotencyKey: "export-expired" });
    expect(exported.summary).toBeNull();
  });

  it("synthesizes memory summary using Hermes dreaming and persists READY status", async () => {
    const dreamMarkdown = "## Profile & Identity\nUser is Rangga.\n\n## Preferences & Interests\n- Likes robotics";
    const generate = vi.fn().mockResolvedValue(dreamMarkdown);
    const hermes: HermesGenerateClient = { generate };
    const f = fixture({ hermes });

    f.repositories.memoryRecord.findMany.mockResolvedValue([memoryRow()]);

    const result = await f.service.regenerateSummary(userId, { idempotencyKey: key }, "request-dream-1");

    expect(generate).toHaveBeenCalledWith(
      expect.stringContaining("Prefers window seats"),
      undefined,
      expect.objectContaining({
        conversation: `memory-dream:${userId}`,
        sessionKey: `bmo:user:${userId}`,
        instructions: BMO_DREAM_SYSTEM_INSTRUCTIONS,
        raw: true,
      }),
    );

    expect(f.repositories.memorySummary.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId },
      update: expect.objectContaining({
        status: "READY",
        content: dreamMarkdown,
      }),
    }));

    expect(result).toEqual({
      summary: expect.objectContaining({
        status: "ready",
        content: dreamMarkdown,
      }),
      generation: {
        source: "memory_records",
        runtimeStatus: "completed",
      },
    });

    expect(f.repositories.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId,
        eventType: "MEMORY_SUMMARY_REGENERATED",
        requestId: "request-dream-1",
      }),
    });
  });

  it("falls back gracefully to deterministic synthesis when Hermes throws", async () => {
    const generate = vi.fn().mockRejectedValue(new Error("Hermes unavailable"));
    const hermes: HermesGenerateClient = { generate };
    const f = fixture({ hermes });

    f.repositories.memoryRecord.findMany.mockResolvedValue([memoryRow()]);

    const result = await f.service.regenerateSummary(userId, { idempotencyKey: key }, "request-fallback");

    expect(result.summary).toEqual(expect.objectContaining({
      status: "ready",
      content: expect.stringContaining("## Preferences & Interests\n- Prefers window seats"),
    }));
    expect(result.generation).toEqual({
      source: "memory_records",
      runtimeStatus: "fallback",
    });
  });

  it("synthesizes fallback summary when Hermes is not configured", async () => {
    const f = fixture();
    f.repositories.memoryRecord.findMany.mockResolvedValue([memoryRow()]);

    const result = await f.service.regenerateSummary(userId, { idempotencyKey: key }, "request-no-hermes");

    expect(result.summary).toEqual(expect.objectContaining({
      status: "ready",
      content: expect.stringContaining("## Profile & Identity\nNama kamu Rangga."),
    }));
    expect(result.generation).toEqual({
      source: "memory_records",
      runtimeStatus: "not_configured",
    });
  });

  it("updates memory summary with user feedback and re-synthesizes", async () => {
    const feedbackMarkdown = "## Profile & Identity\nUser is Rangga.\n\n## Interests\nEnjoys AI.";
    const generate = vi.fn().mockResolvedValue(feedbackMarkdown);
    const hermes: HermesGenerateClient = { generate };
    const f = fixture({ hermes });

    const result = await f.service.setSummaryFeedback(
      userId,
      { idempotencyKey: "feedback-key", feedback: "Include that I enjoy AI" },
      "request-feedback-1",
    );

    expect(generate).toHaveBeenCalledWith(
      expect.stringContaining("Include that I enjoy AI"),
      undefined,
      expect.objectContaining({ raw: true }),
    );

    expect(f.repositories.memorySummary.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({
        feedback: "Include that I enjoy AI",
        content: feedbackMarkdown,
      }),
    }));

    expect(result).toEqual({
      summary: expect.objectContaining({
        status: "ready",
        content: feedbackMarkdown,
        feedback: "Include that I enjoy AI",
      }),
    });

    expect(f.repositories.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId,
        eventType: "MEMORY_SUMMARY_FEEDBACK_UPDATED",
        requestId: "request-feedback-1",
      }),
    });
  });

  it("replays idempotent regenerateSummary without re-invoking synthesis", async () => {
    const generate = vi.fn().mockResolvedValue("## Overview\nTest");
    const hermes: HermesGenerateClient = { generate };
    const f = fixture({ hermes });

    f.repositories.memoryAction.findUnique.mockResolvedValue({
      actionType: "SUMMARY_REGENERATE",
      resourceType: "memory_summary",
      resourceId: "summary-id",
      metadata: { status: "completed" },
    });
    f.repositories.memorySummary.findUnique.mockResolvedValue({
      id: "summary-id",
      userId,
      content: "## Overview\nReplayed Content",
      status: "READY",
      version: 1,
      feedback: null,
      generatedAt: now,
      expiresAt: null,
      deletedAt: null,
      updatedAt: now,
    });

    const result = await f.service.regenerateSummary(userId, { idempotencyKey: key }, "request-replay");

    expect(generate).not.toHaveBeenCalled();
    expect(result).toEqual({
      summary: expect.objectContaining({
        status: "ready",
        content: "## Overview\nReplayed Content",
      }),
      generation: {
        source: "memory_records",
        runtimeStatus: "completed",
      },
    });
  });
});
