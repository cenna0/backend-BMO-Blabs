> **HISTORICAL ONLY — DO NOT IMPLEMENT**
> This document records an earlier BMO checkpoint. Current production authority is `docs/README.md`, `docs/NEXT-ACTION.md`, `docs/backend-mvp/CURRENT-RUNTIME-CONFIG.md`, and `docs/operations/2026-08-24-piper-only-purge-evidence.md`.

# P9 Product Scope — Integration Freeze

> **HISTORICAL FREEZE SNAPSHOT — NOT CURRENT STATUS OR API INSTRUCTIONS**
> Preserve the dated design below. Current authority is `docs/p9/README.md` and
> the canonical integration package.

**Status:** Phase 1 frozen; target features are not implementation claims.

## Existing verified baseline

- Production device voice contract: WSS `/ws`, raw whole-WAV upload, MP3 delivery, fixed runtime device credential.
- Backend -> Hermes `/v1/responses` and Backend -> Audio Service STT/TTS boundaries are active and private.
- P9.1 source/private candidate provides invitation registration, auth/session rotation, six-digit pairing, devices, settings, Prisma, and private PostgreSQL.
- Production does not register the P9.1 REST router, mobile realtime, or target integration routes.

## Approved target scope

1. Self-service email/password registration and DOB recovery with enumeration/replay/rate-limit controls.
2. Profile, unique username, avatar, and personalization.
3. Existing six-digit pairing, device APIs/settings, and deterministic physical-to-owner identity binding.
4. Wi-Fi desired-state configuration through PostgreSQL to ESP.
5. Mobile chat/history and separate realtime WSS `/api/v1/ws`.
6. Curated memory with explicit user lifecycle controls.
7. Schedules, worker/run/delivery records, and generic proactive audio.
8. WhatsApp policy/adapter with Hermes-owned session.
9. Spotify server-side OAuth/actions.
10. Plugin catalog limited initially to WhatsApp and Spotify.
11. Bug reports, device logs, telemetry/RSSI, and settings synchronization.

## Compatibility and non-goals

- Do not change the v1.0.5 physical voice transport.
- Do not stream LLM tokens or audio over mobile WSS in this release.
- Do not treat chat history, schedules, or provider conversations as automatic memory.
- Do not store raw WAV/MP3 as durable chat history.
- Do not expose PostgreSQL, Hermes, Audio Service, provider tokens, or Wi-Fi passwords publicly.
- Do not claim additive ESP behavior until physical evidence exists.
- Custom voice upload/cloning/RVC remains out of scope; voice preview is `DEFERRED`.
- Phase 1 runs no migration and deploys nothing.
