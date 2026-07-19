import { describe, expect, it } from "vitest";

import { RequestStore, toPublicRequestStatus } from "../src/domain/request-store.js";

const first = {
  requestId: "550e8400-e29b-41d4-a716-446655440000",
  deviceId: "bmo-001",
  inputPath: "C:/tmp/input.wav",
  inputSha256: "a".repeat(64),
  inputContentLength: 3_244,
};

const second = {
  ...first,
  requestId: "6b6a1bc8-55b0-4e88-b62e-289ae089fd54",
  inputPath: "C:/tmp/input-2.wav",
  inputSha256: "b".repeat(64),
};

describe("P5 RequestStore idempotency, status mapping, and GC", () => {
  it("maps internal statuses to canonical public duplicate statuses", () => {
    const store = new RequestStore();
    const record = store.create(first);

    for (const status of ["accepted", "transcribing", "thinking", "generating_voice"] as const) {
      store.setStatus(first.requestId, status);
      expect(toPublicRequestStatus(record)).toBe("processing");
    }

    store.markAudioReady(first.requestId, {
      audioId: second.requestId,
      audioPath: "C:/tmp/output.mp3",
      audioUrl: "http://127.0.0.1/audio/output.mp3",
      expiresAt: Date.now() + 300_000,
    });
    expect(toPublicRequestStatus(record)).toBe("audio_ready");

    store.complete(first.requestId);
    expect(toPublicRequestStatus(record)).toBe("completed");
  });

  it("retains terminal tombstones for 10 minutes and then garbage-collects them", () => {
    let now = 1_000;
    const store = new RequestStore({
      now: () => now,
      tombstoneTtlMs: 600_000,
      maxEntries: 10,
    });

    store.create(first);
    store.complete(first.requestId);
    now += 599_999;
    store.collectGarbage();
    expect(store.get(first.requestId)).toBeDefined();

    now += 2;
    store.collectGarbage();
    expect(store.get(first.requestId)).toBeUndefined();
  });

  it("keeps active records while bounding total entries by evicting old terminal tombstones", () => {
    let now = 1_000;
    const store = new RequestStore({
      now: () => now,
      tombstoneTtlMs: 600_000,
      maxEntries: 2,
    });

    store.create(first);
    store.complete(first.requestId);
    now += 1;
    store.create(second);
    store.complete(second.requestId);
    now += 1;
    const active = store.create({
      ...first,
      requestId: "7c2315db-7cf7-4de0-927e-f2f9e41fc1d1",
      inputPath: "C:/tmp/input-3.wav",
      inputSha256: "c".repeat(64),
    });

    store.collectGarbage();

    expect(store.get(first.requestId)).toBeUndefined();
    expect(store.get(second.requestId)).toBeDefined();
    expect(store.get(active.requestId)).toBeDefined();
  });

  it("marks expired requests terminal and releases the device", () => {
    const store = new RequestStore();
    store.create(first);
    store.markAudioReady(first.requestId, {
      audioId: second.requestId,
      audioPath: "C:/tmp/output.mp3",
      audioUrl: "http://127.0.0.1/audio/output.mp3",
      expiresAt: Date.now() - 1,
    });

    const expired = store.expire(first.requestId);

    expect(expired.status).toBe("expired");
    expect(toPublicRequestStatus(expired)).toBe("expired");
    expect(store.getActiveForDevice(first.deviceId)).toBeUndefined();
  });
});
