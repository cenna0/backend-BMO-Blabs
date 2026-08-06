import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { spawn, type ChildProcess } from "node:child_process";

import { describe, expect, it, vi } from "vitest";

import {
  composeEnvironment,
  sanitizeChildOutput,
  validateComposeConfiguration,
  waitForProcess,
} from "../../src/p9/operator/compose.js";

function fakeChild(
  code: number,
  stdout = "",
  stderr = "",
): ChildProcess {
  const child = new EventEmitter() as ChildProcess;
  const stdoutStream = new PassThrough();
  const stderrStream = new PassThrough();
  Object.assign(child, { stdout: stdoutStream, stderr: stderrStream });
  queueMicrotask(() => {
    stdoutStream.end(stdout);
    stderrStream.end(stderr);
    child.emit("close", code);
  });
  return child;
}

describe("P9 Compose backup boundary", () => {
  it("passes only the validated PostgreSQL password-file path into Compose", () => {
    const passwordPath = "/tmp/synthetic-postgres-password";
    const environment = composeEnvironment(passwordPath, { baseEnv: { P9_JWT_SECRET: "synthetic" } });

    expect(environment.P9_POSTGRES_PASSWORD_FILE).toBe(passwordPath);
    expect(environment.P9_JWT_SECRET).toBe("synthetic");
    expect(Object.values(environment)).not.toContain("synthetic-postgres-password-value");
  });

  it("passes the path to the non-lifecycle Compose configuration invocation", async () => {
    const spawnProcess = vi.fn(() => fakeChild(0));
    const passwordPath = "/tmp/synthetic-postgres-password";

    await validateComposeConfiguration(passwordPath, {
      spawn: spawnProcess,
      baseEnv: { P9_JWT_SECRET: "synthetic" },
    });

    expect(spawnProcess).toHaveBeenCalledWith(
      "docker",
      expect.arrayContaining(["config", "--quiet"]),
      expect.objectContaining({
        env: expect.objectContaining({ P9_POSTGRES_PASSWORD_FILE: passwordPath }),
        stdio: ["ignore", "pipe", "pipe"],
      }),
    );
  });

  it("categorizes Compose interpolation failure without calling it pg_dump failure", async () => {
    const child = fakeChild(
      1,
      "error while interpolating secrets.postgres_password.file: required variable P9_POSTGRES_PASSWORD_FILE is missing a value",
    );

    await expect(validateComposeConfiguration("/tmp/synthetic-postgres-password", {
      spawn: vi.fn(() => child),
    })).rejects.toThrow(
      "Docker Compose configuration failed: required P9_POSTGRES_PASSWORD_FILE is missing",
    );
  });

  it("keeps a real pg_dump failure distinct when the marker proves pg_dump started", async () => {
    const child = fakeChild(1, "", "pg_dump: error: permission denied\nP9_PG_DUMP_EXIT=1\n");

    await expect(waitForProcess(child, "pg_dump", { failureKind: "pg_dump" })).rejects.toThrow("pg_dump failed");
    await expect(waitForProcess(fakeChild(1, "", "pg_dump: error: permission denied\n"), "pg_dump", { failureKind: "pg_dump" })).rejects.toThrow("Docker Compose execution failed");
  });

  it("distinguishes a missing pg_dump executable", async () => {
    await expect(waitForProcess(
      fakeChild(127, "", "P9_PG_DUMP_EXECUTABLE_MISSING\n"),
      "pg_dump",
      { failureKind: "pg_dump" },
    )).rejects.toThrow("pg_dump executable is missing");
  });

  it("redacts passwords, credential URLs, and secret-bearing variable values", () => {
    const sanitized = sanitizeChildOutput(
      "password=super-secret postgres://bmo:super-secret@postgres.example.invalid/bmo P9_JWT_SECRET=jwt-secret",
    );

    expect(sanitized).not.toContain("super-secret");
    expect(sanitized).not.toContain("jwt-secret");
    expect(sanitized).not.toContain("postgres://bmo:");
    expect(sanitized).toContain("[REDACTED_CONNECTION_URL]");
  });

  it("does not require stdout capture for streamed dump data", async () => {
    const child = fakeChild(0, "synthetic dump bytes");
    await expect(waitForProcess(child, "pg_dump", { failureKind: "pg_dump" })).resolves.toBeUndefined();
  });
});
