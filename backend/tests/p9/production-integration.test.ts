import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import express from "express";

import {
  connectDevice,
  startTestRuntime,
  stopTestRuntime,
  type TestRuntime,
} from "../helpers/test-runtime.js";

const runtimes: TestRuntime[] = [];

afterEach(async () => {
  await Promise.all(runtimes.splice(0).map(stopTestRuntime));
});

describe("production-shaped P9 integration", () => {
  it("registers P9 and physical voice surfaces in the same Backend runtime", async () => {
    const runtime = await startTestRuntime(true, {
      TRUST_PROXY_HOPS: "1",
      P9_ENABLED: "true",
      DATABASE_URL: "postgresql://bmo:password@127.0.0.1:1/bmo",
      P9_JWT_SECRET: "j".repeat(32),
      P9_PAIRING_PEPPER: "p".repeat(32),
      P9_WIFI_ENCRYPTION_KEY: "w".repeat(32),
    });
    runtimes.push(runtime);

    expect(runtime.backend.p9).toBeDefined();
    expect(runtime.backend.app.get("trust proxy")).toBe(1);
    expect((await request(runtime.backend.app).post("/api/v1/auth/login").send({})).status).not.toBe(404);
    expect((await request(runtime.backend.app).get("/api/v1/chat/sessions")).status).toBe(401);
    expect((await request(runtime.backend.app).get("/api/v1/memories")).status).toBe(401);

    const device = await connectDevice(runtime);
    expect(device.socket.readyState).toBe(device.socket.OPEN);
    expect(runtime.backend.sockets.isAuthenticated("bmo-001")).toBe(true);
  });

  it("packages the review candidate as the full Backend runtime on private loopback ports", async () => {
    const dockerfile = await readFile(new URL("../../Dockerfile.p9.1", import.meta.url), "utf8");
    const compose = await readFile(new URL("../../../p9.1-compose.yml", import.meta.url), "utf8");

    expect(dockerfile).toContain('CMD ["node", "dist/src/server.js"]');
    expect(dockerfile).toContain("/livez");
    expect(dockerfile).not.toContain("dist/src/p9/candidate-server.js");
    expect(compose).toMatch(/backend:[\s\S]*network_mode: host/);
    expect(compose).toContain("BACKEND_HOST: 127.0.0.1");
    expect(compose).toContain('BACKEND_PORT: "3010"');
    expect(compose).toContain('TRUST_PROXY_HOPS: "0"');
    expect(compose).not.toMatch(/published:\s*"5433"/);
    expect(compose).not.toMatch(/postgres:[\s\S]*?ports:/);
    expect(compose).toContain("P9_POSTGRES_SOCKET_DIR: /var/run/postgresql");
    expect(compose.match(/source: p9_postgres_socket/g)).toHaveLength(2);
    expect(compose.match(/target: \/var\/run\/postgresql/g)).toHaveLength(2);
  });

  it("retries transient pending-chat recovery from periodic maintenance", async () => {
    const runtime = await startTestRuntime(true, {
      P9_ENABLED: "true",
      DATABASE_URL: "postgresql://bmo:password@127.0.0.1:1/bmo",
      P9_JWT_SECRET: "j".repeat(32),
      P9_PAIRING_PEPPER: "p".repeat(32),
      P9_WIFI_ENCRYPTION_KEY: "w".repeat(32),
    });
    runtimes.push(runtime);
    const resume = vi.spyOn(runtime.backend.p9!, "resumePendingChat")
      .mockRejectedValueOnce(new Error("transient database failure"))
      .mockResolvedValueOnce(0);

    await expect(runtime.backend.runMaintenance()).resolves.toBeUndefined();
    await expect(runtime.backend.runMaintenance()).resolves.toBeUndefined();

    expect(resume).toHaveBeenCalledTimes(2);
  });

  it("binds the listener without awaiting a blocked startup chat backlog", async () => {
    const blocked = new Promise<number>(() => undefined);
    const p9 = {
      initialize: vi.fn().mockResolvedValue(undefined),
      resumePendingChat: vi.fn().mockReturnValue(blocked),
      launchPendingChatRecovery: vi.fn(function (this: typeof p9) { void this.resumePendingChat(); }),
    };
    const app = express();
    app.get("/livez", (_request, response) => response.json({ status: "ok" }));
    const server = createServer(app);

    await p9.initialize();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    p9.launchPendingChatRecovery();
    const address = server.address();
    expect(address && typeof address !== "string").toBe(true);
    await request(app).get("/livez").expect(200);
    expect(p9.resumePendingChat).toHaveBeenCalledOnce();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });
});
