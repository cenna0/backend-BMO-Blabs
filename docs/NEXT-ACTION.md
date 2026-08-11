# BMO — Next Execution Action

**Last updated:** 2026-08-11
**Current integration action:** Phase 2 Slice 2 additive schema and account/profile implementation on `feat/vps-mobile-device-integration`.
**Starting point:** Prisma Studio is closed. Slice 1 integrates the P9.1 router, proxy trust, optional owned session-device identity, and physical application binding in the full Backend source/review packaging while preserving device voice. Public deployment and live candidate recreation remain gated.

Read [`integration/00-START-HERE.md`](integration/00-START-HERE.md) and [`integration/04-VPS-IMPLEMENTATION-PLAN.md`](integration/04-VPS-IMPLEMENTATION-PLAN.md). Do not run a production migration, deploy, configure external credentials, or claim physical ESP behavior from this documentation freeze.

## Current checkpoint

- Source base at audit: `main` / `d638b20c381c676136c94524a38a1def5d70e565`; P9.1 source is already present there.
- Production voice Backend/Audio/Hermes integration remains verified; production Hermes integration uses the P6 host runtime. The private origins only boundary is Backend `127.0.0.1:3000`, Audio `127.0.0.1:8001`, and Hermes `127.0.0.1:8642`.
- P7 is `VERIFIED — PRODUCTION`; P8 is `P8_PIPER_PRODUCTION_VERIFIED`; real RVC inference is not verified.
- P9.1 auth/pairing/device/settings/PostgreSQL is source/private-candidate verified, not public-production enabled.
- All new integration surfaces are classified in `integration/05-IMPLEMENTATION-STATUS.md`; all routes/events are in `integration/09-ENDPOINT-EVENT-COVERAGE-MATRIX.md`.
- Physical ESP32 integration is not verified.

## Exact Phase 2 first slice

1. Check out the final Phase 1 documentation commit.
2. Confirm route/schema/runtime drift and production provenance.
3. Preserve the recorded Prisma Studio remediation; obtain privileged UFW/nft output later for final topology sign-off without reopening the listener.
4. Add tests around the existing P9.1 integration point and device voice regression.
5. Integrate the existing P9.1 router into the production-shaped candidate service; do not create a parallel business API.
6. Update status/matrix with the implementation commit. Production activation remains separately gated.

Do not execute P10 or promote `PENDING_PHYSICAL_ESP` without real firmware/bench evidence. P8 completion does **not** authorize P9 deployment; the user's Phase 2 authorization must still be scoped to implementation versus production execution. An operator may later say `execute P9` only with the frozen plan and explicit runtime gates.

## Verifier-locked predecessor declaration

The legacy voice-phase verifier still requires the following predecessor declaration. It is retained as a historical control record and is not the current integration starting point:

Legacy Current next phase: P9.1 — PostgreSQL, auth, pairing, and settings foundation

**Phase state:** `P8_PIPER_PRODUCTION_VERIFIED; P9.1 ARCHITECTURE LOCKED; isolated P9.1 candidate implemented; production activation not authorized`

The Phase 1 freeze supersedes the action implied by that legacy label, not its historical truth.
