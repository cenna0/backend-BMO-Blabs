import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { main } from "../../src/p9/operator/acceptance-cli.js";
import type { AcceptanceDocker } from "../../src/p9/operator/acceptance-runtime.js";

const syntheticDirectories: string[] = [];

function configureSyntheticEnvironment(): string {
  const directory = mkdtempSync(join(tmpdir(), "p9-acceptance-cli-test-"));
  syntheticDirectories.push(directory);
  for (const name of ["postgres-password", "acceptance-password", "runtime.env"]) {
    const path = join(directory, name);
    writeFileSync(path, "synthetic-test-only\n", { mode: 0o600 });
    chmodSync(path, 0o600);
  }
  const env: Record<string, string> = {
    P9_ACCEPTANCE_DATABASE: "bmo_restore_acceptance_test",
    P9_ACCEPTANCE_PORT: "3025",
    P9_ACCEPTANCE_BIND_HOST: "127.0.0.1",
    P9_ACCEPTANCE_NETWORK: "bmo-p9-1_p9_private",
    P9_ACCEPTANCE_PROJECT: "bmo-p9-1-restore-acceptance",
    P9_ACCEPTANCE_CONTAINER: "bmo-p9-1-restore-acceptance-runtime",
    P9_ACCEPTANCE_POSTGRES_CONTAINER: "bmo-p9-1-postgres-1",
    P9_ACCEPTANCE_IMAGE: "bmo-p9.1-candidate:test",
    P9_ACCEPTANCE_CODE_DIR: process.cwd(),
    P9_ACCEPTANCE_MIGRATIONS_DISABLED: "true",
    P9_POSTGRES_USER: "bmo",
    P9_POSTGRES_PASSWORD_FILE: join(directory, "postgres-password"),
    P9_ACCEPTANCE_PASSWORD_FILE: join(directory, "acceptance-password"),
    P9_ACCEPTANCE_RUNTIME_ENV_FILE: join(directory, "runtime.env"),
    P9_ACCEPTANCE_STATE_FILE: join(directory, "fixture-state.json"),
  };
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  return directory;
}

describe("P9 acceptance CLI entrypoint", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    for (const directory of syntheticDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
  });

  it("executes one explicit command and returns success", async () => {
    configureSyntheticEnvironment();
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    const result = await main(["runtime:validate-config"]);

    expect(result).toBe(0);
    expect(stdout).toHaveBeenCalledWith("acceptance runtime configuration valid\n");
    expect(stdout).toHaveBeenCalledTimes(1);
    stdout.mockRestore();
  });

  it("returns a sanitized non-zero result when the command fails", async () => {
    configureSyntheticEnvironment();
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const result = await main(["unknown-command"]);

    expect(result).toBe(1);
    expect(String(stderr.mock.calls.at(-1)?.[0])).toContain("unknown P9 acceptance command");
    expect(String(stderr.mock.calls.at(-1)?.[0])).not.toContain("synthetic-test-only");
    stderr.mockRestore();
  });

  it("creates the host pending state, hands only a runtime copy to the worker, and atomically accepts returned state", async () => {
    const directory = configureSyntheticEnvironment();
    const statePath = join(directory, "fixture-state.json");
    const calls: string[][] = [];
    const docker: AcceptanceDocker = {
      run: async (args) => {
        calls.push(args);
        const pending = JSON.parse(readFileSync(statePath, "utf8")) as Record<string, unknown>;
        return {
          exitCode: 0,
          stdout: JSON.stringify({ state: { ...pending, userId: "11111111-1111-1111-1111-111111111111" } }),
          stderr: "",
        };
      },
    };

    const result = await main(["fixture:create"], docker);
    const output = JSON.stringify(readFileSync(statePath, "utf8"));

    expect(result).toBe(0);
    expect(output).toContain("11111111-1111-1111-1111-111111111111");
    expect(calls[0]?.join(" ")).toContain("destination=/run/secrets/acceptance_state_source,readonly");
    expect(calls[0]?.join(" ")).toContain("/run/p9-acceptance:rw");
    unlinkSync(statePath);
  });

  it("runs aggregate evidence without creating a state artifact", async () => {
    configureSyntheticEnvironment();
    const statePath = process.env.P9_ACCEPTANCE_STATE_FILE as string;
    delete process.env.P9_ACCEPTANCE_STATE_FILE;
    const calls: string[][] = [];
    const docker: AcceptanceDocker = {
      run: async (args) => {
        calls.push(args);
        return { exitCode: 0, stdout: "{\"User\":50}\n", stderr: "" };
      },
    };

    const result = await main(["evidence:snapshot"], docker);

    expect(result).toBe(0);
    expect(existsSync(statePath)).toBe(false);
    expect(calls[0]?.join(" ")).not.toContain("acceptance_state_source");
    expect(calls[0]?.join(" ")).not.toContain("/run/p9-acceptance");
  });
});
