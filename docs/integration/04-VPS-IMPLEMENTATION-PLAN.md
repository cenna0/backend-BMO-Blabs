# Phase 2 Implementation Plan — Frozen Handoff

> **COMPLETED / HISTORICAL — DO NOT EXECUTE AS A CURRENT RUNBOOK.** Production
> P9 promotion, PostgreSQL bootstrap, six migrations, backups, Backend cutover,
> and source closure completed on 2026-08-17/18. The current Mobile contract is
> `01-MOBILE-BACKEND-API-CONTRACT.md`; production uses `127.0.0.1:3000`, not
> candidate port `3010`.

**Frozen:** 2026-08-11
**Applies after:** Phase 1 documentation commit
**Phase 1 rule:** This plan is documentation only. It authorizes no deployment, runtime change, or production migration.

## Phase 2.5 execution addendum — 2026-08-13

The frozen handoff below describes the entry baseline and remains historical.
Phase 2.5 has now completed candidate-only deployment and acceptance: the
additive migration is applied to the isolated review PostgreSQL, the candidate
Backend is healthy on `127.0.0.1:3010`, and the core acceptance gate passed.
The historical paragraph above records its original checkpoint. Production P9
promotion is now complete; active production facts are in
`05-IMPLEMENTATION-STATUS.md` and the production runtime-definition runbook.

## Baseline Phase 2 must preserve

- Production serves the verified physical-device voice path: device WSS `/ws`, whole raw WAV by HTTP, MP3 by HTTP.
- P9.1 auth, pairing, device, and settings source exists at the Phase 1 base SHA and runs in a private candidate stack; it is not exposed by production.
- PostgreSQL 16 is private to the candidate Compose network and has the two P9.1 migrations applied.
- Hermes and Audio Service remain loopback-only dependencies of the Backend API service.
- Mobile realtime uses a separate `/api/v1/ws` contract. It must never be multiplexed onto device `/ws`.
- Every device-protocol addition remains `PENDING_PHYSICAL_ESP` until physical evidence exists.

## Entry gates

1. Start from the Phase 1 final docs commit and confirm no post-freeze route/schema/runtime drift.
2. Close the `*:5555` Prisma Studio exposure and record listener/firewall evidence. This is a `BLOCKED` security gate, not application scope.
3. Confirm the production deployment authorization, maintenance window, backup, rollback, and secrets are available before any live change.
4. Keep production migration execution and deployment as explicit later gates; they are not implied by this plan.

## Ordered implementation slices

### Slice 1 — production integration of the existing P9.1 foundation

- Integrate the existing P9.1 router into the production Backend API process.
- Preserve the current device `/ws`, `/api/v1/voice`, and `/audio/:audioId.mp3` behavior.
- Correct proxy-aware rate-limit configuration for the Caddy topology.
- Prove login/session, six-digit pairing, device/settings, and voice regressions in a candidate environment before public activation.

### Slice 2 — additive data foundation

Create reviewed, additive Prisma migrations for profile/DOB recovery, personalization, chat, memory, schedules, Wi-Fi configuration, telemetry, logs, proactive deliveries, integrations, Spotify, WhatsApp metadata, and bug reports. Do not delete or reinterpret existing P9.1 records. Separate schema creation from production migration execution.

### Slice 3 — mobile account and profile

Implement self-service registration, DOB-based password recovery with abuse controls, username/profile/avatar, personalization, and session-management completion. Keep credentials and provider tokens server-side.

Source checkpoint 2026-08-11: the account/profile/recovery/avatar and
personalization portion is `EXISTING_VERIFIED` in source and automated tests.
Phase 2.5 additionally verified the private candidate; public activation
remains separately gated.

### Slice 4 — identity bridge and mobile realtime

- Resolve a physical connection to an active Prisma `Device` only when `Device.hardwareId == device_id` and `Device.tokenHash == SHA-256(device_token)`.
- Preserve voice for a valid legacy runtime credential even if no Prisma row binds; deny owner-specific features when unbound.
- Add authenticated mobile `/api/v1/ws` as a distinct contract with replay/reconnect behavior.

### Slice 5 — chat, memory, and scheduler

Implement durable chat/history/idempotency, Hermes invocation, memory lifecycle, schedule/run/delivery state, and generic proactive-delivery queue. A backend queue result is not physical playback proof.

Source checkpoint 2026-08-12: the chat/history/idempotency and internal Hermes
orchestration portion is `EXISTING_VERIFIED` in source and automated tests.
Phase 2.5 additionally verified candidate chat/Hermes persistence and schedule
expiry behavior; public production was not changed.

### Slice 6 — device configuration plane

Implement DB/API ownership for Wi-Fi configuration, telemetry/RSSI, device logs, and device settings. Additive device events are defined in `02-BACKEND-DEVICE-ADDITIVE-CONTRACT.md`; physical handlers and acceptance remain `PENDING_PHYSICAL_ESP`.

### Slice 7 — integrations and support

Implement plugin catalog, the personal-account WhatsApp transport adapter,
Spotify server-side OAuth/actions, and bug reports. WhatsApp uses the unchanged
official Hermes bridge as private transport for the user's personal account;
the official `bot` mode is transport semantics only. `WHATSAPP_ENABLED` stays
false; Backend is the sole queue consumer and owns the conversation index,
notification rules, group classification, ownership, and untrusted-message
handling. A separate loopback Hermes identity resolver may read only the
provider's LID mapping files so phone/LID equivalence is available without
giving Backend session access. Live WhatsApp and Spotify acceptance stays
blocked until provider session/credentials are proven.

### Slice 8 — gated rollout

Run unit/integration/contract/security tests, apply migrations first to an isolated candidate, capture rollback evidence, then use a separately authorized canary/production rollout. Update status and coverage docs in the same commit as each implementation slice.

## Required verification at every slice

- Compare registered routes to the endpoint matrix.
- Compare Prisma schema/migrations to the schema requirements.
- Re-run device `/ws` and raw-WAV/MP3 regression tests.
- Check public/private binding and Caddy exposure.
- Do not promote `PENDING_PHYSICAL_ESP` without a real ESP test record.

## Exact starting point

Phase 2 begins with **Slice 1 preflight and the Prisma Studio security gate**, on the Phase 1 docs commit. It does not begin by creating a second backend, changing `/ws`, running a production migration, or deploying all integration features at once.
