# P9 Phased Execution Plan

**Status:** `P9.1 LOCKED; P9.2–P9.6 PROPOSED`
**Execution rule:** one subphase per authorized implementation turn; stop at
  the acceptance gate and record evidence before starting the next.

The sequence preserves the requested P9.1–P9.6 baseline. P9 architecture work
is complete only when the documents are reviewed; no item below is an
implementation claim.

## P9.1 — PostgreSQL, Prisma, auth, users, devices, pairing, settings — LOCKED

- **Prerequisites:** P8 production evidence reviewed; P6/P7 deployment and
  backup paths available; P9.1 decisions approved; secrets supplied out of
  band; no public contract change.
- **Scope:** one pinned-major private PostgreSQL container; Prisma bootstrap;
  invite-only registration; email/password login with Argon2id; approximately
  15-minute access tokens; opaque random rotating refresh tokens with hashes
  only in PostgreSQL; per-device session revocation; provider-neutral identity
  schema; devices, ownership, six-digit pairing, revocation; server-enforced
  `Asia/Jakarta`; user/device settings; audit events; readiness and health
  checks; migration/backup baseline.
- **Non-goals:** chat history, long-term memory, scheduler runtime, alarms,
  proactive audio, Spotify, WhatsApp, pgvector, Mem0, Qdrant, Obsidian,
  Markdown import, custom voices, RVC, HW Contract v1.1.0, dynamic Audio
  Service settings integration, mobile visual design, or moving voice request
  state out of memory.
- **Schema impact:** `Invitation`, `User`, `PasswordCredential`,
  `AuthIdentity`, `Session`, `RefreshToken`, `Device`, `DevicePairing`,
  `UserSettings`, `DeviceSettings`, `AuditEvent`.
- **API impact:** `/auth/register`, `/auth/login`, `/auth/refresh`,
  `/auth/logout`, session revocation, `/me`, `/devices`, `/pairing/*`,
  `/settings`, and authenticated health/readiness; versioned under `/api/v1`.
- **Hermes impact:** none; existing voice request contract and conversation
  adapter remain intact.
- **Mobile impact:** invite/email-password auth bootstrap, pairing, device
  list, settings foundation; no editable timezone and no chat screen yet.
- **Hardware impact:** none; v1.0.5 remains read-only.
- **Tests:** migration-from-empty, migration-repeat, Argon2id verification,
  invite-only registration, access-token expiry, refresh-token rotation and
  replay handling, per-device session revocation, ownership isolation, pairing
  expiry/replay/attempt limits/revocation, settings validation and timezone
  enforcement, audit redaction, DB restart persistence, scheduled `pg_dump`,
  checksum/encryption, isolated restore, private-port and secret scans.
- **Migration:** `prisma migrate dev` only in development; controlled rollout
  uses `prisma migrate deploy`; never use `prisma db push` in production, never
  migrate automatically at container startup, never reset destructively, and
  use expand/contract changes. Create a pre-migration backup and record commit,
  image, schema version, and rollback target.
- **Rollback:** stop new API routes, restore previous image/config, keep the DB
  volume; do not use a blind down migration. If data rollback is required,
  restore a verified backup into an isolated database and obtain explicit
  approval before replacement.
- **Acceptance gate:** invite-only users can authenticate, refresh/revoke a
  session, pair/revoke a device, read/write approved settings, and survive
  service restart; voice fake-device acceptance remains green; no public
  `5432`; encrypted local backup and isolated restore verification are
  evidenced; the required off-VPS backup destination is recorded as an open
  prerequisite for final production sign-off.

## P9.2 — Chat sessions, messages, curated memory, gateway, deletion/export

- **Prerequisites:** P9.1 verified; authenticated user/device scope; deletion
  and retention policy approved; `MemoryGateway` contract tests written first.
- **Scope:** text/voice chat sessions and messages; transcript metadata;
  `PostgresMemoryGateway`; memory candidate review; view/edit/delete/reject,
  forget-topic, disable-candidates, clear-all, export; safe redaction policy.
- **Non-goals:** raw audio retention, automatic memory for every message,
  Mem0/Qdrant/Obsidian runtime, vector search requirement, or scheduler.
- **Schema impact:** `ChatSession`, `ChatMessage`, `MemoryRecord`,
  `MemoryCandidate`, `MemoryAction`, `MemoryTopicForget`.
- **API impact:** `/chat/sessions`, `/chat/messages`, `/memories`, export,
  deletion, forget-topic, candidate controls.
- **Hermes impact:** Backend sends scoped context and receives assistant text
  plus optional typed action proposals; Hermes has no direct DB dependency.
- **Mobile impact:** chat list/detail, send text, voice transcript display,
  memory review/manage/export controls.
- **Hardware impact:** existing voice path is unchanged; voice transcripts may
  be stored as chat messages after authenticated association.
- **Tests:** ordering/pagination, idempotent message writes, transcript
  redaction, retention/deletion cascades, gateway contract, candidate review,
  forget-topic, export/import validation, tenant isolation, concurrent edits.
- **Migration:** additive tables/indexes; backfill none from Hermes response
  store without a separately approved import and conflict policy.
- **Rollback:** disable memory candidate generation while preserving chat
  writes; roll back API image; do not delete newly stored user data during a
  code rollback.
- **Acceptance gate:** all valid text chats and voice transcripts are visible
  in history; only reviewed/safe memory records persist; every user memory
  control is effective and auditable.

## P9.3 — Schedules, reminders, alarms, worker, proactive device delivery

- **Prerequisites:** P9.1 verified; P9.2 chat identity available for audit;
  timezone and missed-run policy approved; additive hardware event proposal
  reviewed by hardware/software owners.
- **Scope:** schedules, one-time/recurring rules, runs, delivery attempts,
  retries, idempotency, timezone-aware execution, acknowledgement, mobile
  delivery target, device delivery target, worker observability; evaluate a
  PostgreSQL-backed job runner such as pg-boss without installing it here.
- **Non-goals:** scheduler-backed memory, silent reuse of `audio_ready`,
  guaranteed delivery while the server is offline, or firmware changes in this
  architecture phase.
- **Schema impact:** `Schedule`, `ScheduleRun`, `ScheduleDeliveryAttempt`,
  `ScheduleAcknowledgement`, `DeliveryTarget`.
- **API impact:** `/schedules`, `/schedule-runs`, `/reminders`, acknowledgement
  and delivery status endpoints; future scheduled-audio API is separate from
  `/api/v1/voice`.
- **Hermes impact:** optional bounded text generation for a due reminder; no
  direct scheduler ownership and no memory write by default.
- **Mobile impact:** schedule CRUD, timezone display, missed-run policy,
  delivery/acknowledgement status.
- **Hardware impact:** future additive contract only; v1.0.5 unchanged.
- **Tests:** DST/timezone cases, recurring expansion, exactly-once run claim,
  retry/idempotency, missed-run policy, offline device, acknowledgement,
  duplicate delivery, worker restart and backlog drain.
- **Migration:** additive scheduler tables and indexes; seed no schedules;
  enable worker only after dry-run and canary evidence.
- **Rollback:** pause worker claims, mark unclaimed runs recoverable, disable
  proactive device delivery, retain audit rows, and revert to mobile-only or
  server-only notifications.
- **Acceptance gate:** no duplicate run executes, every attempt is auditable,
  timezone behavior is tested, and scheduled speech is impossible through the
  request-bound event path.

## P9.4 — Spotify OAuth, encrypted tokens, actions, mobile status

- **Prerequisites:** P9.1 auth/settings verified; P9.3 action/audit patterns
  available; current Spotify developer policy and scopes rechecked; OAuth
  redirect ownership configured out-of-band.
- **Scope:** Backend-owned Spotify OAuth, encrypted access/refresh token
  storage, refresh/revocation, bounded playback actions, current playback and
  device status, confirmation for consequential actions.
- **Non-goals:** streaming audio through BMO, token exposure to mobile/Hermes,
  unrestricted tool execution, or claiming playback without an active Spotify
  device.
- **Schema impact:** `SpotifyConnection`, `SpotifyOAuthState`,
  `SpotifyAction`, encrypted-token metadata.
- **API impact:** `/integrations/spotify/connect`, callback, disconnect,
  status, devices, playback action, and action-result endpoints.
- **Hermes impact:** typed `spotify.*` action proposals only; Backend validates
  ownership, scope, confirmation, and provider response.
- **Mobile impact:** connect/disconnect, consent, status, active-device UX,
  action confirmation/result.
- **Hardware impact:** none; BMO speech remains the response channel.
- **Tests:** OAuth state/redirect replay, token encryption/refresh/revoke,
  provider error mapping, no-device UX, action authorization, idempotency,
  secret redaction, mobile status freshness.
- **Migration:** additive connection/action tables; no plaintext token
  backfill; require key availability and restore procedure before activation.
- **Rollback:** disable action execution and leave connection read-only or
  disconnected; revoke provider tokens if exposure is suspected.
- **Acceptance gate:** provider credentials never reach clients or Hermes;
  every action is user-scoped, auditable, and honestly reports provider state.

## P9.5 — WhatsApp connection, notification rules, confirmation, recovery

- **Prerequisites:** P9.1 identity/settings; Hermes gateway interface and
  persistent session path documented; security review of session ownership;
  notification consent policy approved.
- **Scope:** Backend bridge to Hermes WhatsApp gateway, connection/QR status,
  session recovery, notification rules, contact/group filters, send-confirmation
  flow, delivery/audit state.
- **Non-goals:** storing the WhatsApp session in PostgreSQL, importing ordinary
  messages into long-term memory, silent outbound sends, or making Hermes APIs
  a mobile contract.
- **Schema impact:** `WhatsAppConnection`, `WhatsAppNotificationRule`,
  `WhatsAppSendRequest`, `WhatsAppDeliveryEvent`.
- **API impact:** `/integrations/whatsapp/connect`, QR/status/recovery,
  notification rules, send-preview/confirm/result.
- **Hermes impact:** adapter-owned gateway calls; Backend owns policy,
  authorization, confirmation, and audit; gateway payloads are minimized.
- **Mobile impact:** connection status/QR, rule editor, preview, confirmation,
  recovery and re-login state.
- **Hardware impact:** notification speech is future/proactive delivery and
  must use the additive scheduled/proactive contract, not v1.0.5 events.
- **Tests:** QR/session expiry, restart recovery, rule evaluation, group/contact
  filtering, confirmation replay, duplicate send idempotency, data minimization,
  no-memory-ingestion regression.
- **Migration:** additive connection/rule/audit tables; do not move existing
  Hermes session bytes into PostgreSQL.
- **Rollback:** disable outbound sends, preserve inbound connection status,
  require confirmation again after recovery, and retain sanitized audit data.
- **Acceptance gate:** no outbound message is sent without an authorized,
  current confirmation; ordinary message content is not memory by default.

## P9.6 — Security, recovery, observability, resource tests, final acceptance

- **Prerequisites:** P9.1–P9.5 evidence complete or an explicitly accepted
  deferral; final threat model; restore rehearsal; hardware proposal review.
- **Scope:** security hardening, key rotation, backup/restore, migration
  rehearsal, structured audit, metrics/tracing, rate limits, load/resource
  tests on the single VPS, canary/rollback rehearsal, documentation closure.
- **Non-goals:** multi-region HA, Kubernetes, Qdrant, Mem0 runtime, voice
  cloning, or changing the hardware contract.
- **Schema impact:** indexes/retention/audit hardening only; no unreviewed
  entity expansion.
- **API impact:** consistency/error/rate-limit hardening and final OpenAPI
  inventory; no undocumented routes.
- **Hermes impact:** contract compatibility and failure isolation tests.
- **Mobile impact:** offline/error/re-auth flows and API-to-screen traceability.
- **Hardware impact:** verify v1.0.5 unchanged and separately review the
  proposed additive events; no firmware rollout in this phase.
- **Tests:** full unit/integration/e2e, security, deletion/export, restore,
  migration, load, resource budget, canary, rollback, docs verifier, and
  `git diff --check`.
- **Migration:** rehearsal from clean database and representative sanitized
  fixture; production migration only after explicit execution authorization.
- **Rollback:** documented per-subphase rollback plus deployment image/config
  rollback; DB restore is a controlled operation with an explicit data-loss
  boundary.
- **Acceptance gate:** all locked decisions are traceable, no secrets exist in
  repository artifacts, resource headroom is evidenced, and P9 is classified
  `ARCHITECTURE_READY_FOR_REVIEW` or `ARCHITECTURE_BLOCKED` honestly.
