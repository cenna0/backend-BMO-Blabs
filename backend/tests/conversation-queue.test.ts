import { describe, expect, it } from "vitest";

import { ConversationQueue } from "../src/services/conversation-queue.js";

describe("ConversationQueue", () => {
  it("serializes work for the same conversation and allows different conversations in parallel", async () => {
    const queue = new ConversationQueue();
    const events: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = queue.run("bmo-001", async () => {
      events.push("first-start");
      await firstGate;
      events.push("first-end");
      return "first";
    });
    const second = queue.run("bmo-001", async () => {
      events.push("second-start");
      return "second";
    });
    const other = queue.run("bmo-002", async () => {
      events.push("other-start");
      return "other";
    });

    await expect(other).resolves.toBe("other");
    expect(events).toEqual(["first-start", "other-start"]);
    releaseFirst();
    await expect(first).resolves.toBe("first");
    await expect(second).resolves.toBe("second");
    expect(events).toEqual(["first-start", "other-start", "first-end", "second-start"]);
  });
});
