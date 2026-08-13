# Memory Lifecycle API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the backend-owned memory lifecycle APIs and bounded PostgreSQL chat-memory context without changing device, schedule, integration, migration, or deployment behavior.

**Architecture:** A focused `MemoryService` owns validation-independent lifecycle policy and transaction/idempotency behavior over `P9Repositories`. An Express memory router derives the owner only from bearer authentication and translates strict schemas into service calls. `PostgresMemoryGateway` provides bounded, owner-scoped active-record retrieval to both the service and `ChatService`.

**Tech Stack:** Node 22, TypeScript, Express 5, Zod, Prisma 7, PostgreSQL, Vitest, Supertest.

---

### Task 1: Freeze HTTP and validation behavior

**Files:**
- Create: `backend/tests/p9/memory.http.test.ts`
- Create: `backend/tests/p9/memory.validation.test.ts`
- Create: `backend/src/p9/http/memory.route.ts`
- Create: `backend/src/p9/memory.validation.ts`

- [ ] Write failing Supertest coverage for every frozen route, bearer-derived ownership, strict bodies, request IDs, UUIDs, pagination bounds, and exact memory-settings bodies.
- [ ] Run `npm test -- tests/p9/memory.http.test.ts tests/p9/memory.validation.test.ts` from `backend`; expect missing-module failures.
- [ ] Implement the route and bounded Zod schemas.
- [ ] Re-run the focused tests; expect all tests to pass.

### Task 2: Implement lifecycle and privacy behavior

**Files:**
- Create: `backend/tests/p9/memory.service.unit.test.ts`
- Create: `backend/src/p9/services/memory.service.ts`

- [ ] Write failing tests for deterministic cursor pagination, owner-safe record access, edit/delete, accept/reject replay and conflict, topic forgetting, clear-all, JSON export, expiry/deletion filtering, audits, request IDs, and durable summary status/feedback.
- [ ] Run `npm test -- tests/p9/memory.service.unit.test.ts`; expect missing-module failures.
- [ ] Implement transaction-locked lifecycle methods with `MemoryAction` idempotency records and soft-delete prevention of resurfacing.
- [ ] Re-run the service tests; expect all tests to pass.

### Task 3: Add PostgreSQL chat memory retrieval

**Files:**
- Create: `backend/tests/p9/memory.gateway.unit.test.ts`
- Create: `backend/src/p9/services/memory-gateway.service.ts`
- Modify: `backend/src/p9/services/chat.service.ts`

- [ ] Write failing tests for bounded relevant active records, expired/deleted filtering, empty behavior, and cross-user isolation.
- [ ] Run the gateway and chat tests; expect missing implementation failures.
- [ ] Implement owner-scoped relational search and inject it into chat runtime; do not create candidates from chat.
- [ ] Re-run the focused tests; expect all tests to pass and no candidate writes.

### Task 4: Wire runtime and synchronize evidence

**Files:**
- Modify: `backend/src/p9/http/router.ts`
- Modify: `backend/src/p9/index.ts`
- Modify: `docs/integration/05-IMPLEMENTATION-STATUS.md`
- Modify: `docs/integration/09-ENDPOINT-EVENT-COVERAGE-MATRIX.md`
- Modify: `docs/p9/23-test-acceptance-matrix.md`

- [ ] Add `MemoryService` to the P9 runtime/router without changing existing voice, device, mobile WebSocket, or Hermes interfaces.
- [ ] Update only source-tier memory claims and fresh exact test counts; retain candidate/public/physical gaps.
- [ ] Confirm `docs/p9/P9.1-IMPLEMENTATION-EVIDENCE.md` and `docs/p9/P9.1-FOUNDATION-REVIEW.md` hashes are unchanged.

### Task 5: Verify and commit

**Files:** all files above.

- [ ] Run focused memory/chat tests, full Node 22 backend tests, typecheck, build, Prisma validate/generate, documentation verifier, and dependency audit.
- [ ] Inspect the diff for scope, ownership, secrets, migrations, and protected-doc changes.
- [ ] Commit all slice files with `feat(api): add memory lifecycle APIs` and report the SHA plus evidence.
