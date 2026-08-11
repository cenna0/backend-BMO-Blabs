import { describe, expect, it, vi } from "vitest";

import { checkP9Readiness } from "../../src/p9/index.js";

describe("P9 runtime readiness", () => {
  it("requires PostgreSQL health and at least one fully finished migration", async () => {
    const repositories = {
      healthCheck: vi.fn().mockResolvedValue(undefined),
      migrationStatus: vi.fn().mockResolvedValue([
        { name: "foundation", finishedAt: new Date() },
        { name: "constraints", finishedAt: new Date() },
      ]),
    };

    await expect(checkP9Readiness(repositories as never)).resolves.toBe(true);
    expect(repositories.healthCheck).toHaveBeenCalledTimes(1);
    expect(repositories.migrationStatus).toHaveBeenCalledTimes(1);
  });

  it.each([
    { migrations: [] as Array<{ name: string; finishedAt: Date | null }> },
    { migrations: [{ name: "foundation", finishedAt: null }] },
  ])("rejects missing or unfinished migrations without exposing details", async ({ migrations }) => {
    const repositories = {
      healthCheck: vi.fn().mockResolvedValue(undefined),
      migrationStatus: vi.fn().mockResolvedValue(migrations),
    };

    await expect(checkP9Readiness(repositories as never)).resolves.toBe(false);
  });

  it("contains database errors as a false readiness result", async () => {
    const repositories = {
      healthCheck: vi.fn().mockRejectedValue(new Error("private database detail")),
      migrationStatus: vi.fn(),
    };

    await expect(checkP9Readiness(repositories as never)).resolves.toBe(false);
    expect(repositories.migrationStatus).not.toHaveBeenCalled();
  });
});
