import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })));
});

async function runEntrypoint(expectedHost: string, extraEnvironment: NodeJS.ProcessEnv): Promise<number | null> {
  const directory = await mkdtemp(join(tmpdir(), "bmo-p9-entrypoint-"));
  temporaryDirectories.push(directory);
  const passwordFile = join(directory, "postgres-password");
  await writeFile(passwordFile, "test-only-placeholder\n", { mode: 0o600 });
  const entrypoint = fileURLToPath(new URL("../../src/p9/entrypoint.ts", import.meta.url));
  const assertion = [
    "const parsed = new URL(process.env.DATABASE_URL);",
    `const expected = ${JSON.stringify(expectedHost)};`,
    "const actual = parsed.searchParams.get('host') ?? `${parsed.hostname}:${parsed.port}`;",
    "process.exit(actual === expected ? 0 : 1);",
  ].join(" ");
  const child = spawn(process.execPath, ["--import", "tsx", entrypoint, process.execPath, "-e", assertion], {
    env: {
      ...process.env,
      DATABASE_URL: "",
      P9_DATABASE_PASSWORD_FILE: passwordFile,
      P9_POSTGRES_USER: "bmo",
      P9_POSTGRES_DB: "bmo",
      ...extraEnvironment,
    },
    stdio: "ignore",
  });
  return await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });
}

describe("P9 candidate database URL construction", () => {
  it("uses the configured PostgreSQL Unix-socket directory", async () => {
    await expect(runEntrypoint("/var/run/postgresql", {
      P9_POSTGRES_SOCKET_DIR: "/var/run/postgresql",
      P9_POSTGRES_HOST: "ignored-host",
      P9_POSTGRES_PORT: "6543",
    })).resolves.toBe(0);
  });

  it("preserves hostname and port fallback when no socket directory is configured", async () => {
    await expect(runEntrypoint("postgres.internal:6543", {
      P9_POSTGRES_SOCKET_DIR: "",
      P9_POSTGRES_HOST: "postgres.internal",
      P9_POSTGRES_PORT: "6543",
    })).resolves.toBe(0);
  });
});
