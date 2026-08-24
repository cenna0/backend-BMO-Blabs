# Mobile / P9 Implementation Status

> **CURRENT / CANONICAL**
> This is the current implementation/runtime status; historical phase labels do
> not override it.

**Audited:** 2026-08-20
**Deployed-image source revision:**
`d1473d04f4b76ccb52cc8eeaff52a268504310f0` (immutable provenance, not current
Git HEAD).
**Production state:** `PRODUCTION_VERIFIED` — P9 Backend and PostgreSQL are live.
**Production image:** `bmo-p9.1:pairing-code-only-d1473d0`.
**Production status for code-only enrollment:** `PRODUCTION_VERIFIED`.
**Migration #7:** `20260818110000_pairing_code_only_enrollment` is applied in production; state is `7 completed, 0 unfinished, 0 rolled_back`.
**Production verification:** Direct/public health, Mobile REST/WS smoke, pairing
route absence checks, voice/integration continuity, and six soak samples passed.
**Physical status:** `PENDING_PHYSICAL_ESP`.

This document separates implementation from production verification. A route
can be implemented and promoted while a provider action, physical device
behavior, or complete acceptance suite remains blocked.

## Status vocabulary

| Status | Meaning |
|---|---|
| `PRODUCTION_VERIFIED` | The promoted production image contains the route/runtime and the production definition is live. It is not a claim that every provider or physical flow has been exercised. |
| `IMPLEMENTED` | Source and relevant tests implement the behavior; production exposure is not claimed. |
| `PARTIALLY_IMPLEMENTED` | A defined subset is implemented; the remaining subset is named. |
| `NOT_IMPLEMENTED` | No registered implementation exists. |
| `OUT_OF_SCOPE` | Intentionally not a Mobile feature in this release. |
| `BLOCKED` | An external/provider/operator gate prevents the behavior. |
| `PENDING_PHYSICAL_ESP` | Backend support exists or is defined, but firmware and real-device evidence are required. |

## Runtime and schema

| Area | Implementation | Production verification |
|---|---|---|
| P9 Backend runtime | `PRODUCTION_VERIFIED` | `bmo-production-p9-backend-1`, frozen image digest, loopback `127.0.0.1:3000`, healthy. |
| PostgreSQL | `PRODUCTION_VERIFIED` | Private `bmo-production-p9-postgres-1`, persistent `/opt/bmo/data/postgres`, healthy, no public port. |
| Prisma schema | `PRODUCTION_VERIFIED` | Exactly seven finished migrations are applied in production; migration #7 adds HardwareEnrollment and active pairing/device uniqueness boundaries. |
| Production callback | `PRODUCTION_VERIFIED` | `https://api.personalbmo.web.id/api/v1/integrations/spotify/callback` is provider-registered and configured. |
| Caddy routing | `PRODUCTION_VERIFIED` | Existing public route terminates TLS and proxies to `127.0.0.1:3000`; no candidate `3010` patch is used. |

Production migrations, in order:

```text
20260804110000_p9_1_foundation
20260804123000_p9_1_integrity_constraints
20260811190000_phase2_application_foundation
20260814120000_whatsapp_conversations
20260814210000_whatsapp_identity_aliases
20260815120000_spotify_phase26_lifecycle
20260818110000_pairing_code_only_enrollment
```

The seven migrations above are the completed production migration history.
Migration #7 is additive and is covered by the preserved rollback image and
fresh encrypted backup checkpoint.

## Mobile API implementation

| Area | Status | Notes |
|---|---|---|
| Registration/login/session refresh/logout/logout-all/me | `PRODUCTION_VERIFIED` | Bearer access tokens, opaque rotating refresh tokens, active-session checks, and safe user projection are registered in the promoted runtime. |
| DOB password recovery | `PRODUCTION_VERIFIED` | Two-step opaque single-use recovery token flow with rate limits and session revocation. |
| Profile and avatar | `PRODUCTION_VERIFIED` | Strict profile patch, opaque UUID WebP avatar path, bounded multipart admission, persistent production storage. |
| User settings | `PRODUCTION_VERIFIED` | Language, response length, automatic memory candidates, server-fixed `Asia/Jakarta` timezone. |
| Personalization | `PRODUCTION_VERIFIED` | Seven bounded user-level fields; persistence is implemented. |
| Six-digit pairing | `PRODUCTION_VERIFIED` | Backend creates durable HardwareEnrollment rows from authenticated unbound hardware, sends pairing codes over hardware `/ws`, accepts code-only Mobile claims, copies the trusted token digest into Device, enforces TTL/replacement/concurrency/rate limits, and sends pairing completion. Physical firmware support and real-device acceptance remain `PENDING_PHYSICAL_ESP`. No robot QR pairing. |
| Devices and settings | `PRODUCTION_VERIFIED` | List/detail/unpair, both registered device-settings PATCH aliases, user/device settings, ownership enforcement. |
| Device status route | `NOT_IMPLEMENTED` | `/api/v1/devices/:deviceId/status` is not registered. Status is represented by Mobile WS events when produced. |
| Wi-Fi API | `PRODUCTION_VERIFIED` | Encrypted server-side desired state and bounded metadata projection; physical apply remains pending. |
| Device logs/telemetry API | `PRODUCTION_VERIFIED` | Sanitized, owner-scoped reads and Backend ingestion boundaries are implemented. Physical emission remains pending. |
| Chat sessions/history/feedback | `PRODUCTION_VERIFIED` | REST history is authoritative; message submission is durable and returns `202`. |
| Mobile `/api/v1/ws` | `PRODUCTION_VERIFIED` | Separate bearer-authenticated event stream with timeout, expiry, heartbeat, and reconnect contract. Five application events have direct current emitters; five additional outbound events are schema-defined with no current direct emitter. |
| Memory records/candidates/summary | `PRODUCTION_VERIFIED` | Owner-scoped CRUD, idempotent actions, export/forget/clear, and explicitly `not_configured` summary generation boundary. |
| Schedules/runs | `PRODUCTION_VERIFIED` | CRUD and lifecycle routes with optimistic `version`, fixed `Asia/Jakarta` timezone, and Mobile/DEVICE delivery targets. |
| WhatsApp application boundary | `PRODUCTION_VERIFIED` | Backend routes, safe BMO conversation projections, rules, preview/confirm, and internal bridge/resolver boundaries are deployed. Provider traffic acceptance remains separately controlled. |
| Spotify application boundary | `PRODUCTION_VERIFIED` | OAuth callback/configuration, server-side credential lifecycle, safe search/device/playback/action projections are deployed. Mobile completes the browser callback by polling REST status; no Mobile deep-link or WebSocket completion event is implemented. No provider token is exposed. |
| Plugin catalog | `PRODUCTION_VERIFIED` | Safe WhatsApp/Spotify application catalog is registered. |
| Bug reports | `PRODUCTION_VERIFIED` | Authenticated bounded multipart contract is registered. |
| Mobile voice preview | `NOT_IMPLEMENTED` | No `/api/v1/voice/preview` route exists. |

## Provider and physical status

| Area | Status | Remaining boundary |
|---|---|---|
| Hermes | `PRODUCTION_VERIFIED` | Existing loopback service remains internal; Mobile never calls it. |
| Audio Service | `PRODUCTION_VERIFIED` | Existing loopback service remains internal; Mobile never calls it. |
| WhatsApp bridge | `PRODUCTION_VERIFIED` | Existing loopback transport is healthy; Mobile sees only Backend projections. Do not consume `/messages` from Mobile. |
| WhatsApp identity resolver | `PRODUCTION_VERIFIED` | Existing loopback resolver is healthy; Mobile never calls it. |
| WhatsApp live send/inbound acceptance | `BLOCKED` | Requires a separately authorized, non-destructive provider test. No Mobile contract change is needed. |
| Spotify provider session/actions | `BLOCKED` | Provider account/OAuth/action acceptance is not part of this documentation sync. The production redirect is registered and the server-side boundary is implemented. |
| Existing device `/ws` voice | `PRODUCTION_VERIFIED` | Promoted Backend preserves the legacy voice route and dependency path. |
| Additive ESP Wi-Fi/log/telemetry/settings behavior | `PENDING_PHYSICAL_ESP` | Requires firmware build and real-device evidence; source/tests alone cannot promote this status. Current source defines no proactive hardware event family. |

## Production verification boundaries

- Public API: `https://api.personalbmo.web.id`.
- Mobile WS: `wss://api.personalbmo.web.id/api/v1/ws`.
- Hardware WS: `wss://api.personalbmo.web.id/ws`.
- `/livez` and `/readyz` are internal health routes; the public `/health` route is the public smoke endpoint.
- Audio source has migrated to the Piper-only contract; candidate promotion is
  currently blocked by the host memory gate and the prior production image is
  retained for rollback.
- No candidate project, candidate port `3010`, candidate callback, or `/tmp/bmo-p9-1-validation-*` path is part of production.
- Code-only enrollment is deployed and migration #7 is applied. Do not rerun
  production migrations as Mobile integration work; physical firmware
  acceptance remains `PENDING_PHYSICAL_ESP`.
- `integration_status`, `device_status`, `voice_processing_status`, `wifi_configuration_status`, and `notification` are schema-defined outbound events with no direct current `sendToUser` emitter; Mobile must use REST state/fallbacks and must not require those events.
- `chat_thinking`, `chat_message`, `proactive_delivery_status`, `schedule_status`, and `whatsapp_notification` have direct current runtime emitters.
- Spotify OAuth has no application deep-link callback in the current source: Mobile opens `authorizationUrl`, the browser receives the Backend callback, and Mobile polls `/integrations/spotify/status` after returning to the app.

## Tests and evidence

Source-derived route/event coverage is maintained in
`09-ENDPOINT-EVENT-COVERAGE-MATRIX.md`. The relevant source tests cover auth,
profile/avatar, pairing/devices, Mobile WebSocket auth and events, chat,
memory, schedules, WhatsApp/Spotify boundaries, packaging, Prisma validation,
and typechecking. Provider and physical acceptance are intentionally separate
from documentation status.

## Next documentation rule

Any future Mobile route/event implementation must update, in the same source
change, at minimum:

```text
01-MOBILE-BACKEND-API-CONTRACT.md
05-IMPLEMENTATION-STATUS.md
09-ENDPOINT-EVENT-COVERAGE-MATRIX.md
```

Tests and registered source routes are the validation basis. Do not describe a
proposed route or event as implemented.
