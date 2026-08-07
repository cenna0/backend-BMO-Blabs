import { randomUUID } from "node:crypto";
import { chmodSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";

import { hashPassword as realHashPassword } from "../crypto.js";
import { validateRestoreDatabaseName } from "./restore-config.js";

export interface FixtureState {
  version: 1;
  database: string;
  runId: string;
  userId: string | null;
  email: string;
  providerSubject: string;
  displayName: string;
}

export interface FixtureStateStore {
  write(state: FixtureState): Promise<void>;
  read(): Promise<FixtureState>;
  remove(): Promise<void>;
}

export interface AcceptanceFixtureDatabase {
  $transaction<T>(work: (database: AcceptanceFixtureDatabase) => Promise<T>): Promise<T>;
  user: {
    findUnique(args: unknown): Promise<any>;
    create(args: unknown): Promise<{ id: string }>;
    delete(args: unknown): Promise<unknown>;
  };
  auditEvent: {
    deleteMany(args: unknown): Promise<unknown>;
  };
}

export interface CreateAcceptanceFixtureOptions {
  database: string;
  runId?: string;
  db: AcceptanceFixtureDatabase;
  stateStore: FixtureStateStore;
  readPassword: () => Promise<string>;
  hashPassword?: (password: string) => Promise<string>;
}

export interface CleanupAcceptanceFixtureOptions {
  database: string;
  db: AcceptanceFixtureDatabase;
  state: FixtureState;
}

export interface CleanupAcceptanceFixtureResult {
  deleted: true;
  userId: string;
}

export interface AcceptanceFixtureStatus {
  present: boolean;
  database: string;
}

export class AcceptanceFixtureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AcceptanceFixtureError";
  }
}

export function displayNameForRun(runId: string): string {
  return `P9 restore acceptance fixture ${runId}`;
}

function assertRestoreTarget(database: string): void {
  try {
    validateRestoreDatabaseName(database, "bmo");
  } catch {
    throw new AcceptanceFixtureError("acceptance fixture requires a safe restore target");
  }
}

function runIdValue(value: string | undefined): string {
  const runId = value ?? randomUUID();
  if (!/^[A-Za-z0-9-]{8,80}$/.test(runId)) throw new AcceptanceFixtureError("acceptance fixture run identity is invalid");
  return runId;
}

function validateState(state: FixtureState): void {
  if (state.version !== 1 || !state.database || !state.runId || !state.email || !state.providerSubject || !state.displayName) {
    throw new AcceptanceFixtureError("acceptance fixture state is invalid");
  }
  if (state.userId !== null && !/^[0-9a-f-]{20,80}$/i.test(state.userId)) {
    throw new AcceptanceFixtureError("acceptance fixture state identity is invalid");
  }
}

export async function createAcceptanceFixture(options: CreateAcceptanceFixtureOptions): Promise<FixtureState & { userId: string }> {
  assertRestoreTarget(options.database);
  const runId = runIdValue(options.runId);
  const email = `p9-acceptance-${runId}@example.invalid`;
  const providerSubject = `p9-acceptance:${runId}`;
  const displayName = displayNameForRun(runId);
  const pending: FixtureState = { version: 1, database: options.database, runId, userId: null, email, providerSubject, displayName };
  await options.stateStore.write(pending);

  let created: (FixtureState & { userId: string }) | undefined;
  try {
    const existing = await options.db.user.findUnique({ where: { email } });
    if (existing) throw new AcceptanceFixtureError("acceptance fixture identity collision");
    const password = await options.readPassword();
    if (typeof password !== "string" || password.length < 12) throw new AcceptanceFixtureError("acceptance password is invalid");
    const passwordHash = await (options.hashPassword ?? realHashPassword)(password);
    const user = await options.db.$transaction(async (database) => database.user.create({
      data: {
        email,
        displayName,
        passwordCredential: { create: { passwordHash, algorithm: "argon2id" } },
        identities: { create: { provider: "password", providerSubject } },
        userSettings: { create: { timezone: "Asia/Jakarta" } },
      },
    }));
    created = { ...pending, userId: user.id };
    await options.stateStore.write(created);
    return created;
  } catch (error) {
    if (created) {
      await cleanupAcceptanceFixture({ database: options.database, db: options.db, state: created }).catch(() => undefined);
    }
    await options.stateStore.remove().catch(() => undefined);
    if (error instanceof AcceptanceFixtureError) throw error;
    throw new AcceptanceFixtureError("acceptance fixture creation failed");
  }
}

export async function cleanupAcceptanceFixture(
  options: CleanupAcceptanceFixtureOptions,
): Promise<CleanupAcceptanceFixtureResult> {
  assertRestoreTarget(options.database);
  validateState(options.state);
  if (options.state.database !== options.database || options.state.userId === null) {
    throw new AcceptanceFixtureError("acceptance fixture state target mismatch");
  }
  const userId = options.state.userId;
  await options.db.$transaction(async (database) => {
    const user = await database.user.findUnique({
      where: { id: userId },
      include: { passwordCredential: true, identities: true, userSettings: true, devices: true, pairings: true, invitations: true },
    });
    if (!user) throw new AcceptanceFixtureError("acceptance fixture user is missing");
    const identity = user.identities?.length === 1 ? user.identities[0] : undefined;
    if (
      user.email !== options.state.email ||
      user.displayName !== options.state.displayName ||
      user.passwordCredential?.algorithm !== "argon2id" ||
      !identity ||
      identity.provider !== "password" ||
      identity.providerSubject !== options.state.providerSubject ||
      !user.userSettings ||
      (user.devices?.length ?? 0) !== 0 ||
      (user.pairings?.length ?? 0) !== 0 ||
      (user.invitations?.length ?? 0) !== 0
    ) {
      throw new AcceptanceFixtureError("acceptance fixture ownership is unexpected");
    }
    await database.auditEvent.deleteMany({ where: { userId } });
    await database.user.delete({ where: { id: userId } });
  });
  return { deleted: true, userId };
}

export async function statusAcceptanceFixture(
  database: string,
  db: AcceptanceFixtureDatabase,
  state: FixtureState,
): Promise<AcceptanceFixtureStatus> {
  assertRestoreTarget(database);
  validateState(state);
  if (state.database !== database || state.userId === null) throw new AcceptanceFixtureError("acceptance fixture state target mismatch");
  const user = await db.user.findUnique({ where: { id: state.userId }, include: { identities: true } });
  const identity = user?.identities?.length === 1 ? user.identities[0] : undefined;
  const present = Boolean(
    user &&
    user.email === state.email &&
    user.displayName === state.displayName &&
    identity?.provider === "password" &&
    identity.providerSubject === state.providerSubject,
  );
  return { present, database };
}

export function fileFixtureStateStore(path: string): FixtureStateStore {
  return {
    async write(state) {
      validateState(state);
      try {
        writeFileSync(path, `${JSON.stringify(state)}\n`, { mode: 0o600 });
        chmodSync(path, 0o600);
      } catch {
        throw new AcceptanceFixtureError("acceptance fixture state is not writable");
      }
    },
    async read() {
      try {
        const state = JSON.parse(readFileSync(path, "utf8")) as FixtureState;
        validateState(state);
        return state;
      } catch (error) {
        if (error instanceof AcceptanceFixtureError) throw error;
        throw new AcceptanceFixtureError("acceptance fixture state is unreadable");
      }
    },
    async remove() {
      try {
        unlinkSync(path);
      } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
          throw new AcceptanceFixtureError("acceptance fixture state cleanup failed");
        }
      }
    },
  };
}

export function readAcceptancePasswordFile(path: string): string {
  try {
    const password = readFileSync(path, "utf8").replace(/\r?\n$/, "");
    if (password.length < 12) throw new Error("invalid");
    return password;
  } catch {
    throw new AcceptanceFixtureError("acceptance password file is unreadable");
  }
}
