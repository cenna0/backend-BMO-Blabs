# BMO — Next Execution Action

**Last updated:** 2026-08-11
**Current integration action:** Review the completed Phase 2 Slice 5A chat/history/idempotency and internal Hermes orchestration source boundary on `feat/vps-mobile-device-integration`, then implement the separate memory lifecycle slice.
**Starting point:** Slice 5A registers and tests the six chat REST surfaces against the Slice 2A schema and emits the existing mobile completion events. Migration `20260811190000_phase2_application_foundation` is still unapplied to the running private candidate and production. Public deployment and live candidate recreation remain gated.

Read [`integration/00-START-HERE.md`](integration/00-START-HERE.md) and [`integration/04-VPS-IMPLEMENTATION-PLAN.md`](integration/04-VPS-IMPLEMENTATION-PLAN.md). Do not run a production migration, deploy, configure external credentials, or claim physical ESP behavior from this documentation freeze.

## Current checkpoint

- Source base at audit: `main` / `d638b20c381c676136c94524a38a1def5d70e565`; P9.1 source is already present there.
- Production voice Backend/Audio/Hermes integration remains verified; production Hermes integration uses the P6 host runtime. The private origins only boundary is Backend `127.0.0.1:3000`, Audio `127.0.0.1:8001`, and Hermes `127.0.0.1:8642`.
- P7 is `VERIFIED — PRODUCTION`; P8 is `P8_PIPER_PRODUCTION_VERIFIED`; real RVC inference is not verified.
- P9.1 auth/pairing/device/settings/PostgreSQL is source/private-candidate verified, not public-production enabled.
- Phase 2 application storage is source-verified: 27 additive models, three total source migrations, no destructive Slice 2A SQL, and no migration execution against candidate/production.
- Slice 2B account/profile/recovery/avatar and personalization routes are source/test verified, including per-user session/reset serialization, atomic avatar publication/reconciliation, and exact bare personalization bodies. Persistent avatar mounts are declared in production-shaped Compose only; no host directory, candidate, or deployment was created.
- Slice 5A chat is source/test verified: bearer-owned sessions/history/feedback, durable 202/idempotency operations, bounded restart-aware Hermes work, server-built personalization plus explicit empty-memory context, per-user/session Hermes isolation, and `chat_thinking`/`chat_message` fanout. `speakOnDevice:true` remains unavailable until generic proactive delivery exists.
- All new integration surfaces are classified in `integration/05-IMPLEMENTATION-STATUS.md`; all routes/events are in `integration/09-ENDPOINT-EVENT-COVERAGE-MATRIX.md`.
- Physical ESP32 integration is not verified.

## Exact next source slice

1. Keep the Slice 2A migration unapplied until a separately authorized disposable/candidate migration review.
2. Review Slice 5A source evidence without recreating the private candidate or applying migrations.
3. Implement memory lifecycle behind the existing explicit empty chat-context gateway, followed by schedules and generic proactive delivery.
4. Preserve all account recovery, six-digit pairing, device `/ws`, whole-WAV/MP3, voice/Hermes/audio, ownership, and proxy-aware limiter regressions.
5. Repeat Node 22 tests/typecheck/build/Prisma/docs verification for that slice. Runtime migration, candidate recreation, public activation, and physical claims remain separate gates.

Do not execute P10 or promote `PENDING_PHYSICAL_ESP` without real firmware/bench evidence. P8 completion does **not** authorize P9 deployment; the user's Phase 2 authorization must still be scoped to implementation versus production execution. An operator may later say `execute P9` only with the frozen plan and explicit runtime gates.

## Verifier-locked predecessor declaration

The legacy voice-phase verifier still requires the following predecessor declaration. It is retained as a historical control record and is not the current integration starting point:

Legacy Current next phase: P9.1 — PostgreSQL, auth, pairing, and settings foundation

**Phase state:** `P8_PIPER_PRODUCTION_VERIFIED; P9.1 ARCHITECTURE LOCKED; isolated P9.1 candidate implemented; production activation not authorized`

The Phase 1 freeze supersedes the action implied by that legacy label, not its historical truth.
