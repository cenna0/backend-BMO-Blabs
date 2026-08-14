# WhatsApp Mobile API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a safe Backend-owned WhatsApp conversation/contact contract and complete candidate acceptance for the paired personal account without exposing Hermes/Baileys identities.

**Architecture:** Add an owner-scoped conversation index keyed internally by provider chat reference and exposed as UUIDs. Evolve existing notification/send routes to use conversation IDs, add authenticated list/get/resolve routes, and emit metadata-only WhatsApp mobile events. Keep the official bridge unchanged, BMO as the sole queue consumer, and incoming text outside Hermes privileged paths.

**Tech Stack:** TypeScript, Express, Zod, Prisma/PostgreSQL additive migration, Vitest, systemd unit source.

---

### Task 1: Lock the mobile contract with failing tests

**Files:**
- Modify: `backend/tests/p9/integrations.boundary.unit.test.ts`
- Modify: `backend/tests/p9/integrations.http.test.ts`
- Modify: `backend/tests/p9/whatsapp.integration.service.unit.test.ts`
- Modify: `backend/tests/p9/mobile-events.unit.test.ts`
- Modify: `backend/tests/p9/whatsapp-transport-boundary.unit.test.ts`

- [ ] Add failing schema tests for `conversationId` send preview, phone resolve, bounded list query, and UUID-only notification targets.
- [ ] Add failing route tests for authenticated conversations list/get/resolve and safe response fields.
- [ ] Add failing service tests for DM/GROUP conversation upsert, owner isolation, muted ingestion, and metadata-only realtime notification.
- [ ] Add failing tests proving inbound bodies and provider references are absent from mobile event payloads.
- [ ] Add a failing static test for `[Install] WantedBy=multi-user.target`.
- [ ] Run the focused tests and confirm failures are caused by the missing contract, not test syntax.

### Task 2: Add the additive conversation data model

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/20260814120000_whatsapp_conversations/migration.sql`
- Modify: `backend/tests/p9/schema.test.ts`

- [ ] Add `WhatsAppConversationType` with `DM` and `GROUP` values.
- [ ] Add `WhatsAppConversation` with UUID identity, owner/connection/provider relation, opaque internal chat reference, bounded display name, type, `lastActivityAt`, timestamps, owner-scoped uniqueness, and indexes.
- [ ] Add nullable `conversationId` relations to `WhatsAppDelivery` and `WhatsAppSendRequest` while retaining old internal recipient columns for compatibility.
- [ ] Write the migration with additive table/columns, ownership foreign keys, unique/index constraints, and no production execution.
- [ ] Update schema tests to assert the new model/constraints and run Prisma validation.

### Task 3: Normalize bridge metadata and create conversation indexing

**Files:**
- Modify: `backend/src/p9/providers/hermes-whatsapp.client.ts`
- Modify: `backend/src/p9/services/integration.service.ts`
- Modify: `backend/src/p9/index.ts`
- Modify: `backend/tests/p9/hermes-whatsapp-client.unit.test.ts`
- Modify: `backend/tests/p9/whatsapp.integration.service.unit.test.ts`

- [ ] Preserve bounded `senderName`/`chatName` bridge metadata without returning raw provider identities.
- [ ] Add owner-scoped find/create/update helpers for observed conversations keyed by chat reference.
- [ ] Upsert inbound DM/GROUP conversations before rule evaluation, update activity timestamps, and attach conversation IDs to delivery records.
- [ ] Use safe fallback display names when provider names are absent; never persist inbound message bodies.
- [ ] Emit `whatsapp_notification` with only conversation UUID, display name, type, and timestamp when rules permit.
- [ ] Keep owner-forward events metadata-only and keep `/send` echo deduplication.

### Task 4: Implement validation and authenticated conversation routes

**Files:**
- Modify: `backend/src/p9/integrations.validation.ts`
- Modify: `backend/src/p9/http/integration.route.ts`
- Modify: `backend/src/p9/services/integration.service.ts`
- Modify: `backend/tests/p9/integrations.boundary.unit.test.ts`
- Modify: `backend/tests/p9/integrations.http.test.ts`

- [ ] Add strict schemas for `limit/cursor`, UUID conversation IDs, international phone resolve, optional display name, conversation-scoped send preview, and notification targets.
- [ ] Add authenticated `GET /integrations/whatsapp/conversations`, `GET /integrations/whatsapp/conversations/:id`, and `POST /integrations/whatsapp/conversations/resolve`.
- [ ] Return only BMO-safe conversation fields and derive `notificationEnabled` from owner rules.
- [ ] Evolve notification rules to use conversation IDs for new CONTACT/GROUP rules while retaining internal compatibility for historical rows.
- [ ] Evolve send preview to require a conversation ID; reject raw `recipientRef` from the mobile contract.
- [ ] Enforce ownership and bounded `OWNERSHIP_DENIED`/`INVALID_INPUT` errors.

### Task 5: Complete conversation-scoped outbound lifecycle

**Files:**
- Modify: `backend/src/p9/services/integration.service.ts`
- Modify: `backend/tests/p9/whatsapp.integration.service.unit.test.ts`
- Modify: `backend/tests/p9/integrations.http.test.ts`

- [ ] Resolve the authenticated conversation before creating a preview and persist its ID with the send request.
- [ ] Resolve the internal provider chat reference only inside the Backend before calling official bridge `/send`.
- [ ] Persist outbound delivery and conversation activity with owner-scoped IDs, returning no raw JID.
- [ ] Preserve idempotency, confirmation expiry, bounded provider errors, cross-user rejection, and echo deduplication.
- [ ] Add tests for known conversation send, unknown phone resolve, invalid phone, foreign conversation, provider failure, and successful delivery.

### Task 6: Make the dedicated unit reboot-persistent

**Files:**
- Modify: `ops/whatsapp/systemd/bmo-whatsapp-bridge.service`
- Modify: `backend/tests/p9/whatsapp-transport-boundary.unit.test.ts`

- [ ] Add `[Install]` with `WantedBy=multi-user.target` while preserving `User=hermes`, loopback, bounded restart, privacy, and no Hermes gateway dependency.
- [ ] Run shell syntax and source-level unit verification without modifying the shared service.
- [ ] Reinstall only the targeted unit, run `systemd-analyze verify`, daemon-reload, enable only the dedicated unit, and verify active/loopback/health state.

### Task 7: Verify, document, and perform candidate-only live acceptance

**Files:**
- Modify: `docs/integration/01-MOBILE-BACKEND-API-CONTRACT.md`
- Modify: `docs/integration/05-IMPLEMENTATION-STATUS.md`
- Modify: `docs/integration/06-DECISION-REGISTER.md`
- Modify: `docs/integration/09-ENDPOINT-EVENT-COVERAGE-MATRIX.md`
- Modify: `ops/whatsapp/README.md`

- [ ] Run focused WhatsApp/API tests, full Backend/P9 tests, typecheck, build, Prisma validate, docs verifier, shell syntax, and sole-consumer invariant.
- [ ] Recheck candidate/production/Hermes health, dedicated service reboot enablement, port 3001 loopback, and unchanged shared Hermes PID/restart count.
- [ ] Use authenticated candidate Backend APIs for known-contact notification, send/reply, muted/unknown ingestion, group suppression, prompt-injection isolation, and owner-forward behavior where supported.
- [ ] Record queue durability limitation and live statuses without message content, phone numbers, JIDs, tokens, QR, or session data.
- [ ] Update the Mobile-facing contract and mark WhatsApp `CANDIDATE_VERIFIED` only after real Backend acceptance; keep production promotion separate.
- [ ] Commit and push implementation, migration source, tests, service persistence fix, and docs; never apply production migrations/deployment.
