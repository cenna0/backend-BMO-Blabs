import { validateRestoreDatabaseName } from "./restore-config.js";

export interface AcceptanceHttpResult {
  status: number;
  body?: unknown;
}

export interface AcceptanceHttpClient {
  request(path: string, init?: RequestInit): Promise<AcceptanceHttpResult>;
}

export interface AcceptanceFixtureIdentity {
  email: string;
  userId: string;
}

export interface AcceptanceRunnerOptions {
  targetDatabase: string;
  fixture: AcceptanceFixtureIdentity;
  readPassword: () => Promise<string>;
  http: AcceptanceHttpClient;
}

export interface AcceptanceEvidence {
  targetDatabase: string;
  readiness: {
    livezStatus: number;
    readyzStatus: number;
    identityStatus: number;
  };
  login: {
    status: number;
    outcome: "success";
    tokenIssued: true;
    schema: "valid";
  };
  me: {
    status: number;
    identityMatch: true;
    schema: "sanitized";
  };
  protected: {
    unauthenticatedStatus: number;
    authenticatedStatus: number;
  };
}

export class AcceptanceRunnerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AcceptanceRunnerError";
  }
}

function assertRestoreTarget(database: string): void {
  try {
    validateRestoreDatabaseName(database, "bmo");
  } catch {
    throw new AcceptanceRunnerError("acceptance runner requires a safe restore target");
  }
}

function objectBody(body: unknown, label: string): Record<string, any> {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new AcceptanceRunnerError(`${label} response schema failed`);
  return body as Record<string, any>;
}

function containsSensitiveKey(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(containsSensitiveKey);
  return Object.entries(value).some(([key, child]) => /(password|hash|token|secret|authorization|cookie|credential|code)/i.test(key) || containsSensitiveKey(child));
}

async function request(http: AcceptanceHttpClient, path: string, init?: RequestInit): Promise<AcceptanceHttpResult> {
  try {
    return await http.request(path, init);
  } catch {
    throw new AcceptanceRunnerError(`${path} request failed`);
  }
}

function requireStatus(result: AcceptanceHttpResult, expected: number, label: string): void {
  if (result.status !== expected) throw new AcceptanceRunnerError(`${label} returned unexpected status`);
}

export async function runAcceptance(options: AcceptanceRunnerOptions): Promise<AcceptanceEvidence> {
  assertRestoreTarget(options.targetDatabase);
  const livez = await request(options.http, "/ops/db/livez");
  requireStatus(livez, 200, "database liveness");
  const readyz = await request(options.http, "/ops/db/readyz");
  requireStatus(readyz, 200, "database readiness");
  const identity = await request(options.http, "/ops/db/identity");
  requireStatus(identity, 200, "database identity");
  if (objectBody(identity.body, "database identity").database !== options.targetDatabase) {
    throw new AcceptanceRunnerError("application database identity does not match restore target");
  }

  const unauthenticatedMe = await request(options.http, "/me");
  requireStatus(unauthenticatedMe, 401, "unauthenticated /me");

  const password = await options.readPassword();
  const login = await request(options.http, "/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: options.fixture.email, password }),
  });
  requireStatus(login, 200, "login");
  const loginBody = objectBody(login.body, "login");
  const loginUser = objectBody(loginBody.user, "login user");
  const session = objectBody(loginBody.session, "login session");
  if (loginUser.id !== options.fixture.userId || typeof session.accessToken !== "string" || typeof session.refreshToken !== "string") {
    throw new AcceptanceRunnerError("login response schema failed");
  }
  const accessToken = session.accessToken as string;

  const me = await request(options.http, "/me", { headers: { authorization: `Bearer ${accessToken}` } });
  requireStatus(me, 200, "authenticated /me");
  const meBody = objectBody(me.body, "/me");
  const meUser = objectBody(meBody.user, "/me user");
  if (meUser.id !== options.fixture.userId || containsSensitiveKey(me.body)) {
    throw new AcceptanceRunnerError("/me response identity or sanitization failed");
  }

  const unauthenticatedProtected = await request(options.http, "/devices");
  requireStatus(unauthenticatedProtected, 401, "unauthenticated protected operation");
  const authenticatedProtected = await request(options.http, "/devices", { headers: { authorization: `Bearer ${accessToken}` } });
  requireStatus(authenticatedProtected, 200, "authenticated protected operation");
  objectBody(authenticatedProtected.body, "authenticated protected operation");

  return {
    targetDatabase: options.targetDatabase,
    readiness: { livezStatus: livez.status, readyzStatus: readyz.status, identityStatus: identity.status },
    login: { status: login.status, outcome: "success", tokenIssued: true, schema: "valid" },
    me: { status: me.status, identityMatch: true, schema: "sanitized" },
    protected: { unauthenticatedStatus: unauthenticatedProtected.status, authenticatedStatus: authenticatedProtected.status },
  };
}

export function createFetchAcceptanceHttpClient(baseUrl: string): AcceptanceHttpClient {
  const normalized = baseUrl.replace(/\/$/, "");
  return {
    async request(path, init = {}) {
      const response = await fetch(`${normalized}${path}`, init);
      const text = await response.text();
      let body: unknown;
      try {
        body = text ? JSON.parse(text) : undefined;
      } catch {
        body = undefined;
      }
      return { status: response.status, body };
    },
  };
}
