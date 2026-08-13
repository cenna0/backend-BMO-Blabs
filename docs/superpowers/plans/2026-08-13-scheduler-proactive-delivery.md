# Scheduler and Proactive Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add owner-scoped schedule APIs and one durable proactive-delivery queue/worker while keeping physical ESP playback unimplemented and pending.

**Architecture:** `ScheduleService` owns strict Jakarta recurrence normalization, lifecycle transitions, deterministic pagination, and occurrence creation. PostgreSQL repository primitives use the database clock, row locks, leases, and existing unique constraints for race-safe due-run and delivery claims. `ProactiveDeliveryService` accepts `CHAT|SCHEDULE|WHATSAPP` through one enqueue path and worker, emits typed mobile status events, and delegates only to an optional generic physical sender boundary.

**Tech Stack:** Node 22, TypeScript, Express 5, Zod, Prisma 7, PostgreSQL, Vitest, Supertest.

---

### Task 1: Freeze schedule HTTP and recurrence behavior

**Files:**
- Create: `backend/tests/p9/schedule.http.test.ts`
- Create: `backend/tests/p9/schedule.validation.test.ts`
- Create: `backend/tests/p9/schedule.recurrence.unit.test.ts`
- Create: `backend/src/p9/http/schedule.route.ts`
- Create: `backend/src/p9/schedule.validation.ts`
- Create: `backend/src/p9/schedule.recurrence.ts`

- [ ] Write failing tests for all eight routes, bearer-derived ownership, strict bounded bodies/queries, Jakarta normalization, Weekly/Daily/Once rules, device targets, version preconditions, request IDs, and deterministic cursors.
- [ ] Run the focused tests and retain the expected missing-module failures as RED evidence.
- [ ] Implement schemas, recurrence calculation, and route translation only.
- [ ] Re-run focused tests and keep them green.

### Task 2: Implement schedule lifecycle and concurrency

**Files:**
- Create: `backend/tests/p9/schedule.service.unit.test.ts`
- Create: `backend/src/p9/services/schedule.service.ts`
- Modify: `backend/src/p9/db/repositories.ts`

- [ ] Write failing tests for owner/device validation, create/read/update, pause/resume/cancel, one-shot completion, optimistic mutation conflicts, audit request IDs, and pagination tie-breakers.
- [ ] Run the service tests and retain RED evidence.
- [ ] Implement transaction-locked lifecycle changes and repository access.
- [ ] Re-run the focused service tests.

### Task 3: Implement PostgreSQL due-run claims

**Files:**
- Create: `backend/tests/p9/schedule-claim.unit.test.ts`
- Modify: `backend/src/p9/db/repositories.ts`
- Modify: `backend/src/p9/services/schedule.service.ts`

- [ ] Write failing tests for DB-clock occurrence materialization, unique `(scheduleId,dueAt)` replay, atomic lease claims, expired-lease takeover, retry eligibility, missed deadlines, and claim races.
- [ ] Run the claim tests and retain RED evidence.
- [ ] Add bounded raw-SQL claim/materialization primitives and schedule advancement.
- [ ] Re-run claim and lifecycle tests.

### Task 4: Implement one generic proactive worker

**Files:**
- Create: `backend/tests/p9/proactive-delivery.service.unit.test.ts`
- Create: `backend/src/p9/services/proactive-delivery.service.ts`

- [ ] Write failing tests proving all three sources share one enqueue/claim path, user-scoped idempotency, five-minute baseline expiry, retry attempts, per-device serialization, user-voice priority, mobile event production, and safe pending behavior when no physical sender exists.
- [ ] Run the worker tests and retain RED evidence.
- [ ] Implement enqueue/process/retry/expiry with an optional generic device sender interface; do not add ESP protocol handlers or claim playback.
- [ ] Re-run worker tests.

### Task 5: Wire runtime and synchronize canonical evidence

**Files:**
- Modify: `backend/src/p9/http/router.ts`
- Modify: `backend/src/p9/index.ts`
- Modify: `docs/integration/01-MOBILE-BACKEND-API-CONTRACT.md`
- Modify: `docs/integration/02-BACKEND-DEVICE-ADDITIVE-CONTRACT.md`
- Modify: `docs/integration/05-IMPLEMENTATION-STATUS.md`
- Modify: `docs/integration/09-ENDPOINT-EVENT-COVERAGE-MATRIX.md`
- Modify: `docs/p9/13-scheduler-proactive-speech.md`
- Modify: `docs/p9/23-test-acceptance-matrix.md`

- [ ] Inject services into the existing P9 router/runtime and existing mobile fanout only.
- [ ] Update exact source/test-tier status and counts; retain candidate/public/physical gaps and all protected P9.1 historical files.
- [ ] Confirm no Prisma migration, deployment, Wi-Fi/log/telemetry/settings event, integration, bug-report, Spotify, WhatsApp, or voice-preview changes.

### Task 6: Verify and commit

**Files:** all files above.

- [ ] Run focused and full backend tests under Node 22, typecheck, build, Prisma validate/generate, docs verifier, and dependency audit.
- [ ] Inspect the diff for scope, ownership, secrets, migration absence, and protected-doc hashes.
- [ ] Commit once with `feat(api): add schedules and proactive delivery` and report the SHA and evidence.
