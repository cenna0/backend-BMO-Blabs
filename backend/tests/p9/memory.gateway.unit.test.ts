import { describe, expect, it, vi } from "vitest";

import { P9Repositories } from "../../src/p9/db/repositories.js";
import { PostgresMemoryGateway } from "../../src/p9/services/memory-gateway.service.js";

describe("PostgresMemoryGateway", () => {
  it("searches only active owner rows with bounded relevance and stable ordering", async () => {
    const searchActiveMemories = vi.fn().mockResolvedValue([
      "Finn prefers concise answers",
      "Finn lives in Jakarta",
    ]);
    const gateway = new PostgresMemoryGateway({ searchActiveMemories } as any);

    await expect(gateway.search("owner", "concise Jakarta", 99)).resolves.toEqual([
      "Finn prefers concise answers", "Finn lives in Jakarta",
    ]);
    expect(searchActiveMemories).toHaveBeenCalledWith({
      userId: "owner", terms: ["concise", "Jakarta"], limit: 8,
    });
  });

  it("returns safe empty context for blank queries without touching storage", async () => {
    const searchActiveMemories = vi.fn();
    const gateway = new PostgresMemoryGateway({ searchActiveMemories } as any);
    await expect(gateway.search("owner", "   ", 8)).resolves.toEqual([]);
    expect(searchActiveMemories).not.toHaveBeenCalled();
  });

  it("excludes durable forgotten topics from chat retrieval", async () => {
    const searchActiveMemories = vi.fn().mockResolvedValue([]);
    const gateway = new PostgresMemoryGateway({ searchActiveMemories } as any);

    await gateway.search("owner", "travel", 8);

    expect(searchActiveMemories).toHaveBeenCalledWith({ userId: "owner", terms: ["travel"], limit: 8 });
  });

  it("implements active retrieval as owner-scoped parameterized SQL with forget suppression", async () => {
    const queryRaw = vi.fn().mockResolvedValue([{ normalizedContent: "safe memory" }]);
    const repositories = new P9Repositories({ $queryRaw: queryRaw } as any);

    await expect(repositories.searchActiveMemories({ userId: "owner-id", terms: ["travel"], limit: 8 }))
      .resolves.toEqual(["safe memory"]);

    const [strings, ...values] = queryRaw.mock.calls[0]!;
    const sql = Array.from(strings as TemplateStringsArray).join("?");
    expect(sql).toContain('memory."userId" = ?::uuid');
    expect(sql).toContain('memory."deletedAt" IS NULL');
    expect(sql).toContain('memory."expiresAt" > clock_timestamp()');
    expect(sql).toContain('FROM "MemoryTopicForget" AS forgotten');
    expect(sql).toContain('lower(forgotten."normalizedTopic") = lower(memory.topic)');
    expect(sql).toContain('ORDER BY memory.importance DESC, memory."updatedAt" DESC, memory.id ASC');
    expect(values).toEqual(["owner-id", ["travel"], 8]);
  });
});
