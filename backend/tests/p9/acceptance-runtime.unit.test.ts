import { describe, expect, it } from "vitest";

import {
  ACCEPTANCE_IDENTITY_PATH,
  ACCEPTANCE_READINESS_PROBE_TIMEOUT_MS,
  ACCEPTANCE_READINESS_PATH,
  ACCEPTANCE_STARTUP_POLL_INTERVAL_MS,
  ACCEPTANCE_STARTUP_TIMEOUT_MS,
  buildAcceptanceRuntimeArgs,
  startAcceptanceRuntime,
  statusAcceptanceRuntime,
  stopAcceptanceRuntime,
  type AcceptanceDocker,
  type AcceptanceRuntimeHttpClient,
  type AcceptanceRuntimeWaitOptions,
} from "../../src/p9/operator/acceptance-runtime.js";
import { buildAcceptanceWorkerArgs } from "../../src/p9/operator/acceptance-cli.js";
import type { AcceptanceConfig } from "../../src/p9/operator/acceptance-config.js";

const config: AcceptanceConfig = {
  database: "bmo_restore_acceptance_test",
  primaryDatabase: "bmo",
  port: 3025,
  bindHost: "127.0.0.1",
  network: "bmo-p9-1_p9_private",
  project: "bmo-p9-1-restore-acceptance",
  container: "bmo-p9-1-restore-acceptance-runtime",
  postgresContainer: "bmo-p9-1-postgres-1",
  image: "bmo-p9.1-candidate:test",
  codeDirectory: "/opt/bmo/app/backend/dist/src",
  internalPort: 3010,
  migrationsDisabled: true,
  postgresUser: "bmo",
  postgresPasswordFile: "/tmp/postgres-password",
  canonicalAcceptancePasswordFile: "/tmp/acceptance-password",
  runtimeEnvFile: "/tmp/acceptance-runtime.env",
};

function fakeDocker(responses: Array<Partial<Awaited<ReturnType<AcceptanceDocker["run"]>>> & { exitCode: number; stdout?: string; stderr?: string }> = []) {
  const calls: string[][] = [];
  const docker: AcceptanceDocker = {
    run: async (args) => {
      calls.push(args);
      const response = responses[calls.length - 1] ?? { exitCode: 0 };
      return { stdout: "", stderr: "", ...response };
    },
  };
  return { docker, calls };
}

function startupDocker(responses: Array<Partial<Awaited<ReturnType<AcceptanceDocker["run"]>>> & { exitCode: number; stdout?: string; stderr?: string }> = []) {
  return fakeDocker([
    { exitCode: 0 },
    { exitCode: 0, stdout: "bmo-p9.1-candidate:test\n" },
    { exitCode: 1, stderr: "No such container" },
    { exitCode: 0, stdout: "1\n" },
    { exitCode: 0, stdout: "container-id\n" },
    ...responses,
  ]);
}

function readinessHttp(responses: Array<{ status: number; body?: unknown } | Error>) {
  const calls: string[] = [];
  const http: AcceptanceRuntimeHttpClient = {
    request: async (path) => {
      calls.push(path);
      const response = responses[calls.length - 1];
      if (response instanceof Error) throw response;
      return response ?? { status: 500 };
    },
  };
  return { http, calls };
}

function deterministicWait(): AcceptanceRuntimeWaitOptions {
  let time = 0;
  return {
    timeoutMs: 20,
    pollIntervalMs: 5,
    now: () => time,
    sleep: async (milliseconds) => { time += milliseconds; },
  };
}

describe("P9 restored-target acceptance runtime", () => {
  it("builds a Docker run that only publishes loopback and targets the restore database", () => {
    const args = buildAcceptanceRuntimeArgs(config);

    expect(args).toEqual(expect.arrayContaining([
      "run",
      "--detach",
      "--name", config.container,
      "--network", config.network,
      "--publish", "127.0.0.1:3025:3010",
      "--env-file", config.runtimeEnvFile,
      "--env", "P9_POSTGRES_DB=bmo_restore_acceptance_test",
      "--env", "P9_ACCEPTANCE_MIGRATIONS_DISABLED=true",
      "--mount", "type=bind,source=/opt/bmo/app/backend/dist/src,destination=/app/dist/src,readonly",
      config.image,
      "node", "dist/src/p9/candidate-server.js",
    ]));
    expect(args.join(" ")).not.toContain("postgres:5432");
    expect(args.join(" ")).not.toContain("P9_ACCEPTANCE_PASSWORD_FILE=");
  });

  it("checks the private network, candidate image, existing target, and empty acceptance identity before starting", async () => {
    const { docker, calls } = fakeDocker([
      { exitCode: 0 },
      { exitCode: 0, stdout: "bmo-p9.1-candidate:test\n" },
      { exitCode: 1, stderr: "No such container" },
      { exitCode: 0, stdout: "1\n" },
      { exitCode: 0, stdout: "container-id\n" },
      { exitCode: 0, stdout: "running|0\n" },
    ]);
    const { http } = readinessHttp([{ status: 200, body: { status: "ok", database: "ready" } }]);

    await expect(startAcceptanceRuntime(config, docker, { http })).resolves.toMatchObject({ container: config.container, database: config.database });
    expect(calls[0]).toEqual(["network", "inspect", config.network]);
    expect(calls[1]).toEqual(["inspect", "--format", "{{.Config.Image}}", "bmo-p9-1-backend-1"]);
    expect(calls[2]).toEqual(["inspect", config.container]);
    expect(calls[3]?.slice(0, 5)).toEqual(["exec", config.postgresContainer, "psql", "-U", "bmo"]);
    expect(calls[4]?.[0]).toBe("run");
    expect(calls.filter((args) => args[0] === "run")).toHaveLength(1);
  });

  it("keeps the single runtime after a connection-refused first probe and passes on the next probe", async () => {
    const { docker, calls } = startupDocker([{ exitCode: 0, stdout: "running|0\n" }, { exitCode: 0, stdout: "running|0\n" }]);
    const { http, calls: httpCalls } = readinessHttp([
      new Error("connect ECONNREFUSED 127.0.0.1:3025"),
      { status: 200, body: { status: "ok", database: "ready" } },
    ]);

    await expect(startAcceptanceRuntime(config, docker, { http, ...deterministicWait() })).resolves.toMatchObject({ container: config.container });

    expect(httpCalls).toEqual([ACCEPTANCE_READINESS_PATH, ACCEPTANCE_READINESS_PATH]);
    expect(calls.filter((args) => args[0] === "run")).toHaveLength(1);
    expect(calls.some((args) => args[0] === "rm")).toBe(false);
  });

  it("retries several transient connection failures within the startup deadline", async () => {
    const { docker } = startupDocker([
      { exitCode: 0, stdout: "running|0\n" },
      { exitCode: 0, stdout: "running|0\n" },
      { exitCode: 0, stdout: "running|0\n" },
      { exitCode: 0, stdout: "running|0\n" },
    ]);
    const { http, calls } = readinessHttp([
      new Error("connection refused"),
      new Error("connection refused"),
      new Error("connection refused"),
      { status: 200, body: { status: "ok", database: "ready" } },
    ]);

    await expect(startAcceptanceRuntime(config, docker, { http, ...deterministicWait() })).resolves.toBeDefined();
    expect(calls).toHaveLength(4);
  });

  it("fails finitely and cleans the runtime when readiness never succeeds", async () => {
    const { docker, calls } = startupDocker([
      { exitCode: 0, stdout: "running|0\n" },
      { exitCode: 0, stdout: "running|0\n" },
      { exitCode: 0, stdout: "running|0\n" },
      { exitCode: 0, stdout: "running|0\n" },
      { exitCode: 0, stdout: "running|0\n" },
      { exitCode: 0, stdout: "running|0\n" },
      { exitCode: 0, stdout: "state P9_ACCEPTANCE_PASSWORD=not-real\n" },
      { exitCode: 0, stdout: "log P9_ACCEPTANCE_PASSWORD=not-real\n" },
      { exitCode: 0 },
    ]);
    const { http } = readinessHttp([
      { status: 503, body: { status: "error", database: "unavailable" } },
      { status: 503, body: { status: "error", database: "unavailable" } },
      { status: 503, body: { status: "error", database: "unavailable" } },
      { status: 503, body: { status: "error", database: "unavailable" } },
      { status: 503, body: { status: "error", database: "unavailable" } },
    ]);

    const failure = await startAcceptanceRuntime(config, docker, { http, ...deterministicWait() }).catch((error) => error);
    expect(String(failure)).toMatch(/timed out|not ready/);
    expect(calls.filter((args) => args[0] === "run")).toHaveLength(1);
    expect(calls.at(-1)).toEqual(["rm", "--force", config.container]);
    expect(String(failure)).not.toContain("not-real");
  });

  it("fails immediately when the container exits before readiness", async () => {
    const { docker, calls } = startupDocker([
      { exitCode: 0, stdout: "exited|1\n" },
      { exitCode: 0, stdout: "exited|1\n" },
      { exitCode: 0, stdout: "crash P9_ACCEPTANCE_PASSWORD=not-real\n" },
      { exitCode: 0 },
    ]);
    const { http, calls: httpCalls } = readinessHttp([]);

    await expect(startAcceptanceRuntime(config, docker, { http, ...deterministicWait() })).rejects.toThrow(/exited/);
    expect(httpCalls).toHaveLength(0);
    expect(calls.filter((args) => args[0] === "run")).toHaveLength(1);
    expect(calls.at(-1)).toEqual(["rm", "--force", config.container]);
  });

  it("keeps unexpected readiness statuses not-ready until a valid response", async () => {
    const { docker } = startupDocker([
      { exitCode: 0, stdout: "running|0\n" },
      { exitCode: 0, stdout: "running|0\n" },
      { exitCode: 0, stdout: "running|0\n" },
    ]);
    const { http, calls } = readinessHttp([
      { status: 200, body: { status: "ok", database: "unavailable" } },
      { status: 503, body: { status: "ok", database: "ready" } },
      { status: 200, body: { status: "ok", database: "ready" } },
    ]);

    await expect(startAcceptanceRuntime(config, docker, { http, ...deterministicWait() })).resolves.toBeDefined();
    expect(calls).toHaveLength(3);
  });

  it("defines explicit bounded startup defaults", () => {
    expect(ACCEPTANCE_STARTUP_TIMEOUT_MS).toBe(30_000);
    expect(ACCEPTANCE_STARTUP_POLL_INTERVAL_MS).toBe(250);
    expect(ACCEPTANCE_READINESS_PROBE_TIMEOUT_MS).toBe(3_000);
    expect(ACCEPTANCE_READINESS_PATH).toBe("/api/v1/ops/db/readyz");
    expect(ACCEPTANCE_IDENTITY_PATH).toBe("/api/v1/ops/db/identity");
  });

  it("fails before Docker run when the target database does not exist", async () => {
    const { docker, calls } = fakeDocker([
      { exitCode: 0 },
      { exitCode: 0, stdout: "bmo-p9.1-candidate:test\n" },
      { exitCode: 1 },
      { exitCode: 0, stdout: "\n" },
    ]);

    await expect(startAcceptanceRuntime(config, docker)).rejects.toThrow(/target database/);
    expect(calls.every((args) => args[0] !== "run")).toBe(true);
  });

  it("removes only the acceptance container when its Docker start fails", async () => {
    const { docker, calls } = fakeDocker([
      { exitCode: 0 },
      { exitCode: 0, stdout: "bmo-p9.1-candidate:test\n" },
      { exitCode: 1, stderr: "No such container" },
      { exitCode: 0, stdout: "1\n" },
      { exitCode: 1, stderr: "start failed" },
      { exitCode: 0 },
    ]);

    await expect(startAcceptanceRuntime(config, docker)).rejects.toThrow(/start failed/);
    expect(calls.at(-1)).toEqual(["rm", "--force", config.container]);
  });

  it("reports only the named acceptance runtime and proves its configured target", async () => {
    const { docker, calls } = fakeDocker([
      { exitCode: 0, stdout: "running|bmo-p9.1-candidate:test\n" },
      { exitCode: 0, stdout: "bmo_restore_acceptance_test\n" },
      { exitCode: 0, stdout: "true\n" },
    ]);

    await expect(statusAcceptanceRuntime(config, docker)).resolves.toEqual({
      container: config.container,
      database: config.database,
      image: config.image,
      status: "running",
      migrationsDisabled: true,
    });
    expect(calls.map((args) => args[0])).toEqual(["inspect", "exec", "exec"]);
  });

  it("stops only the exact acceptance container", async () => {
    const { docker, calls } = fakeDocker([{ exitCode: 0 }]);

    await expect(stopAcceptanceRuntime(config, docker)).resolves.toBeUndefined();
    expect(calls).toEqual([["rm", "--force", config.container]]);
  });

  it("runs fixture/evidence commands in the backend image without creating PostgreSQL", () => {
    const args = buildAcceptanceWorkerArgs(config, "/tmp/p9-acceptance-state.json", "fixture-status", false);

    expect(args).toEqual(expect.arrayContaining(["run", "--rm", "--network", config.network, "node", "dist/src/p9/operator/acceptance-worker-entrypoint.js", "fixture-status"]));
    expect(args).toEqual(expect.arrayContaining([
      "--tmpfs", "/run/p9-acceptance:rw,noexec,nosuid,nodev,uid=1000,gid=1000,mode=0700",
      "--env", "P9_ACCEPTANCE_STATE_FILE=/run/p9-acceptance/fixture-state.json",
      "--env", "P9_ACCEPTANCE_STATE_SOURCE_FILE=/run/secrets/acceptance_state_source",
      "--mount", "type=bind,source=/tmp/p9-acceptance-state.json,destination=/run/secrets/acceptance_state_source,readonly",
    ]));
    expect(args).not.toContain("postgres");
    expect(args).not.toContain("postgres:16.10-alpine3.22");
  });

  it("runs pre-fixture aggregate evidence without creating or mounting state", () => {
    const args = buildAcceptanceWorkerArgs(config, "/tmp/p9-acceptance-state.json", "evidence-snapshot", false, false);
    const joined = args.join(" ");

    expect(joined).toContain("dist/src/p9/operator/acceptance-worker-entrypoint.js evidence-snapshot");
    expect(joined).not.toContain("acceptance_state_source");
    expect(joined).not.toContain("P9_ACCEPTANCE_STATE_FILE=");
    expect(joined).not.toContain("/run/p9-acceptance");
  });

  it("hands the canonical password to a private tmpfs bootstrap, never directly to UID 1000", () => {
    const args = buildAcceptanceWorkerArgs(config, "/tmp/p9-acceptance-state.json", "fixture-create", true);
    const joined = args.join(" ");

    expect(args).toEqual(expect.arrayContaining([
      "--tmpfs", "/run/bmo-p9.1:rw,noexec,nosuid,nodev,mode=0755",
      "--env", "P9_ACCEPTANCE_PASSWORD_FILE=/run/bmo-p9.1/acceptance-password",
      "--env", "P9_ACCEPTANCE_PASSWORD_SOURCE_FILE=/run/secrets/acceptance_password_source",
      "--mount", "type=bind,source=/tmp/acceptance-password,destination=/run/secrets/acceptance_password_source,readonly",
    ]));
    expect(joined).not.toContain("P9_ACCEPTANCE_PASSWORD_FILE=/tmp/acceptance-password");
    expect(joined).not.toContain("synthetic-password");
  });
});
