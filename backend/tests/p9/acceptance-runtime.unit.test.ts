import { describe, expect, it } from "vitest";

import {
  buildAcceptanceRuntimeArgs,
  startAcceptanceRuntime,
  statusAcceptanceRuntime,
  stopAcceptanceRuntime,
  type AcceptanceDocker,
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
    ]);

    await expect(startAcceptanceRuntime(config, docker)).resolves.toMatchObject({ container: config.container, database: config.database });
    expect(calls[0]).toEqual(["network", "inspect", config.network]);
    expect(calls[1]).toEqual(["inspect", "--format", "{{.Config.Image}}", "bmo-p9-1-backend-1"]);
    expect(calls[2]).toEqual(["inspect", config.container]);
    expect(calls[3]?.slice(0, 5)).toEqual(["exec", config.postgresContainer, "psql", "-U", "bmo"]);
    expect(calls[4]?.[0]).toBe("run");
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
