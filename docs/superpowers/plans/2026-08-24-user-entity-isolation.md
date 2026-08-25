# User Entity Isolation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce one active physical BMO device per user and preserve strict user ownership across memory, chat, schedules, and plugin connections.

**Architecture:** Keep one PostgreSQL database with tenant-style rows keyed by `userId`. The authenticated JWT remains the only source of user identity; provider credentials and application records are looked up through `(userId, provider)`. WhatsApp transport is connection-scoped: the manager launches one Hermes bridge child and one session directory per `IntegrationConnection`, while pairing and identity resolution carry the same connection identifier.

**Tech Stack:** TypeScript, Prisma/PostgreSQL, Express, Vitest.

---

### Task 1: Enforce one active BMO device per user

**Files:**
- Modify: `backend/src/p9/services/device.service.ts:49-63`
- Modify: `backend/prisma/schema.prisma:350-380`
- Create: `backend/prisma/migrations/20260824100000_one_active_device_per_user/migration.sql`
- Test: `backend/tests/p9/device.unit.test.ts`

- [ ] **Step 1: Write the failing service test**

Add a fixture for `device.count` and assert that claiming a second active device raises `CONFLICT` before `device.create`.

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npm --prefix backend test -- tests/p9/device.unit.test.ts`

Expected: FAIL because `createClaimed` currently creates another active device after counting it.

- [ ] **Step 3: Implement the service guard**

After `lockUser`, count active devices. If the count is non-zero, throw `new P9Error("CONFLICT", 409, "User already has an active BMO device")`; otherwise create the device.

- [ ] **Step 4: Add the database invariant**

Add a partial unique index on `Device("userId") WHERE "status" = 'ACTIVE'`. Keep revoked historical devices allowed.

- [ ] **Step 5: Run the focused test and Prisma validation**

Run: `npm --prefix backend test -- tests/p9/device.unit.test.ts` and `npm --prefix backend run prisma:validate`.

Expected: PASS and valid Prisma schema.

### Task 2: Add cross-user ownership regression coverage

**Files:**
- Test: `backend/tests/p9/whatsapp.integration.service.unit.test.ts`
- Test: `backend/tests/p9/spotify.integration.service.unit.test.ts`
- Test: `backend/tests/p9/memory.service.unit.test.ts` or the existing memory service test file
- Test: `backend/tests/p9/http.integration.test.ts`

- [ ] **Step 1: Add failing cross-user cases**

Cover that User B cannot read User A's WhatsApp conversation, send through User A's connection, invoke Spotify using User A's credential, or retrieve User A's memory by ID.

- [ ] **Step 2: Run focused tests and verify each failure is ownership-related**

Run: `npm --prefix backend test -- tests/p9/whatsapp.integration.service.unit.test.ts tests/p9/spotify.integration.service.unit.test.ts tests/p9/memory.service.unit.test.ts tests/p9/http.integration.test.ts`.

- [ ] **Step 3: Fix only missing ownership predicates**

Every lookup of an owned entity must include both its identifier and the authenticated `userId`; no route may accept a caller-supplied owner ID.

- [ ] **Step 4: Re-run the focused tests**

Expected: all cross-user cases pass and no provider call is made for a foreign user.

### Task 3: Document the current WhatsApp transport boundary

**Files:**
- Modify: `docs/operations/MAINTENANCE-AND-RECOVERY.md` or the existing WhatsApp operations document
- Modify: `ops/whatsapp/README.md`

- [ ] **Step 1: State the supported ownership model**

Document that database records and runtime bridge sessions are user-scoped through `IntegrationConnection`; the manager is the only component allowed to fan out to child bridge sessions.

- [ ] **Step 2: Add the next adapter contract**

Document that the future provider boundary must carry `connectionId` for `status`, `poll`, `send`, `disconnect`, and pairing, with one session directory per connection.

- [ ] **Step 3: Run documentation verification**

Run: `python3 scripts/verify-backend-mvp-docs.py`.

### Task 4: Full verification

**Files:**
- No additional files.

- [ ] **Step 1: Run backend typecheck**

Run: `npm --prefix backend run typecheck`.

- [ ] **Step 2: Run all P9 tests**

Run: `npm --prefix backend run test:p9`.

- [ ] **Step 3: Inspect the final diff**

Run: `git diff --check` and `git diff --stat`; confirm the pre-existing local integration changes remain intact.
