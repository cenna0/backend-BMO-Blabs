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

  it("exposes focused Phase 2 delegates through the repository boundary", async () => {
    const repositories = await readFile(new URL("../../src/p9/db/repositories.ts", import.meta.url), "utf8");
    for (const delegate of [
      "passwordRecovery",
      "personalizationSettings",
      "chatSession",
      "chatMessage",
      "chatOperation",
      "chatMessageFeedback",
      "memoryRecord",
      "memoryCandidate",
      "memoryAction",
      "memoryTopicForget",
      "memorySummary",
      "schedule",
      "scheduleRun",
      "proactiveDelivery",
      "deliveryAttempt",
      "deviceWifiConfiguration",
      "deviceTelemetryCurrent",
      "deviceLog",
      "integrationConnection",
      "oAuthState",
      "spotifyCredential",
      "spotifyAction",
      "whatsAppNotificationRule",
      "whatsAppSendRequest",
      "whatsAppDelivery",
      "bugReport",
      "bugReportAttachment",
    ]) {
      expect(repositories).toContain(`get ${delegate}()`);
      expect(repositories).toContain(`return this.db.${delegate};`);
    }
  });
});
