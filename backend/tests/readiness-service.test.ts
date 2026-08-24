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
          status: "ok",
          stt_loaded: true,
          piper_loaded: true,
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
    });
  });

  it("includes sanitized P9 database readiness when the callback is configured", async () => {
    const databaseReadiness = vi.fn().mockResolvedValue(true);
    const readiness = new BackendReadinessService({
      hermesBaseUrl: "http://127.0.0.1:8642",
      audioServiceBaseUrl: "http://127.0.0.1:8001",
      timeoutMs: 100,
      fetcher: async (url) => String(url).endsWith("/health")
        ? Response.json({ status: "ok" })
        : Response.json({
          status: "ok",
          stt_loaded: true,
          piper_loaded: true,
          ffmpeg_available: true,
        }),
      databaseReadiness,
    });

    await expect(readiness.check()).resolves.toEqual({
      hermesReady: true,
      audioReady: true,
      databaseReady: true,
    });
    expect(databaseReadiness).toHaveBeenCalledTimes(1);
  });

  it("contains P9 probe failures as database not-ready", async () => {
    const readiness = new BackendReadinessService({
      hermesBaseUrl: "http://127.0.0.1:8642",
      audioServiceBaseUrl: "http://127.0.0.1:8001",
      timeoutMs: 100,
      fetcher: async (url) => String(url).endsWith("/health")
        ? Response.json({ status: "ok" })
        : Response.json({
          status: "ok",
          stt_loaded: true,
          piper_loaded: true,
          ffmpeg_available: true,
        }),
      databaseReadiness: vi.fn().mockRejectedValue(new Error("private database detail")),
    });

    await expect(readiness.check()).resolves.toEqual({
      hermesReady: true,
      audioReady: true,
      databaseReady: false,
    });
  });

  it("bounds a stalled database probe and contains its late rejection", async () => {
    let rejectDatabase!: (error: Error) => void;
    const readiness = new BackendReadinessService({
      hermesBaseUrl: "http://127.0.0.1:8642",
      audioServiceBaseUrl: "http://127.0.0.1:8001",
      timeoutMs: 20,
      fetcher: async (url) => String(url).endsWith("/health")
        ? Response.json({ status: "ok" })
        : Response.json({
          status: "ok",
          stt_loaded: true,
          piper_loaded: true,
          ffmpeg_available: true,
        }),
      databaseReadiness: () => new Promise<boolean>((_resolve, reject) => {
        rejectDatabase = reject;
      }),
    });
    const startedAt = performance.now();

    const outcome = await Promise.race([
      readiness.check(),
      new Promise<"test_timeout">((resolve) => setTimeout(() => resolve("test_timeout"), 150)),
    ]);

    expect(outcome).toEqual({
      hermesReady: true,
      audioReady: true,
      databaseReady: false,
    });
    expect(performance.now() - startedAt).toBeLessThan(150);
    rejectDatabase(new Error("late private database detail"));
    await new Promise<void>((resolve) => setImmediate(resolve));
  });
});
