> **HISTORICAL ONLY — DO NOT IMPLEMENT**
> This document records an earlier Joy checkpoint. Current production authority is `docs/README.md`, `docs/NEXT-ACTION.md`, `docs/backend-mvp/CURRENT-RUNTIME-CONFIG.md`, and `docs/operations/2026-08-24-piper-only-purge-evidence.md`.

# Joy by BLABS — Integration PRD v1.4.0

> **HISTORICAL PRODUCT SNAPSHOT — NOT RUNTIME AUTHORITY**
> This version is frozen at its 2026-08-11 product checkpoint. Freeze-time
> `READY_TO_IMPLEMENT`, candidate, and deployment wording below is historical
> and must not override current source or the canonical integration package.
> Backend code-only pairing is now production-deployed; physical ESP pairing
> remains `PENDING_PHYSICAL_ESP`. Start at `docs/README.md`.

**Status:** Canonical integration requirement freeze
**Date:** 2026-08-11
**Supersedes for current integration scope:** v1.2.4, which remains a locked historical product baseline.

## Product objective

Joy combines an existing physical voice device with a mobile account, durable personal data, device management, chat/memory/schedules, and controlled WhatsApp/Spotify capabilities. The VPS platform is the Backend: Caddy, Backend API service, PostgreSQL, Hermes, Audio Service, deployment/networking, secrets, and observability.

## Existing user value to preserve

- Physical Joy authenticates over WSS `/ws`.
- It uploads a complete raw WAV by HTTP and downloads generated MP3 by HTTP.
- The Backend uses Hermes for reasoning and Audio Service for STT/TTS.
- Six-digit pairing semantics remain the ownership bootstrap.

## Approved release scope

- Self-service email/password registration with required DOB; DOB-based two-step password recovery with a short single-use token and strong abuse controls.
- Profile display name, unique username, avatar, and personalization.
- Existing pairing, device list/detail/unpair, user/device settings, and deterministic physical identity binding.
- Remote Wi-Fi desired state stored encrypted in VPS PostgreSQL and applied by ESP with receipt/result.
- Mobile chat sessions/history, idempotent send, and separate authenticated realtime WSS `/api/v1/ws`.
- Curated, user-controlled memory; schedules/runs; generic proactive speech delivery.
- WhatsApp connection/rules/confirm-send boundary with Hermes-owned session.
- Spotify server-side OAuth, normalized playback/actions, and server-held encrypted tokens.
- Plugin catalog containing WhatsApp and Spotify only.
- Bug reports, bounded device logs, current telemetry/RSSI, nullable battery, and device settings sync.

## Product and ownership rules

- Mobile calls only the Backend API.
- Backend owns auth, policy, durable workflows, provider actions, delivery, and audit.
- PostgreSQL is Joy durable truth; Hermes is reasoning plus the WhatsApp session boundary; Audio Service is transient media processing; ESP owns local application/playback.
- Chat history is not automatic memory. Schedules are not memory. Ordinary WhatsApp content is not automatically copied into either.
- Provider secrets, Wi-Fi passwords, DOB, recovery tokens, and raw session bytes never appear in safe user payloads, logs, chat, memory, or Git.

## Status at freeze

Existing production is voice-only plus its private Hermes/Audio dependencies. Existing P9.1 source/private candidate covers invitation auth, sessions, six-digit pairing, devices/settings, and an 11-model Prisma foundation. It is not public production. All newly approved surfaces are `READY_TO_IMPLEMENT`, `PENDING_PHYSICAL_ESP`, `BLOCKED`, or `DEFERRED` exactly as listed in the integration status/matrix.

## Acceptance

- Registered routes/events match the canonical matrix.
- Target schema is delivered through reviewed additive migrations and survives isolated backup/restore before production execution.
- Existing device voice contract remains regression-green.
- Mobile and device WebSockets remain separate and tenant-safe.
- External side effects are confirmed/idempotent/audited; secrets are encrypted/redacted.
- Public/private topology is proven at Caddy, listener, container/network, and firewall layers.
- No physical feature is accepted without real ESP evidence.

Voice preview is `DEFERRED`. Custom voices/RVC, direct mobile/provider/DB access, WebSocket audio streaming, and automatic ingestion of all conversations into memory are out of scope.
