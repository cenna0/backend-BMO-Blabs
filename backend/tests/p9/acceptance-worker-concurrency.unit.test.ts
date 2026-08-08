import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildAcceptanceWorkerArgs,
  createAcceptanceWorkerName,
  main,
} from "../../src/p9/operator/acceptance-cli.js";
import type { AcceptanceConfig } from "../../src/p9/operator/acceptance-config.js";
import type { AcceptanceDocker } from "../../src/p9/operator/acceptance-runtime.js";

const temporaryDirectories: string[] = [];

function config(directory: string): AcceptanceConfig {
  return {
    database: "bmo_restore_acceptance_test",
    primaryDatabase: "bmo",
    port: 3025,
    bindHost: "127.0.0.1",
    network: "bmo-p9-1_p9_private",
    transportNetwork: "bmo-p9-1-restore-acceptance-transport",
    transportContainer: "bmo-p9-1-restore-acceptance-proxy",
    project: "bmo-p9-1-restore-acceptance",
    container: "bmo-p9-1-restore-acceptance-runtime",
    postgresContainer: "bmo-p9-1-postgres-1",
    image: "bmo-p9.1-candidate:test",
    codeDirectory: directory,
    internalPort: 3010,
    migrationsDisabled: true,
    postgresUser: "bmo",
    postgresPasswordFile: join(directory, "postgres-password"),
    canonicalAcceptancePasswordFile: join(directory, "acceptance-password"),
    runtimeEnvFile: join(directory, "runtime.env"),
  };
}

function syntheticEnvironment(): { directory: string; statePath: string } {
  const directory = mkdtempSync(join(tmpdir(), "p9-acceptance-worker-concurrency-"));
  temporaryDirectories.push(directory);
  const workspace = join(directory, "p9-acceptance");
  mkdirSync(workspace, { mode: 0o700 });
  for (const name of ["postgres-password", "acceptance-password", "runtime.env"]) {
    const path = join(directory, name);
    writeFileSync(path, "synthetic-test-only\n", { mode: 0o600 });
    chmodSync(path, 0o600);
  }
  const statePath = join(workspace, "fixture-state.json");
  writeFileSync(statePath, `${JSON.stringify({
    version: 1,
    database: "bmo_restore_acceptance_test",
    runId: "run-1234",
    userId: "11111111-1111-1111-1111-111111111111",
    email: "p9-acceptance-run-1234@example.invalid",
    providerSubject: "p9-acceptance:run-1234",
    displayName: "P9 restore acceptance fixture run-1234",
  })}\n`, { mode: 0o600 });
  for (const [key, value] of Object.entries({
    P9_ACCEPTANCE_DATABASE: "bmo_restore_acceptance_test",
    P9_ACCEPTANCE_PORT: "3025",
    P9_ACCEPTANCE_BIND_HOST: "127.0.0.1",
    P9_ACCEPTANCE_NETWORK: "bmo-p9-1_p9_private",
    P9_ACCEPTANCE_PROJECT: "bmo-p9-1-restore-acceptance",
    P9_ACCEPTANCE_CONTAINER: "bmo-p9-1-restore-acceptance-runtime",
    P9_ACCEPTANCE_POSTGRES_CONTAINER: "bmo-p9-1-postgres-1",
    P9_ACCEPTANCE_IMAGE: "bmo-p9.1-candidate:test",
    P9_ACCEPTANCE_CODE_DIR: directory,
    P9_ACCEPTANCE_MIGRATIONS_DISABLED: "true",
    P9_POSTGRES_USER: "bmo",
    P9_POSTGRES_PASSWORD_FILE: join(directory, "postgres-password"),
    P9_ACCEPTANCE_PASSWORD_FILE: join(directory, "acceptance-password"),
    P9_ACCEPTANCE_RUNTIME_ENV_FILE: join(directory, "runtime.env"),
    P9_ACCEPTANCE_STATE_FILE: statePath,
  })) vi.stubEnv(key, value);
  return { directory, statePath };
}

function workerName(args: string[]): string {
  const index = args.indexOf("--name");
  return args[index + 1] ?? "";
}

afterEach(() => {
  vi.unstubAllEnvs();
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("P9 acceptance disposable worker identity", () => {
  it("uses bounded operation-scoped names with a unique invocation suffix", () => {
    const first = createAcceptanceWorkerName("evidence-snapshot", "0123456789abcdef0123456789abcdef");
    const second = createAcceptanceWorkerName("evidence-snapshot", "fedcba9876543210fedcba9876543210");
    const operationNames = ["fixture-create", "fixture-status", "fixture-cleanup", "evidence-snapshot"].map((operation) =>
      createAcceptanceWorkerName(operation, "0123456789abcdef0123456789abcdef"),
    );

    expect(first).toBe("p9aw-evidence-snapshot-0123456789abcdef0123456789abcdef");
    expect(new Set([first, second, ...operationNames]).size).toBe(5);
    expect(first).toMatch(/^p9aw-[a-z-]+-[0-9a-f]{32}$/);
    expect(first.length).toBeLessThanOrEqual(63);
    expect(first).not.toMatch(/password|secret|token|credential|@/i);
    expect(() => createAcceptanceWorkerName("unknown-command", "0123456789abcdef0123456789abcdef")).toThrow();
  });

  it("keeps exact disposable ownership and cleanup semantics in worker args", () => {
    const directory = mkdtempSync(join(tmpdir(), "p9-acceptance-worker-args-"));
    temporaryDirectories.push(directory);
    const args = buildAcceptanceWorkerArgs(
      config(directory),
      "/tmp/p9-acceptance-state.json",
      "fixture-status",
      false,
      true,
      "0123456789abcdef0123456789abcdef",
    );

    expect(args).toContain("--rm");
    expect(args).toContain("p9aw-fixture-status-0123456789abcdef0123456789abcdef");
    expect(args.filter((value) => value === "--name")).toHaveLength(1);
    expect(args.some((value) => value.startsWith("p9aw-"))).toBe(true);
    expect(args.join(" ")).not.toMatch(/rm.*p9aw-.*\*/);
  });

  it("runs concurrent evidence and fixture status workers without a Docker name collision", async () => {
    const { statePath } = syntheticEnvironment();
    const names: string[] = [];
    let active = 0;
    let releaseBoth: () => void = () => undefined;
    const bothStarted = new Promise<void>((resolve) => { releaseBoth = resolve; });
    const docker: AcceptanceDocker = {
      run: async (args) => {
        if (args[0] !== "run") return { exitCode: 0, stdout: "", stderr: "" };
        const name = workerName(args);
        if (names.includes(name)) {
          releaseBoth();
          return { exitCode: 1, stdout: "", stderr: `Conflict: container name ${name} is already in use` };
        }
        names.push(name);
        active += 1;
        if (active === 2) releaseBoth();
        await bothStarted;
        return {
          exitCode: 0,
          stdout: args.at(-1) === "fixture-status" ? "fixture-present\n" : "{\"User\":50}\n",
          stderr: "",
        };
      },
    };
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const results = await Promise.all([
      main(["evidence:snapshot"], docker),
      main(["fixture:status"], docker),
    ]);

    expect(results).toEqual([0, 0]);
    expect(names).toHaveLength(2);
    expect(new Set(names).size).toBe(2);
    expect(names.some((name) => name.includes("evidence-snapshot"))).toBe(true);
    expect(names.some((name) => name.includes("fixture-status"))).toBe(true);
    expect(stderr).not.toHaveBeenCalledWith(expect.stringContaining("/auth/login"));
    expect(readFileSync(statePath, "utf8")).not.toContain("password");
    expect(names.every((name) => name.length <= 63)).toBe(true);
    stderr.mockRestore();
  });

  it("fails closed on a stale foreign worker without deleting any resource", async () => {
    syntheticEnvironment();
    const calls: string[][] = [];
    const docker: AcceptanceDocker = {
      run: async (args) => {
        calls.push(args);
        if (args[0] === "run") return { exitCode: 1, stdout: "", stderr: "container name is already in use" };
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    };

    await expect(main(["evidence:snapshot"], docker)).resolves.toBe(1);
    expect(calls.filter((args) => args[0] === "rm" || (args[0] === "network" && args[1] === "rm"))).toEqual([]);
  });

  it("does not delete worker B when worker A fails", async () => {
    syntheticEnvironment();
    const names: string[] = [];
    const calls: string[][] = [];
    const docker: AcceptanceDocker = {
      run: async (args) => {
        calls.push(args);
        if (args[0] !== "run") return { exitCode: 0, stdout: "", stderr: "" };
        names.push(workerName(args));
        return args.at(-1) === "evidence-snapshot"
          ? { exitCode: 1, stdout: "", stderr: "worker A failed" }
          : { exitCode: 0, stdout: "fixture-present\n", stderr: "" };
      },
    };

    const [failed, passed] = await Promise.all([
      main(["evidence:snapshot"], docker),
      main(["fixture:status"], docker),
    ]);

    expect([failed, passed]).toEqual([1, 0]);
    expect(new Set(names).size).toBe(2);
    expect(calls.filter((args) => args[0] === "rm" || (args[0] === "network" && args[1] === "rm"))).toEqual([]);
  });
});
