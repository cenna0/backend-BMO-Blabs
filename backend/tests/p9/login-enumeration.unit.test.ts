import { beforeEach, describe, expect, it, vi } from "vitest";

const verifyPassword = vi.hoisted(() => vi.fn());

vi.mock("../../src/p9/crypto.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/p9/crypto.js")>();
  return { ...actual, verifyPassword };
});

import { sha256Hex } from "../../src/p9/crypto.js";
import { AuthService } from "../../src/p9/services/auth.service.js";

const email = "person@example.com";
const userId = "00000000-0000-4000-8000-000000000010";
const knownUser = {
  id: userId,
  email,
  displayName: null,
  username: null,
  avatarKey: null,
  createdAt: new Date("2026-08-11T00:00:00.000Z"),
  passwordCredential: { passwordHash: "known-password-hash" },
};

function fixture(input: {
  discovered: { id: string } | null;
  authoritative: Array<typeof knownUser | null>;
  passwordValid?: boolean;
}) {
  const events: string[] = [];
  const failureAudit = vi.fn(async (value) => {
    events.push("audit");
    return value;
  });
  const successAudit = vi.fn(async (value) => {
    events.push("success-audit");
    return value;
  });
  const outsideFindUnique = vi.fn(async () => {
    events.push("discover");
    return input.discovered;
  });
  let authoritativeIndex = 0;
  const transactionFindUnique = vi.fn(async () => {
    events.push(authoritativeIndex === 0 ? "authoritative" : "refetch");
    return input.authoritative[authoritativeIndex++] ?? null;
  });
  const executeRaw = vi.fn(async (...args: unknown[]) => {
    events.push(`lock:${String(args[1])}`);
    return 1;
  });
  const transaction = {
    $executeRaw: executeRaw,
    user: { findUnique: transactionFindUnique },
    auditEvent: { create: successAudit },
  };
  const client = {
    $transaction: vi.fn(async (work: (database: typeof transaction) => Promise<unknown>) => {
      events.push("transaction");
      return work(transaction);
    }),
  };
  const sessions = {
    issueSession: vi.fn(async () => {
      events.push("issue");
      return { sessionId: "session-1" };
    }),
  };
  verifyPassword.mockImplementationOnce(async () => {
    events.push("argon");
    return input.passwordValid ?? false;
  });
  return {
    auth: new AuthService({
      client: client as any,
      repositories: {
        user: { findUnique: outsideFindUnique },
        auditEvent: { create: failureAudit },
      } as any,
      invitations: {} as any,
      sessions: sessions as any,
      publicBaseUrl: "https://api.example.com",
    }),
    client,
    events,
    executeRaw,
    failureAudit,
    outsideFindUnique,
    sessions,
    successAudit,
    transactionFindUnique,
  };
}

describe("serialized login enumeration resistance", () => {
  beforeEach(() => verifyPassword.mockReset());

  it("uses the same transaction/query/lock/Argon/audit work shape for unknown and known-invalid accounts", async () => {
    const known = fixture({ discovered: { id: userId }, authoritative: [knownUser] });
    const unknown = fixture({ discovered: null, authoritative: [null] });

    const knownError = await known.auth.login({ email, password: "wrong-password" }, "request-1")
      .catch((error: unknown) => error);
    const unknownError = await unknown.auth.login({ email, password: "wrong-password" }, "request-1")
      .catch((error: unknown) => error);

    expect(knownError).toMatchObject({
      code: "AUTHENTICATION_FAILED", status: 401, publicMessage: "Authentication failed",
    });
    expect(unknownError).toMatchObject({
      code: "AUTHENTICATION_FAILED", status: 401, publicMessage: "Authentication failed",
    });
    expect(known.events).toEqual(["discover", "transaction", `lock:${userId}`, "authoritative", "argon", "audit"]);
    expect(unknown.events).toEqual([
      "discover",
      "transaction",
      `lock:login-miss:${sha256Hex(email)}`,
      "authoritative",
      "argon",
      "audit",
    ]);
    expect(known.client.$transaction).toHaveBeenCalledTimes(1);
    expect(unknown.client.$transaction).toHaveBeenCalledTimes(1);
    expect(known.outsideFindUnique).toHaveBeenCalledWith({ where: { email }, select: { id: true } });
    expect(unknown.outsideFindUnique).toHaveBeenCalledWith({ where: { email }, select: { id: true } });
    expect(known.transactionFindUnique).toHaveBeenCalledWith({
      where: { email }, include: { passwordCredential: true },
    });
    expect(unknown.transactionFindUnique).toHaveBeenCalledWith({
      where: { email }, include: { passwordCredential: true },
    });
    expect(verifyPassword).toHaveBeenCalledTimes(2);
    expect(known.failureAudit.mock.calls[0]?.[0]).toEqual(unknown.failureAudit.mock.calls[0]?.[0]);
    expect(known.sessions.issueSession).not.toHaveBeenCalled();
    expect(unknown.sessions.issueSession).not.toHaveBeenCalled();
  });

  it("locks and refetches a real user that registers between discovery and the authoritative lookup", async () => {
    const appearedUser = {
      ...knownUser,
      passwordCredential: { passwordHash: "stale-password-hash" },
    };
    const currentUser = {
      ...knownUser,
      passwordCredential: { passwordHash: "current-password-hash" },
    };
    const f = fixture({
      discovered: null,
      authoritative: [appearedUser, currentUser],
      passwordValid: true,
    });

    await expect(f.auth.login({ email, password: "current-password" }, "request-2")).resolves.toMatchObject({
      user: { id: userId, email },
      session: { sessionId: "session-1" },
    });

    expect(f.events).toEqual([
      "discover",
      "transaction",
      `lock:login-miss:${sha256Hex(email)}`,
      "authoritative",
      `lock:${userId}`,
      "refetch",
      "argon",
      "issue",
      "success-audit",
    ]);
    expect(f.transactionFindUnique.mock.calls).toEqual([
      [{ where: { email }, include: { passwordCredential: true } }],
      [{ where: { id: userId }, include: { passwordCredential: true } }],
    ]);
    expect(verifyPassword).toHaveBeenCalledOnce();
    expect(verifyPassword).toHaveBeenCalledWith("current-password-hash", "current-password");
    expect(f.sessions.issueSession).toHaveBeenCalledWith(
      { userId, requestId: "request-2" },
      expect.anything(),
    );
    expect(f.failureAudit).not.toHaveBeenCalled();
    expect(f.successAudit).toHaveBeenCalledOnce();
  });
});
