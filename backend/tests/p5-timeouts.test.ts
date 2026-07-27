import { describe, expect, it } from "vitest";

import { AudioServiceClient } from "../src/services/audio-service.client.js";
import { HermesResponsesClient } from "../src/services/hermes.client.js";

describe("P5 explicit stage timeouts", () => {
  it("maps STT and TTS AbortController timeouts to stage-specific failures", async () => {
    const client = new AudioServiceClient({
      baseUrl: "http://local",
      internalToken: "token",
      sttTimeoutMs: 1,
      ttsTimeoutMs: 1,
      fetcher: (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
    });

    await expect(client.transcribe(Buffer.from("wav"))).rejects.toMatchObject({ code: "STT_FAILED" });
    await expect(client.synthesize("550e8400-e29b-41d4-a716-446655440000", "Hi.", true)).rejects.toMatchObject({
      code: "TTS_FAILED",
    });
  });

  it("logs Hermes soft timeout and maps hard timeout to HERMES_FAILED", async () => {
    const warnings: unknown[] = [];
    const client = new HermesResponsesClient({
      baseUrl: "http://local",
      apiKey: "key",
      model: "hermes-agent",
      conversation: "bmo-001",
      softTimeoutMs: 1,
      hardTimeoutMs: 5,
      logger: { warn: (bindings) => warnings.push(bindings) },
      fetcher: (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
    });

    await expect(client.generate("hi")).rejects.toMatchObject({ code: "HERMES_FAILED" });
    expect(warnings).toContainEqual({ timeout_ms: 1 });
  });
});
