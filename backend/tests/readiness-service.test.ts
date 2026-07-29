import { describe, expect, it, vi } from "vitest";

import { BackendReadinessService } from "../src/services/readiness.service.js";

describe("BackendReadinessService", () => {
  it("probes the mandatory Hermes and Audio Service readiness endpoints", async () => {
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      const target = String(url);
      if (target === "http://127.0.0.1:8642/health") {
        return Response.json({ status: "ok" });
      }
      if (target === "http://127.0.0.1:8001/readyz") {
        return Response.json({
          status: "degraded",
          stt_loaded: true,
          kokoro_loaded: true,
          rvc_available: false,
          ffmpeg_available: true,
        });
      }
      throw new Error(`unexpected URL: ${target}`);
    });
    const readiness = new BackendReadinessService({
      hermesBaseUrl: "http://127.0.0.1:8642/",
      audioServiceBaseUrl: "http://127.0.0.1:8001/",
      timeoutMs: 100,
      fetcher,
    });

    await expect(readiness.check()).resolves.toEqual({
      hermesReady: true,
      audioReady: true,
      rvcAvailable: false,
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("contains dependency errors as not-ready state", async () => {
    const readiness = new BackendReadinessService({
      hermesBaseUrl: "http://127.0.0.1:8642",
      audioServiceBaseUrl: "http://127.0.0.1:8001",
      timeoutMs: 100,
      fetcher: async (url) => {
        if (String(url).endsWith("/health")) return Response.json({ status: "ok" });
        throw new Error("connection refused");
      },
    });

    await expect(readiness.check()).resolves.toEqual({
      hermesReady: true,
      audioReady: false,
      rvcAvailable: false,
    });
  });

  it("bounds stalled dependency probes", async () => {
    const readiness = new BackendReadinessService({
      hermesBaseUrl: "http://127.0.0.1:8642",
      audioServiceBaseUrl: "http://127.0.0.1:8001",
      timeoutMs: 10,
      fetcher: async (_url, init) =>
        await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("aborted", "AbortError")),
            { once: true },
          );
        }),
    });

    await expect(readiness.check()).resolves.toEqual({
      hermesReady: false,
      audioReady: false,
      rvcAvailable: false,
    });
  });
});
