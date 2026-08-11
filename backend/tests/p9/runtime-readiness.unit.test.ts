import { describe, expect, it, vi } from "vitest";

import { checkP9Readiness } from "../../src/p9/index.js";
import { P9_REQUIRED_MIGRATIONS } from "../../src/p9/migration-manifest.js";

describe("P9 runtime readiness", () => {
  const foundation = "20260804110000_p9_1_foundation";
  const integrityConstraints = "20260804123000_p9_1_integrity_constraints";

  it("accepts every required source migration when each is finished", async () => {
    const repositories = {
      healthCheck: vi.fn().mockResolvedValue(undefined),
      migrationStatus: vi.fn().mockResolvedValue([
        ...P9_REQUIRED_MIGRATIONS.map((name) => ({ name, finishedAt: new Date() })),
        { name: "older_extra_migration", finishedAt: new Date() },
      ]),
    };

    await expect(checkP9Readiness(repositories as never)).resolves.toBe(true);
    expect(repositories.healthCheck).toHaveBeenCalledTimes(1);
    expect(repositories.migrationStatus).toHaveBeenCalledTimes(1);
  });

  it.each([
    {
      label: "latest required migration absent",
      migrations: [{ name: foundation, finishedAt: new Date() }],
    },
    {
      label: "required migration unfinished",
      migrations: [
        { name: foundation, finishedAt: new Date() },
        { name: integrityConstraints, finishedAt: null },
      ],
    },
  ])("rejects $label without exposing details", async ({ migrations }) => {
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
