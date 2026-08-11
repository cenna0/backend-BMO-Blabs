# BMO — Next Execution Action

**Last updated:** 2026-08-11
**Current integration action:** Phase 2 Slice 2B account/profile/recovery and personalization services on `feat/vps-mobile-device-integration`.
**Starting point:** Slice 2A adds the 38-model Prisma source schema, additive migration, migration manifest, and repository delegates. Migration `20260811190000_phase2_application_foundation` is source-verified only; it has not been applied to the running candidate or production. Public deployment and live candidate recreation remain gated.

Read [`integration/00-START-HERE.md`](integration/00-START-HERE.md) and [`integration/04-VPS-IMPLEMENTATION-PLAN.md`](integration/04-VPS-IMPLEMENTATION-PLAN.md). Do not run a production migration, deploy, configure external credentials, or claim physical ESP behavior from this documentation freeze.

## Current checkpoint

- Source base at audit: `main` / `d638b20c381c676136c94524a38a1def5d70e565`; P9.1 source is already present there.
- Production voice Backend/Audio/Hermes integration remains verified; production Hermes integration uses the P6 host runtime. The private origins only boundary is Backend `127.0.0.1:3000`, Audio `127.0.0.1:8001`, and Hermes `127.0.0.1:8642`.
- P7 is `VERIFIED — PRODUCTION`; P8 is `P8_PIPER_PRODUCTION_VERIFIED`; real RVC inference is not verified.
- P9.1 auth/pairing/device/settings/PostgreSQL is source/private-candidate verified, not public-production enabled.
- Phase 2 application storage is source-verified: 27 additive models, three total source migrations, no destructive Slice 2A SQL, and no migration execution against candidate/production.
- All new integration surfaces are classified in `integration/05-IMPLEMENTATION-STATUS.md`; all routes/events are in `integration/09-ENDPOINT-EVENT-COVERAGE-MATRIX.md`.
- Physical ESP32 integration is not verified.

## Exact next source slice

1. Keep the Slice 2A migration unapplied until a separately authorized disposable/candidate migration review.
2. Add test-first profile/recovery/personalization validation and service contracts.
3. Preserve existing P9.1 auth/session/pairing behavior and keep DOB out of `SafeUser`, logs, chat, memory, and normal profile responses.
4. Store only SHA-256 recovery verifiers; add atomic single-use, expiry, bounded attempt/rate-limit, enumeration-safe response, and audit behavior.
5. Implement profile/username/avatar metadata and personalization routes against repository delegates; do not expose encrypted or private fields.
6. Repeat Node 22 tests/typecheck/build/Prisma/docs verification. Runtime migration, candidate recreation, public activation, and physical claims remain separate gates.

Do not execute P10 or promote `PENDING_PHYSICAL_ESP` without real firmware/bench evidence. P8 completion does **not** authorize P9 deployment; the user's Phase 2 authorization must still be scoped to implementation versus production execution. An operator may later say `execute P9` only with the frozen plan and explicit runtime gates.

## Verifier-locked predecessor declaration

The legacy voice-phase verifier still requires the following predecessor declaration. It is retained as a historical control record and is not the current integration starting point:

Legacy Current next phase: P9.1 — PostgreSQL, auth, pairing, and settings foundation

**Phase state:** `P8_PIPER_PRODUCTION_VERIFIED; P9.1 ARCHITECTURE LOCKED; isolated P9.1 candidate implemented; production activation not authorized`

The Phase 1 freeze supersedes the action implied by that legacy label, not its historical truth.
