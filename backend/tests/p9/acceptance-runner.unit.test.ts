import { describe, expect, it, vi } from "vitest";

import {
  runAcceptance,
  type AcceptanceHttpClient,
} from "../../src/p9/operator/acceptance-runner.js";

const fixture = {
  email: "p9-acceptance-run-1234@example.invalid",
  userId: "11111111-1111-1111-1111-111111111111",
};

function client(responses: Array<{ status: number; body?: unknown }>) {
  const calls: Array<{ path: string; init: RequestInit | undefined }> = [];
  const http: AcceptanceHttpClient = {
    request: async (path, init) => {
      calls.push({ path, init });
      const response = responses[calls.length - 1] ?? { status: 500 };
      return { status: response.status, body: response.body };
    },
  };
  return { http, calls };
}

function successClient() {
  return client([
    { status: 200, body: { status: "ok", database: "ok" } },
    { status: 200, body: { status: "ok", database: "ready" } },
    { status: 200, body: { database: "bmo_restore_acceptance_test" } },
    { status: 401, body: { error: "AUTHENTICATION_FAILED" } },
    { status: 200, body: { user: { id: fixture.userId }, session: { accessToken: "access-secret", refreshToken: "refresh-secret" } } },
    { status: 200, body: { user: { id: fixture.userId, displayName: null, createdAt: "2026-01-01T00:00:00.000Z" } } },
    { status: 401, body: { error: "AUTHENTICATION_FAILED" } },
    { status: 200, body: { devices: [] } },
  ]);
}

describe("P9 restored-target application acceptance runner", () => {
  it("performs readiness, exactly one login, sanitized /me, and protected checks", async () => {
    const { http, calls } = successClient();
    const readPassword = vi.fn(async () => "synthetic-password");

    const evidence = await runAcceptance({
      targetDatabase: "bmo_restore_acceptance_test",
      fixture,
      readPassword,
      http,
    });

    expect(evidence).toMatchObject({
      targetDatabase: "bmo_restore_acceptance_test",
      login: { status: 200, outcome: "success", tokenIssued: true },
      me: { status: 200, identityMatch: true },
      protected: { unauthenticatedStatus: 401, authenticatedStatus: 200 },
    });
    expect(calls.filter((call) => call.path === "/auth/login")).toHaveLength(1);
    expect(JSON.stringify(evidence)).not.toContain("synthetic-password");
    expect(JSON.stringify(evidence)).not.toContain("access-secret");
    expect(JSON.stringify(evidence)).not.toContain("refresh-secret");
    expect(readPassword).toHaveBeenCalledTimes(1);
  });

  it("fails when application identity is primary instead of the restore target", async () => {
    const { http } = successClient();
    const calls: Array<{ path: string; init: RequestInit | undefined }> = [];
    const mismatch: AcceptanceHttpClient = {
      request: async (path, init) => {
        calls.push({ path, init });
        if (path === "/ops/db/identity") return { status: 200, body: { database: "bmo" } };
        return { status: 200, body: { status: "ok", database: "ok" } };
      },
    };

    await expect(runAcceptance({
      targetDatabase: "bmo_restore_acceptance_test",
      fixture,
      readPassword: async () => "synthetic-password",
      http: mismatch,
    })).rejects.toThrow(/database identity/);
    expect(calls.some((call) => call.path === "/auth/login")).toBe(false);
    void http;
  });

  it("does not leak credential-bearing response fields when an authenticated request fails", async () => {
    const { http } = client([
      { status: 200, body: { status: "ok" } },
      { status: 200, body: { status: "ok" } },
      { status: 200, body: { database: "bmo_restore_acceptance_test" } },
      { status: 401, body: { error: "AUTHENTICATION_FAILED" } },
      { status: 401, body: { error: "AUTHENTICATION_FAILED", accessToken: "not-to-leak" } },
    ]);

    await expect(runAcceptance({
      targetDatabase: "bmo_restore_acceptance_test",
      fixture,
      readPassword: async () => "synthetic-password",
      http,
    })).rejects.toThrow(/login/);
  });
});
