# BMO Backend — Remove Login Rate Limit Only

**Date:** 2026-08-23  
**Task type:** Backend production change  
**Scope:** Extremely narrow — remove rate limiting from `POST /api/v1/auth/login` only  
**Recommended VPS path:** `/opt/bmo/app/docs/operations/2026-08-23-REMOVE-LOGIN-RATE-LIMIT.md`

## 1. Objective

Change the BMO Backend so repeated login attempts are **not blocked by the Backend login rate limiter**.

Current user-visible behavior:

```text
5 login attempts within the configured 15-minute window
→ subsequent login request can return HTTP 429
→ { "error": "RATE_LIMITED" }
```

Required behavior:

```text
Repeated login attempts
→ must continue reaching the normal login/authentication logic
→ invalid credentials continue returning the canonical auth failure (currently HTTP 401)
→ valid credentials continue returning the normal successful login response
→ POST /api/v1/auth/login must not return HTTP 429 because of the local login frequency limiter
```

This task removes **only the local rate limiter attached to the login route**.

---

## 2. Source State Already Audited

In the audited repository snapshot, the relevant file is:

```text
backend/src/p9/http/auth.route.ts
```

The current router defines an `authLimiter` using:

```text
windowMs: options.config.loginWindowMs
limit: options.config.loginLimit
```

The current defaults are:

```text
loginWindowMs = 900000  // 15 minutes
loginLimit = 5
```

The important detail is that the same `authLimiter` is currently attached to **both**:

```text
POST /auth/register
POST /auth/login
```

Therefore, **do not delete the limiter globally and do not remove it from registration**.

The audited login route currently has this shape:

```ts
router.post("/auth/login", authLimiter, asyncP9(async (request, response) => {
  const context = requestContext(request, response);
  const result = await options.auth.login(request.body, context.requestId);
  response.status(200).json({ user: result.user, session: sessionResponse(result.session) });
}));
```

The required functional change is equivalent to:

```ts
router.post("/auth/login", asyncP9(async (request, response) => {
  const context = requestContext(request, response);
  const result = await options.auth.login(request.body, context.requestId);
  response.status(200).json({ user: result.user, session: sessionResponse(result.session) });
}));
```

Prefer the smallest safe diff. Renaming `authLimiter` is optional and is not required for this task.

If the live VPS source has moved or changed since this snapshot, locate the equivalent login route and implement the same narrow intent. Do not broaden scope.

---

## 3. Explicit Non-Goals / Do Not Change

Do **not** remove or modify any other limiter or protection.

Keep unchanged:

- registration rate limiting;
- refresh-token rate limiting;
- password-recovery IP rate limiting;
- password-recovery email rate limiting;
- pairing claim rate limiting;
- hardware pairing-code issuance cooldown/rate limiting;
- avatar upload rate limiting;
- avatar concurrency/admission protection;
- device-log ingestion rate limiting;
- Spotify/provider HTTP `429` handling;
- payload/body/file-size limits;
- WebSocket message-size limits;
- authentication and authorization logic;
- Argon2 password verification;
- login enumeration resistance/timing behavior;
- session issuance and refresh-token behavior;
- JWT behavior;
- database schema or migrations;
- Caddy/firewall configuration;
- Hermes, Audio Service, WhatsApp bridge/resolver, PostgreSQL, Spotify secrets/configuration, or ESP behavior.

Do not uninstall `express-rate-limit`. Other Backend routes still depend on it.

Do not remove `loginWindowMs` or `loginLimit` from configuration merely because login no longer uses the limiter. In the audited source, registration still uses the same limiter/config values.

---

## 4. Required Test Changes

### 4.1 Focused rate-limit test

The audited file:

```text
backend/tests/p9/auth-rate-limit.integration.test.ts
```

currently expects repeated `/api/v1/auth/login` requests to eventually return `429` and expects the login handler not to be called after the limit is reached.

Update this test so it proves the new contract instead.

Minimum required regression proof:

1. Configure the test app with a very low limiter value, for example `loginLimit: 2`.
2. Send at least 5–10 login requests for the same normalized email and same effective client IP.
3. Every request must reach the mocked login handler.
4. No request may return `429` because of the login limiter.
5. Assert the mocked login handler call count equals the number of requests.

Also retain/add proof that registration is still rate-limited. For example, with `loginLimit: 2`, repeated `/api/v1/auth/register` requests through the same bucket should still produce the expected `429` after the configured limit.

The purpose is to prove that the change is **login-only**, not an accidental removal of the shared auth limiter.

### 4.2 Full HTTP integration behavior

The audited file:

```text
backend/tests/p9/http.integration.test.ts
```

currently performs six invalid logins and expects:

```text
401, 401, 401, 401, 401, 429
```

Change that expectation.

Required behavior:

```text
Repeated wrong-password login attempts
→ all continue returning the canonical invalid-login response
→ currently HTTP 401
→ no local 429
```

Use at least 10 repeated attempts if practical so the regression is obvious.

### 4.3 Preserve unrelated tests

Do not modify unrelated `429` tests for:

- pairing;
- avatar;
- hardware enrollment;
- Spotify provider rate limiting;
- recovery;
- any other endpoint.

Do not weaken login security tests unrelated to frequency throttling, including login enumeration resistance and session-race tests.

---

## 5. Documentation Consistency

Current historical evidence documents that recorded the old implementation must remain historical; do not rewrite old evidence as though it never happened.

However, the current decision register contains:

```text
docs/integration/06-DECISION-REGISTER.md
```

with `INT-071`, which states that login and pairing rate-limit state is process-local.

Do not silently edit the historical meaning of `INT-071`.

Add a new decision entry using the next available INT number that explicitly supersedes the **login portion** of `INT-071` and records:

```text
- POST /api/v1/auth/login no longer has a Backend frequency rate limiter.
- Registration and all other existing rate limits remain unchanged.
- Pairing rate-limit behavior from INT-071 remains unchanged/process-local.
- No database migration or Mobile request/response schema change is required.
```

Update the decision-register header/range if required by that document's maintenance convention.

Do not rewrite frozen/historical P9.1 foundation evidence merely to erase the previous implementation.

---

## 6. Preflight Before Editing

Work from the canonical VPS repository, expected at:

```text
/opt/bmo/app
```

Before mutation, capture and report without exposing secrets:

```bash
cd /opt/bmo/app
git status --short
git branch --show-current
git rev-parse HEAD
git remote -v
```

Also record the current production Backend container/image and health state.

At minimum verify the currently active Backend health endpoints appropriate to the production runtime, including:

```text
/livez
/readyz
```

Inspect the active production Compose/runtime definition rather than assuming an old candidate command is still current.

Do not print environment-file contents or secrets.

If the repository has unrelated uncommitted changes, do not overwrite them. Isolate this task safely and report the condition.

---

## 7. Implementation Sequence

Execute in this order:

1. Audit the current live source to confirm where the login limiter is attached.
2. Confirm registration and other auth limiters are separate behaviors that must remain.
3. Remove only the login route's `authLimiter` middleware attachment.
4. Update the focused rate-limit regression test.
5. Update the full HTTP integration expectation for repeated invalid logins.
6. Add the current decision-register superseding entry.
7. Run formatting/lint only if the repository already has such a standard command; do not introduce new tooling.
8. Run focused tests.
9. Run TypeScript typecheck.
10. Run the full P9 backend test suite.
11. Run Backend build.
12. Inspect `git diff` and verify there are no unrelated changes.
13. Commit and push to the current intended working branch according to the repository's existing workflow.
14. Build an immutable Backend image from the verified commit.
15. Validate it as a candidate using the existing candidate workflow without modifying production dependencies.
16. Promote **Backend only** after candidate verification passes.
17. Verify production health and login behavior.
18. Report final SHA, image identity, test evidence, production health, and rollback image.

No Prisma migration is expected or authorized for this task.

---

## 8. Required Commands / Verification

From `/opt/bmo/app/backend`, the repository currently exposes these relevant scripts:

```bash
npm run typecheck
npm run test:p9
npm run build
```

For focused verification, run Vitest directly against the changed tests, for example:

```bash
npx vitest run tests/p9/auth-rate-limit.integration.test.ts
```

Also run the applicable HTTP integration test environment used by this repository.

If an integration test requires the existing test database/runtime, use the repository's established workflow; do not improvise destructive DB commands.

Before deployment, search the final source for login limiter attachment:

```bash
grep -n 'router.post("/auth/login"' backend/src/p9/http/auth.route.ts
```

The login route must not include `authLimiter` or another replacement frequency limiter.

Also confirm register still does:

```bash
grep -n 'router.post("/auth/register"' backend/src/p9/http/auth.route.ts
```

---

## 9. Candidate and Production Safety

This is a Backend-only change.

Preserve all existing production dependencies and state:

- PostgreSQL and its data;
- Hermes;
- Audio Service;
- WhatsApp bridge;
- WhatsApp identity resolver;
- Caddy;
- firewall;
- secrets;
- avatar/bug-report/audio storage;
- Spotify configuration;
- migrations.

Do not run Docker prune/cleanup.

Do not recreate PostgreSQL for this task.

Do not run migrations.

Do not deploy by editing files inside a running container.

Build a new immutable Backend image from the tested commit and use the repository's current Backend-only cutover mechanism. Preserve the previous production image as rollback.

If the current production Compose is `/opt/bmo/app/ops/deploy/p9.1-production-compose.yml`, update only the production Backend image reference through the existing production env/config mechanism and recreate only the Backend service. Verify the actual live workflow first; do not treat historical runbook commands as automatically current.

---

## 10. Production Acceptance Test

After Backend promotion:

### Health

Required:

```text
/livez  → HTTP 200
/readyz → acceptable production-ready result according to current runtime contract
```

No new degradation may be introduced.

### Repeated invalid login

Perform a controlled smoke test using a non-sensitive test/nonexistent email and invalid password.

Send more than five login attempts inside 15 minutes through the normal production HTTP path.

Expected:

```text
attempt 1  → canonical invalid-login response, not 429
attempt 2  → canonical invalid-login response, not 429
attempt 3  → canonical invalid-login response, not 429
attempt 4  → canonical invalid-login response, not 429
attempt 5  → canonical invalid-login response, not 429
attempt 6+ → canonical invalid-login response, not 429
```

Currently the canonical invalid-credential status is expected to be HTTP `401`.

Do not log or report the password used for the smoke test.

### Successful login

If a dedicated safe test account/credential already exists in the established acceptance workflow, verify a valid login still succeeds normally.

Do not create or expose production credentials just for this task if no safe fixture exists. Unit/integration evidence is sufficient for the valid-login path in that case; state this limitation honestly.

### Other rate limits

Do not intentionally hammer unrelated production endpoints merely to prove their rate limits still exist. Preserve them through source/test evidence instead.

---

## 11. Acceptance Criteria

The task is complete only when all applicable items below are proven:

- [ ] `POST /api/v1/auth/login` has no local frequency rate-limit middleware.
- [ ] More than five repeated invalid login attempts do not become local HTTP `429` responses.
- [ ] Invalid credentials still return the normal sanitized authentication failure.
- [ ] Valid credentials still follow the normal successful login path.
- [ ] `POST /api/v1/auth/register` rate limiting is unchanged.
- [ ] Refresh rate limiting is unchanged.
- [ ] Password recovery rate limiting is unchanged.
- [ ] Pairing rate limiting is unchanged.
- [ ] Avatar rate limiting/admission is unchanged.
- [ ] Hardware/device ingestion rate limits are unchanged.
- [ ] Spotify/provider `429` mapping is unchanged.
- [ ] No `express-rate-limit` dependency removal occurred.
- [ ] No database schema/migration change occurred.
- [ ] Focused regression tests pass.
- [ ] Full P9 test suite passes.
- [ ] Typecheck passes.
- [ ] Backend build passes.
- [ ] Candidate health passes before promotion.
- [ ] Production Backend health passes after promotion.
- [ ] Production repeated-login smoke test proves no local login `429`.
- [ ] Previous production Backend image remains available for rollback.
- [ ] Git working tree is clean after completion.
- [ ] Final commit is pushed to the intended remote branch.

---

## 12. Rollback

Before production cutover, record:

```text
previous production git SHA
previous production Backend image tag
previous production Backend image ID/digest
```

If production health or authentication regresses:

1. restore the previous Backend image reference;
2. recreate/restart only the Backend service using the established production Compose workflow;
3. verify `/livez` and `/readyz`;
4. verify normal login behavior is restored;
5. do not alter PostgreSQL or run down migrations because this task contains no migration.

---

## 13. Final Report Required From the VPS Agent

Return a concise evidence report with this structure:

```text
REMOVE_LOGIN_RATE_LIMIT_COMPLETE | BLOCKED

Source
- branch:
- previous SHA:
- final SHA:
- remote equality:
- git status:

Implementation
- login limiter removed: yes/no
- register limiter preserved: yes/no
- other limiters changed: none / explain
- migrations: none

Tests
- focused login no-rate-limit regression:
- register limiter preservation regression:
- HTTP integration:
- full P9 tests:
- typecheck:
- build:

Candidate
- image tag:
- image ID/digest:
- health:

Production
- previous image:
- deployed image:
- /livez:
- /readyz:
- repeated invalid login attempts tested:
- any 429 from local login limiter: yes/no

Docs
- decision register new entry:

Rollback
- preserved rollback image:

Notes
- blockers, limitations, or unexpected source/runtime differences:
```

Never include passwords, tokens, JWTs, API keys, database URLs, or secret-file contents in the report.

---

## 14. Scope Lock

**The user requested exactly one behavioral change:** remove the Backend rate limit on login.

Do not turn this task into a broader authentication redesign or a removal of rate limiting across BMO.
