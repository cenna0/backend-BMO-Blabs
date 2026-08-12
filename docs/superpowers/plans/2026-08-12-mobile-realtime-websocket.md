# Mobile Realtime WebSocket Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the frozen authenticated mobile event WebSocket at `/api/v1/ws` without changing the physical-device `/ws` contract.

**Architecture:** A dedicated `MobileWebSocketServer` owns only the `/api/v1/ws` upgrade path, validates bounded typed events, authenticates through a narrow P9 callback, indexes authenticated sockets by server-derived user ID, and exposes bounded per-user fanout. The backend runtime wires it only when P9 is enabled and shuts it down before closing P9 resources.

**Tech Stack:** TypeScript, `ws`, Zod, Vitest, existing P9 JWT/session services.

---

### Task 1: Protocol schemas and connection lifecycle

**Files:**
- Create: `backend/src/p9/websocket/mobile-events.ts`
- Create: `backend/src/p9/websocket/mobile-websocket.server.ts`
- Test: `backend/tests/p9/mobile-websocket.integration.test.ts`

- [ ] Write a failing integration test for `/api/v1/ws` authentication success through a narrow callback, and prove `/ws` is not claimed by the mobile server.
- [ ] Run the focused test and confirm RED because the server does not exist.
- [ ] Add strict Zod schemas for the authenticate command and nine frozen outbound event types, each with bounded strings, UUIDs, ISO timestamps, nullable fields, and closed enums.
- [ ] Add the dedicated no-server `WebSocketServer`, exact pathname upgrade handling, 5-second authentication timer, 32 KiB payload limit, close codes, per-user socket index, and idempotent close.
- [ ] Run the focused test and confirm GREEN.

### Task 2: Defensive protocol behavior

**Files:**
- Modify: `backend/tests/p9/mobile-websocket.integration.test.ts`
- Modify: `backend/src/p9/websocket/mobile-websocket.server.ts`

- [ ] Add one failing behavior test at a time for timeout, query-token/path rejection, malformed/binary/oversize input, invalid or revoked session, expiry closure, repeated authentication, heartbeat termination, typed fanout, and token non-reflection.
- [ ] For each RED test, add only the corresponding close/send behavior and rerun it to GREEN.
- [ ] Run the complete focused WebSocket suite.

### Task 3: P9 and backend runtime integration

**Files:**
- Modify: `backend/src/p9/index.ts`
- Modify: `backend/src/server.ts`
- Modify: `backend/tests/p9/mobile-websocket.integration.test.ts`
- Modify: `backend/tests/helpers/test-runtime.ts`

- [ ] Add a failing test that mounts device and mobile WebSockets on one HTTP server and proves exact path separation.
- [ ] Expose a narrow P9 `authenticateMobileSocket(accessToken)` callback that verifies signature/expiry and checks the server-side session row.
- [ ] Instantiate mobile WebSocket only for enabled P9, expose it on `BackendRuntime`, and close sockets before disconnecting Prisma.
- [ ] Run existing device WebSocket and backend integration tests to prove no `/ws` regression.

### Task 4: Documentation and verification

**Files:**
- Modify: `docs/integration/05-IMPLEMENTATION-STATUS.md`
- Modify: `docs/integration/09-ENDPOINT-EVENT-COVERAGE-MATRIX.md`

- [ ] Record source/test verification only; do not claim public deployment, production migration, or physical ESP verification.
- [ ] Run Node 22 focused and full tests, typecheck, build, Prisma validate/generate, docs verifier, P9 audit, and dependency audit.
- [ ] Confirm the frozen P9.1 historical files are byte-identical to the starting commit.
- [ ] Commit the coherent slice as `feat(api): add mobile realtime websocket`.
