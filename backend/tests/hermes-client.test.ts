import { describe, expect, it, vi } from "vitest";

import {
  BMO_RUNTIME_INSTRUCTIONS,
  HermesChatCompletionsClient,
  HermesClientError,
  HermesResponsesClient,
  detectProviderError,
  parseChatCompletionsText,
  parseResponsesText,
  sanitizeHermesOutput,
} from "../src/services/hermes.client.js";

const completedFixture = {
  id: "resp_1",
  status: "completed",
  output: [
    { type: "function_call", name: "ignored_tool", arguments: "{\"secret\":\"nope\"}" },
    {
      type: "message",
      content: [
        { type: "refusal", refusal: "ignored" },
        { type: "output_text", text: "Hi! BMO is right here with you." },
      ],
    },
  ],
};

describe("Hermes Responses parser", () => {
  it("extracts output_text from message items without relying on output[0]", () => {
    expect(parseResponsesText(completedFixture)).toBe("Hi! BMO is right here with you.");
  });

  it("rejects incomplete responses, empty output, and tool-only payloads", () => {
    expect(() => parseResponsesText({ status: "in_progress", output: [] })).toThrow(HermesClientError);
    expect(() => parseResponsesText({ status: "completed", output: [] })).toThrow(HermesClientError);
    expect(() => parseResponsesText({ status: "completed", output: [{ type: "function_call" }] })).toThrow(
      HermesClientError,
    );
  });

  it("parses chat-completions fallback separately", () => {
    expect(
      parseChatCompletionsText({
        choices: [{ message: { content: "Hello from chat fallback." } }],
      }),
    ).toBe("Hello from chat fallback.");
  });
});

describe("Hermes output sanitizer", () => {
  it("removes markdown, URLs, code fences, extra whitespace, and keeps three short sentences", () => {
    const output = sanitizeHermesOutput(
      "```md\n# Hello **friend**\nVisit https://example.com now.\nOne. Two. Three. Four.\n```",
    );

    expect(output).toBe("Hello friend Visit now. One. Two.");
  });

  it("detects provider/internal errors defensively", () => {
    expect(detectProviderError("Provider request failed: unauthorized")).toBe(true);
    expect(detectProviderError("BMO can help after a timeout game.")).toBe(false);
  });
});

describe("Hermes clients", () => {
  it("sends canonical /v1/responses body with BMO instructions every request", async () => {
    const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
      expect(JSON.parse(String(init.body))).toEqual({
        model: "hermes-agent",
        instructions: BMO_RUNTIME_INSTRUCTIONS,
        input: "halo bmo",
        conversation: "bmo-001",
        store: true,
        stream: false,
        truncation: "auto",
      });
      expect(new Headers(init.headers).get("authorization")).toBe("Bearer test-hermes-key");
      return new Response(JSON.stringify(completedFixture), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const client = new HermesResponsesClient({
      baseUrl: "http://127.0.0.1:8642",
      apiKey: "test-hermes-key",
      model: "hermes-agent",
      conversation: "bmo-001",
      hardTimeoutMs: 1_000,
      fetcher,
    });

    await expect(client.generate("halo bmo")).resolves.toBe("Hi! BMO is right here with you.");
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("maps non-2xx, invalid JSON, provider error output, and timeout to HERMES_FAILED", async () => {
    const non2xx = new HermesResponsesClient({
      baseUrl: "http://local",
      apiKey: "key",
      model: "hermes-agent",
      conversation: "bmo-001",
      hardTimeoutMs: 1_000,
      fetcher: async () => new Response("bad", { status: 503 }),
    });
    await expect(non2xx.generate("hi")).rejects.toMatchObject({ code: "HERMES_FAILED" });

    const invalidJson = new HermesResponsesClient({
      baseUrl: "http://local",
      apiKey: "key",
      model: "hermes-agent",
      conversation: "bmo-001",
      hardTimeoutMs: 1_000,
      fetcher: async () => new Response("{", { status: 200 }),
    });
    await expect(invalidJson.generate("hi")).rejects.toMatchObject({ code: "HERMES_FAILED" });

    const providerError = new HermesResponsesClient({
      baseUrl: "http://local",
      apiKey: "key",
      model: "hermes-agent",
      conversation: "bmo-001",
      hardTimeoutMs: 1_000,
      fetcher: async () =>
        new Response(
          JSON.stringify({
            status: "completed",
            output: [{ type: "message", content: [{ type: "output_text", text: "Provider request failed: rate limit" }] }],
          }),
          { status: 200 },
        ),
    });
    await expect(providerError.generate("hi")).rejects.toMatchObject({ code: "HERMES_FAILED" });

    const timeout = new HermesResponsesClient({
      baseUrl: "http://local",
      apiKey: "key",
      model: "hermes-agent",
      conversation: "bmo-001",
      hardTimeoutMs: 1,
      fetcher: (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    });
    await expect(timeout.generate("hi")).rejects.toMatchObject({ code: "HERMES_FAILED" });
  });

  it("keeps chat-completions adapter documented but separate", async () => {
    const client = new HermesChatCompletionsClient({
      baseUrl: "http://127.0.0.1:8642",
      apiKey: "test-hermes-key",
      model: "hermes-agent",
      conversation: "bmo-001",
      hardTimeoutMs: 1_000,
      fetcher: async () =>
        new Response(JSON.stringify({ choices: [{ message: { content: "Hi there." } }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    });

    await expect(client.generate("hi")).resolves.toBe("Hi there.");
  });
});
