# BMO VPS Mobile and Device Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate the frozen mobile/device application contract into the single production-shaped BMO Backend API candidate while preserving the public physical voice path and keeping production rollout gated.

**Architecture:** Extend the existing `createBackendRuntime` and P9.1 Prisma runtime; do not create a second business API. PostgreSQL remains durable truth, `/api/v1/ws` is a separate authenticated mobile event transport, `/ws` remains the device voice socket with an additive owner-binding bridge, and Hermes/Audio/provider calls stay behind Backend services.

**Tech Stack:** Node 22, TypeScript, Express 5, `ws`, Prisma 7/PostgreSQL 16, Zod, Argon2id, JOSE, Node AES-256-GCM, Vitest/Supertest, Docker Compose, Caddy.

---

## Milestone 0 — Runtime security and preflight

**Files:**
- Modify: `docs/integration/05-IMPLEMENTATION-STATUS.md`
- Modify: `docs/integration/09-ENDPOINT-EVENT-COVERAGE-MATRIX.md`
- Modify: `docs/p9/19-security-encryption.md`
- Modify: `docs/p9/25-unresolved-decisions.md`
- Modify: `docs/NEXT-ACTION.md`

- [ ] Identify port 5555 listener ownership, process ancestry, Docker publication, Caddy references, and readable firewall state without printing secrets.
- [ ] Stop only the undeclared Prisma Studio process with `SIGTERM`; verify no listener/process remains and production services remain healthy.
- [ ] Record the exact evidence and retain UFW/nft visibility as a separate operator limitation when passwordless privilege is unavailable.
- [ ] Run the documentation verifier and commit the coherent security checkpoint.

## Milestone 1 — Production-shaped P9.1 and identity foundation

**Files:**
- Modify: `backend/src/config/env.ts`
- Modify: `backend/src/p9/config.ts`
- Modify: `backend/src/server.ts`
- Modify: `backend/src/p9/http/auth.route.ts`
- Modify: `backend/src/p9/services/auth.service.ts`
- Modify: `backend/src/p9/services/session.service.ts`
- Create: `backend/src/p9/services/device-binding.service.ts`
- Modify: `backend/src/websocket/websocket.server.ts`
- Modify: `backend/src/websocket/device-registry.ts`
- Test: `backend/tests/p9/production-integration.test.ts`
- Test: `backend/tests/p9/session-device.unit.test.ts`
- Test: `backend/tests/p9/device-binding.unit.test.ts`
- Test: `backend/tests/websocket.integration.test.ts`

- [ ] Write route-regression tests proving P9 routes and device voice routes coexist in one runtime, then observe the candidate test fail before enabling the router in production-shaped config.
- [ ] Set one-hop proxy trust explicitly for Caddy and prove rate-limit keys use the originating client address without accepting arbitrary forwarded chains.
- [ ] Write and run failing tests for optional `clientDeviceId` issuance; verify the authenticated user owns an active device before storing it and never accept a client-supplied user ID.
- [ ] Write and run failing binding tests for active `hardwareId` plus SHA-256 token equality; keep legacy voice authenticated when no application row binds and deny additive owner features.
- [ ] Re-run pairing, `/ws`, raw-WAV, MP3, typecheck, build, Prisma validation, and synchronized documentation; commit.

## Milestone 2 — Additive application data and account/profile scope

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/20260811190000_phase2_application_foundation/migration.sql`
- Modify: `backend/src/p9/db/repositories.ts`
- Modify: `backend/src/p9/types.ts`
- Modify: `backend/src/p9/validation.ts`
- Create: `backend/src/p9/services/recovery.service.ts`
- Create: `backend/src/p9/services/profile.service.ts`
- Create: `backend/src/p9/services/personalization.service.ts`
- Create: `backend/src/p9/http/profile.route.ts`
- Create: `backend/src/p9/http/personalization.route.ts`
- Modify: `backend/src/p9/http/auth.route.ts`
- Modify: `backend/src/p9/http/router.ts`
- Test: `backend/tests/p9/account-profile.unit.test.ts`
- Test: `backend/tests/p9/account-profile.http.test.ts`
- Test: `backend/tests/p9/phase2-schema.test.ts`

- [ ] Add tests for additive schema names, constraints, nullable rollout fields, and absence of destructive migration statements; observe failure.
- [ ] Add self-service DOB registration, generic two-step recovery, hashed single-use recovery tokens, reset-time logout-all, unique normalized username, safe `SafeUser`, and strict personalization.
- [ ] Add bounded persistent avatar handling with signature validation, opaque generated key, and no original filename/path reuse.
- [ ] Generate Prisma client, run schema/static/API tests, update status/matrix/schema/security docs, and commit without applying production migration.

## Milestone 3 — Mobile realtime, chat, memory, schedules, and proactive delivery

**Files:**
- Create: `backend/src/p9/websocket/mobile-websocket.server.ts`
- Create: `backend/src/p9/websocket/mobile-events.ts`
- Create: `backend/src/p9/services/mobile-events.service.ts`
- Create: `backend/src/p9/services/context-builder.service.ts`
- Create: `backend/src/p9/services/chat.service.ts`
- Create: `backend/src/p9/services/memory.service.ts`
- Create: `backend/src/p9/services/schedule.service.ts`
- Create: `backend/src/p9/services/proactive-delivery.service.ts`
- Create: `backend/src/p9/http/chat.route.ts`
- Create: `backend/src/p9/http/memory.route.ts`
- Create: `backend/src/p9/http/schedule.route.ts`
- Modify: `backend/src/p9/index.ts`
- Modify: `backend/src/server.ts`
- Test: `backend/tests/p9/mobile-websocket.integration.test.ts`
- Test: `backend/tests/p9/chat-memory-schedule.unit.test.ts`
- Test: `backend/tests/p9/chat.http.test.ts`

- [ ] Write failing socket tests for five-second auth, 32 KiB payload, native heartbeat, session revocation, access-token expiry close codes, reconnect, and the frozen event schemas.
- [ ] Implement `/api/v1/ws` as event-only transport and expose a user-scoped event publisher to other services.
- [ ] Write failing chat tests for ownership, 202 persistence, idempotent retry, cursor history, and Hermes completion; implement a context builder that includes allowed personalization and curated memory without secrets.
- [ ] Write failing memory lifecycle tests for candidate accept/reject, edit/delete, forget, clear, export, summary and tenant isolation; implement the PostgreSQL gateway.
- [ ] Write failing schedule and proactive tests for Jakarta normalization, durable states, unique due occurrence, lease/idempotency, expiry and source-neutral delivery; implement bounded worker hooks with retry policy left explicitly gated where frozen.
- [ ] Run regression/static/docs checks and commit.

## Milestone 4 — Device configuration and observability plane

**Files:**
- Create: `backend/src/p9/services/secret-box.service.ts`
- Create: `backend/src/p9/services/wifi.service.ts`
- Create: `backend/src/p9/services/device-observability.service.ts`
- Create: `backend/src/p9/http/wifi.route.ts`
- Modify: `backend/src/websocket/events.ts`
- Modify: `backend/src/websocket/websocket.server.ts`
- Modify: `backend/src/p9/services/settings.service.ts`
- Test: `backend/tests/p9/secret-box.unit.test.ts`
- Test: `backend/tests/p9/wifi-device-events.integration.test.ts`

- [ ] Write failing AES-256-GCM tests for unique nonces, associated-data binding, wrong-key/tag rejection, key-version lookup, and no plaintext persistence/log output.
- [ ] Add protected `P9_ENCRYPTION_KEY_V1` configuration and fail closed when secret-bearing features are enabled without it.
- [ ] Write failing owner/binding tests for Wi-Fi metadata/PUT/DELETE, open networks, latest-write-wins, reconnect redelivery, idempotent receipt/result, and terminal non-redelivery.
- [ ] Add strict bounded parsers and storage for `device_log`, `device_telemetry`, nullable battery, settings application, and generic proactive completion/failure.
- [ ] Preserve all existing device events and voice tests; keep every physical behavior `PENDING_PHYSICAL_ESP`; update docs and commit.

## Milestone 5 — Provider boundaries, plugins, and support

**Files:**
- Create: `backend/src/p9/services/whatsapp.service.ts`
- Create: `backend/src/p9/services/spotify.service.ts`
- Create: `backend/src/p9/services/plugin.service.ts`
- Create: `backend/src/p9/services/bug-report.service.ts`
- Create: `backend/src/p9/http/integration.route.ts`
- Create: `backend/src/p9/http/plugin.route.ts`
- Create: `backend/src/p9/http/support.route.ts`
- Test: `backend/tests/p9/integrations.unit.test.ts`
- Test: `backend/tests/p9/integrations-support.http.test.ts`

- [ ] Recheck Spotify Authorization Code requirements against current official provider documentation and pin callback/state/refresh behavior in tests.
- [ ] Implement single-use expiring OAuth state, exact callback allow-list, encrypted server-held tokens, normalized actions, and safe blocked behavior when credentials are absent.
- [ ] Implement the non-secret WhatsApp connection/rules/preview/confirmation boundary; return normalized unavailable state while live Hermes session/API remains `BLOCKED_EXTERNAL_SECRET`.
- [ ] Implement the exact two-item plugin catalog and bounded multipart bug reports/attachments.
- [ ] Run tests/security scans/docs synchronization and commit.

## Milestone 6 — Candidate migration and final drift loop

**Files:**
- Modify: `p9.1-compose.yml`
- Modify: `.env.backend.example`
- Modify: `.env.p9.1.example`
- Modify: `docs/integration/05-IMPLEMENTATION-STATUS.md`
- Modify: `docs/integration/09-ENDPOINT-EVENT-COVERAGE-MATRIX.md`
- Modify: `docs/NEXT-ACTION.md`
- Modify: relevant `docs/p9/*.md`

- [ ] Build an immutable review image and apply all migrations only to an isolated candidate database; capture empty, upgrade, repeat-deploy and migration-history evidence.
- [ ] Exercise candidate auth/REST/mobile WS/device WS/Hermes/Audio connectivity without making Caddy public or changing production.
- [ ] Enumerate registered REST routes, mobile events, device events, Prisma models/migrations, listeners, containers, Caddy routes, observability, and secret variable names; compare every row with the coverage matrix.
- [ ] Run Node 22 full tests, typecheck, build, Prisma validation, documentation verifier, voice regressions, and Audio Service tests in a test-capable image/environment.
- [ ] Record `PENDING_PHYSICAL_ESP`, `BLOCKED_EXTERNAL_SECRET`, rollback path, exact next operator action, final SHA/status, then push the implementation branch.
