import { describe, expect, it } from "vitest";

import { BoundedAvatarProcessingQueue } from "../../src/p9/services/avatar-processing.service.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("bounded avatar processing", () => {
  it("caps active Sharp jobs and queued request bodies, then rejects overload with a sanitized response", async () => {
    const queue = new BoundedAvatarProcessingQueue(2, 1);
    const first = deferred();
    const second = deferred();
    let active = 0;
    let peak = 0;
    const job = async (gate: Promise<void>) => {
      active += 1;
      peak = Math.max(peak, active);
      await gate;
      active -= 1;
    };

    const runningFirst = queue.run(() => job(first.promise));
    const runningSecond = queue.run(() => job(second.promise));
    const queued = queue.run(async () => undefined);
    await expect(queue.run(async () => undefined)).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
      status: 503,
      publicMessage: "Avatar processing temporarily unavailable",
    });

    first.resolve();
    second.resolve();
    await Promise.all([runningFirst, runningSecond, queued]);
    expect(peak).toBe(2);
  });
});
