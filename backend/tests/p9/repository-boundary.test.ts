import { readFile, readdir } from "node:fs/promises";
import { describe, expect, it } from "vitest";

async function readSourceDirectory(directory: URL): Promise<string> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return "";
    throw error;
  }
  const files = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
      .map((entry) => readFile(new URL(entry.name, directory), "utf8")),
  );
  return files.join("\n");
}

describe("P9 repository boundary", () => {
  it("keeps Prisma imports out of HTTP route modules", async () => {
    const httpDirectory = new URL("../../src/p9/http/", import.meta.url);
    const source = await readSourceDirectory(httpDirectory);
    expect(source).not.toMatch(/from ["'](?:@prisma\/client|\.\.\/.*prisma)/);
  });
});
