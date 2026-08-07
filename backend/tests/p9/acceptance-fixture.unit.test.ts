import { mkdtempSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  cleanupAcceptanceFixture,
  createPendingAcceptanceFixtureState,
  createAcceptanceFixture,
  displayNameForRun,
  fileFixtureStateStore,
  validateFixtureState,
  type AcceptanceFixtureDatabase,
  type FixtureState,
  type FixtureStateStore,
} from "../../src/p9/operator/acceptance-fixture.js";

function store(initial?: FixtureState): FixtureStateStore & { current: FixtureState | undefined } {
  const value = { current: initial } as FixtureStateStore & { current: FixtureState | undefined };
  value.write = async (state) => { value.current = state; };
  value.read = async () => {
    if (!value.current) throw new Error("fixture state is missing");
    return value.current;
  };
  value.remove = async () => { value.current = undefined; };
  return value;
}

function database(existing?: Record<string, unknown>): AcceptanceFixtureDatabase & { calls: string[] } {
  const calls: string[] = [];
  const db: AcceptanceFixtureDatabase & { calls: string[] } = {
    calls,
    $transaction: async (work: (database: AcceptanceFixtureDatabase) => Promise<unknown>) => work(db),
    user: {
      findUnique: async () => { calls.push("user.findUnique"); return existing ?? null; },
      create: async () => { calls.push("user.create"); return { id: "11111111-1111-1111-1111-111111111111" }; },
      delete: async () => { calls.push("user.delete"); },
    },
    auditEvent: { deleteMany: async () => { calls.push("auditEvent.deleteMany"); } },
  } as never;
  return db;
}

function state(): FixtureState {
  return {
    version: 1,
    database: "bmo_restore_acceptance_test",
    runId: "run-1234",
    userId: "11111111-1111-1111-1111-111111111111",
    email: "p9-acceptance-run-1234@example.invalid",
    providerSubject: "p9-acceptance:run-1234",
    displayName: displayNameForRun("run-1234"),
  };
}

describe("P9 restored-target acceptance fixture", () => {
  it("creates only a synthetic restore-target user with the real password shape", async () => {
    const db = database();
    const stateStore = store();
    const hashPassword = vi.fn(async (password: string) => {
      expect(password).toBe("synthetic-password");
      return "$argon2id$v=19$m=19456,t=3,p=1$synthetic";
    });

    const result = await createAcceptanceFixture({
      database: "bmo_restore_acceptance_test",
      runId: "run-1234",
      db,
      stateStore,
      readPassword: async () => "synthetic-password",
      hashPassword,
    });

    expect(result.userId).toBe("11111111-1111-1111-1111-111111111111");
    expect(stateStore.current).toMatchObject({ database: "bmo_restore_acceptance_test", runId: "run-1234", userId: "11111111-1111-1111-1111-111111111111" });
    expect(hashPassword).toHaveBeenCalledTimes(1);
    expect(db.calls).toEqual(["user.findUnique", "user.create"]);
    expect(JSON.stringify(result)).not.toContain("synthetic-password");
  });

  it("rejects the primary database before reading the password or mutating", async () => {
    const db = database();
    const stateStore = store();
    const readPassword = vi.fn(async () => "synthetic-password");

    await expect(createAcceptanceFixture({
      database: "bmo",
      runId: "run-1234",
      db,
      stateStore,
      readPassword,
      hashPassword: async () => "hash",
    })).rejects.toThrow();
    expect(readPassword).not.toHaveBeenCalled();
    expect(db.calls).toEqual([]);
    expect(stateStore.current).toBeUndefined();
  });

  it("fails safely on a synthetic identity collision without changing the existing user", async () => {
    const db = database({ id: "11111111-1111-1111-1111-111111111111", email: "existing@example.invalid" });
    const readPassword = vi.fn(async () => "synthetic-password");

    await expect(createAcceptanceFixture({
      database: "bmo_restore_acceptance_test",
      runId: "run-1234",
      db,
      stateStore: store(),
      readPassword,
      hashPassword: async () => "hash",
    })).rejects.toThrow(/collision/);
    expect(readPassword).not.toHaveBeenCalled();
    expect(db.calls).toEqual(["user.findUnique"]);
  });

  it("cleans only a fully verified fixture identity and owned audit events", async () => {
    const fixture = state();
    const db = database({
      id: fixture.userId,
      email: fixture.email,
      displayName: fixture.displayName,
      passwordCredential: { algorithm: "argon2id" },
      identities: [{ provider: "password", providerSubject: fixture.providerSubject }],
      userSettings: { timezone: "Asia/Jakarta" },
      devices: [],
      pairings: [],
      invitations: [],
    });
    const result = await cleanupAcceptanceFixture({ database: fixture.database, db, state: fixture });

    expect(result).toEqual({ deleted: true, userId: fixture.userId });
    expect(db.calls).toEqual(["user.findUnique", "auditEvent.deleteMany", "user.delete"]);
  });

  it("fails closed when the state identity has unexpected owned relations", async () => {
    const fixture = state();
    const db = database({
      id: fixture.userId,
      email: fixture.email,
      displayName: fixture.displayName,
      passwordCredential: { algorithm: "argon2id" },
      identities: [{ provider: "password", providerSubject: fixture.providerSubject }],
      userSettings: { timezone: "Asia/Jakarta" },
      devices: [{ id: "unexpected-device" }],
      pairings: [],
      invitations: [],
    });

    await expect(cleanupAcceptanceFixture({ database: fixture.database, db, state: fixture })).rejects.toThrow(/unexpected/);
    expect(db.calls).toEqual(["user.findUnique"]);
  });

  it("removes a pending state without touching rows when the transactional create fails", async () => {
    const db = database();
    db.$transaction = async () => { throw new Error("synthetic write failure"); };
    const stateStore = store();

    await expect(createAcceptanceFixture({
      database: "bmo_restore_acceptance_test",
      runId: "run-1234",
      db,
      stateStore,
      readPassword: async () => "synthetic-password",
      hashPassword: async () => "hash",
    })).rejects.toThrow(/creation failed/);
    expect(stateStore.current).toBeUndefined();
    expect(db.calls).toEqual(["user.findUnique"]);
  });

  it("recovers a partially-created fixture from the exact pending synthetic identity", async () => {
    const fixture = state();
    const pending = { ...fixture, userId: null };
    const db = database({
      id: fixture.userId,
      email: fixture.email,
      displayName: fixture.displayName,
      passwordCredential: { algorithm: "argon2id" },
      identities: [{ provider: "password", providerSubject: fixture.providerSubject }],
      userSettings: { timezone: "Asia/Jakarta" },
      devices: [],
      pairings: [],
      invitations: [],
    });

    await expect(cleanupAcceptanceFixture({ database: fixture.database, db, state: pending })).resolves.toEqual({
      deleted: true,
      userId: fixture.userId,
    });
    expect(db.calls).toEqual(["user.findUnique", "auditEvent.deleteMany", "user.delete"]);
  });

  it("accepts exact absence for a pending state without deleting unrelated rows", async () => {
    const fixture = state();
    const db = database();

    await expect(cleanupAcceptanceFixture({ database: fixture.database, db, state: { ...fixture, userId: null } })).resolves.toEqual({
      deleted: true,
      userId: null,
    });
    expect(db.calls).toEqual(["user.findUnique"]);
  });

  it("writes the host/runtime manifest atomically with protected mode and no temporary residue", async () => {
    const directory = mkdtempSync(join(tmpdir(), "p9-state-store-test-"));
    const path = join(directory, "fixture-state.json");
    const state = createPendingAcceptanceFixtureState("bmo_restore_acceptance_test", "run-1234");
    const stateStore = fileFixtureStateStore(path);

    await stateStore.write(state);

    expect(statSync(path).mode & 0o7777).toBe(0o600);
    expect(await stateStore.read()).toEqual(state);
    expect(readdirSync(directory)).toEqual(["fixture-state.json"]);
  });

  it("rejects malformed state before any cleanup operation", () => {
    expect(() => validateFixtureState({ ...state(), runId: "bad state" })).toThrow(/invalid/);
  });
});
