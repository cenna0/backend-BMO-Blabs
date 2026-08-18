# Pairing Code Only Enrollment Pre-Merge Fix Implementation Plan

> **For agentic workers:** This plan is being executed inline in the approved feature worktree. No commit, push, merge, deploy, or production mutation is authorized.

**Goal:** Deliver delayed code-only pairing events to the current authenticated hardware socket after socket replacement, while preserving application-binding gates and correcting active lifecycle/security documentation.

**Architecture:** The unbound enrollment callback will use the existing pairing-only `sendPairingEvent(deviceId, event)` boundary after issuance. The registry resolves the current authenticated socket for that hardware identity, so a delayed result from socket A is delivered to replacement socket B without adding persistence or changing issuance cooldowns. Additive owner-specific events continue through `sendAdditiveEvent` and application-binding authorization.

**Tech Stack:** TypeScript, `ws`, Vitest, Prisma schema/migration checks, Markdown integration contracts, Python repository verifiers.

---

### Task 1: Reproduce the replaced-socket pairing race

**Files:**
- Modify: `backend/tests/websocket.integration.test.ts`

- [ ] Add a deterministic test with a deferred first `onDeviceNotBound` result, replacement authentication, a cooldown-like second callback returning no event, and release of the first result.
- [ ] Assert the replacement socket receives `pairing_code`, the replaced socket receives no `pairing_code`, the additive event path remains blocked without a binding, and the callback does not require a five-second wait.
- [ ] Run the focused test and confirm it fails because the current implementation still sends only to the originating socket.

### Task 2: Route delayed unbound pairing through the current-device sender

**Files:**
- Modify: `backend/src/websocket/websocket.server.ts`

- [ ] Replace the origin-socket liveness check and direct send for `onDeviceNotBound` results with `sendPairingEvent(deviceId, event)`.
- [ ] Leave `PairingBypassEvent` narrowed to `PairingCodeEvent | PairingCompletedEvent`.
- [ ] Preserve `sendAdditiveEvent` authorization and all legacy voice paths.
- [ ] Run the focused WebSocket and pairing tests and confirm the regression passes.

### Task 3: Synchronize active contracts and accepted security decisions

**Files:**
- Modify: `docs/NEXT-ACTION.md`
- Modify: `docs/integration/00-START-HERE.md`
- Modify: `docs/integration/01-MOBILE-BACKEND-API-CONTRACT.md`
- Modify: `docs/integration/02-BACKEND-DEVICE-ADDITIVE-CONTRACT.md`
- Modify: `docs/integration/05-IMPLEMENTATION-STATUS.md`
- Modify: `docs/integration/06-DECISION-REGISTER.md`
- Modify: `docs/integration/08-DOCS-MAINTENANCE-PROTOCOL.md`
- Modify: `docs/integration/09-ENDPOINT-EVENT-COVERAGE-MATRIX.md`

- [ ] Reframe current state as reviewed source implementation, not deployed production: migration #7 is not applied in production and physical acceptance remains `PENDING_PHYSICAL_ESP`.
- [ ] State that `hardwareId` is a non-secret `SafeDevice` response field but never a Mobile pairing input; keep credentials, `DEVICE_TOKEN`, `deviceCredential`, and `tokenHash` out of Mobile.
- [ ] Record the accepted code-only MVP decision that arbitrary invalid codes cannot be attributed to a specific enrollment without changing the locked `{code}` UX, while retaining all existing user/session/IP limits, TTL, uniqueness, one-time use, replacement invalidation, generic errors, and first-valid-claim semantics.
- [ ] Preserve route count 79, Mobile WebSocket count 12, and the three hardware pairing event names.

### Task 4: Verify the complete pre-merge state

**Files:**
- No additional source or schema changes authorized.

- [ ] Run focused pairing/WebSocket tests, the full Backend suite, Prisma validation/generation, typecheck, build, packaging tests, docs verifier, Mobile REST/WS coverage checks, migration manifest validation, secret scan, and `git diff --check`.
- [ ] Confirm migration #7 is unchanged and not executed in production.
- [ ] Inspect `git diff --stat`, changed-file list, and branch status; confirm no commit, push, merge, deploy, or production mutation occurred.
