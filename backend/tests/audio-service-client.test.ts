import { describe, expect, it, vi } from "vitest";

import {
  AudioServiceClient,
  AudioServiceClientError,
} from "../src/services/audio-service.client.js";

describe("AudioServiceClient", () => {
  it("sends raw WAV to /stt/transcribe with internal auth token", async () => {
    const wav = Buffer.from("wav");
    const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
      expect(_url).toBe("http://127.0.0.1:8001/stt/transcribe");
      expect(new Headers(init.headers).get("x-internal-service-token")).toBe("internal-token-123");
      expect(new Headers(init.headers).get("content-type")).toBe("audio/wav");
      expect(Buffer.from(init.body as ArrayBuffer)).toEqual(wav);
      return new Response(
        JSON.stringify({
          text: "hello bmo",
          speech_detected: true,
          language: "en",
          language_probability: 0.99,
          duration_seconds: 1.2,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    const client = new AudioServiceClient({
      baseUrl: "http://127.0.0.1:8001",
      internalToken: "internal-token-123",
      sttTimeoutMs: 1_000,
      ttsTimeoutMs: 1_000,
      fetcher,
    });

    await expect(client.transcribe(wav)).resolves.toEqual({
      text: "hello bmo",
      speechDetected: true,
      language: "en",
      languageProbability: 0.99,
      durationSeconds: 1.2,
    });
  });

  it("sends sanitized text to /tts/synthesize and returns MP3 bytes plus headers", async () => {
    const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
      expect(_url).toBe("http://127.0.0.1:8001/tts/synthesize");
      expect(JSON.parse(String(init.body))).toEqual({
        request_id: "550e8400-e29b-41d4-a716-446655440000",
        text: "Hi! BMO is ready.",
        use_rvc: true,
      });
      return new Response(Buffer.from("mp3"), {
        status: 200,
        headers: {
          "content-type": "audio/mpeg",
          "x-rvc-applied": "false",
          "x-tts-engine": "kokoro",
        },
      });
    });
    const client = new AudioServiceClient({
      baseUrl: "http://127.0.0.1:8001/",
      internalToken: "internal-token-123",
      sttTimeoutMs: 1_000,
      ttsTimeoutMs: 1_000,
      fetcher,
    });

    await expect(
      client.synthesize("550e8400-e29b-41d4-a716-446655440000", "Hi! BMO is ready.", true),
    ).resolves.toEqual({
      audio: Buffer.from("mp3"),
      rvcApplied: false,
      ttsEngine: "kokoro",
    });
  });

  it("maps non-2xx and timeout to stage-specific errors", async () => {
    const failed = new AudioServiceClient({
      baseUrl: "http://local",
      internalToken: "token",
      sttTimeoutMs: 1_000,
      ttsTimeoutMs: 1_000,
      fetcher: async () => new Response("bad", { status: 500 }),
    });
    await expect(failed.transcribe(Buffer.from("wav"))).rejects.toBeInstanceOf(AudioServiceClientError);
    await expect(failed.transcribe(Buffer.from("wav"))).rejects.toMatchObject({ code: "STT_FAILED" });
    await expect(failed.synthesize("550e8400-e29b-41d4-a716-446655440000", "Hi.", true)).rejects.toMatchObject({
      code: "TTS_FAILED",
    });

    const timeout = new AudioServiceClient({
      baseUrl: "http://local",
      internalToken: "token",
      sttTimeoutMs: 1,
      ttsTimeoutMs: 1,
      fetcher: (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    });
    await expect(timeout.transcribe(Buffer.from("wav"))).rejects.toMatchObject({ code: "STT_FAILED" });
  });
});
