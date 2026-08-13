# Endpoint and Event Coverage Matrix

**Frozen:** 2026-08-11
**Rule:** Status uses `08-DOCS-MAINTENANCE-PROTOCOL.md`; availability is independent from implementation status.

Slice 2A adds the durable source schema behind the target routes below.
Subsequent Phase 2 source slices register the application routes and event
boundaries described in this matrix. Migration
`20260811190000_phase2_application_foundation` is source-verified only and has
not been applied to the running candidate or production.

Slice 2B registers the account/profile/recovery/avatar and personalization
surfaces in source and verifies them with automated route/service/storage
tests, including serialized recovery epochs and fair deadline-bounded avatar
multipart and image-processing admission. The running private candidate was not recreated
and still has only the two P9.1 migrations; public production remains
unchanged.

Slice 5A registers the six frozen chat REST routes in the production-shaped
source runtime and supplies the existing typed mobile chat event producers.
It is source/test verified only: the running candidate was not migrated or
recreated, Caddy/public routing was not changed, and physical proactive speech
remains pending the generic delivery slice and ESP evidence.

The memory slice registers all 15 frozen memory/settings/summary routes and
injects bounded active owner memory into chat. It is source/test verified only;
the running candidate and public production were not migrated or recreated.

The device additions slice registers owner-scoped Wi-Fi metadata/configuration,
device log, and telemetry routes in the production-shaped source runtime. Wi-Fi
passwords use protected AES-256-GCM configuration and never appear in read
responses or logs. Existing voice events remain unchanged; additive device
events and physical behavior remain `PENDING_PHYSICAL_ESP`.

Scheduler/proactive, device additions, and provider/support slices are source/test
verified only. No candidate or public production migration, recreation, or
activation occurred.

## Runtime and existing voice surfaces

| Method/surface | Path/event | Status | Availability / evidence |
|---|---|---|---|
| GET | `/health` | `EXISTING_VERIFIED` | Public production 200; integrated source returns sanitized `database: error`/503 when enabled P9 DB health or migrations are not ready |
| GET | `/livez` | `EXISTING_VERIFIED` | Backend loopback 200; Caddy deliberately returns public 404 |
| GET | `/readyz` | `EXISTING_VERIFIED` | Backend loopback; P9-enabled source includes DB health/migration readiness; Caddy deliberately returns public 404 |
| POST | `/api/v1/voice` | `EXISTING_VERIFIED` | Production device-authenticated whole raw-WAV upload |
| GET | `/audio/:fileName` | `EXISTING_VERIFIED` | Canonical client form `/audio/:audioId.mp3`; production MP3 delivery |
| WSS | `/ws` | `EXISTING_VERIFIED` | Production physical-device contract; not mobile realtime |
| GET | `/api/v1/ops/db/livez` | `EXISTING_VERIFIED` | Private candidate only (`includeOps=true`) |
| GET | `/api/v1/ops/db/readyz` | `EXISTING_VERIFIED` | Private candidate only |
| GET | `/api/v1/ops/db/migrations` | `EXISTING_VERIFIED` | Private candidate only; sanitized migration state |
| TCP exposure | `*:5555` | `EXISTING_VERIFIED` | Phase 2 remediation: manual Prisma Studio stopped; no listener, Docker publication, or Caddy route. Firewall rules unreadable without passworded sudo. |

## Auth, profile, and settings

Existing P9.1 rows below are source- and private-candidate-verified. Slice 1 also
packages them with the full Backend voice runtime in a production-shaped review
candidate, but public production still returns 404 because it has not been
deployed or enabled there.

| Method | Path | Status | Availability / gap |
|---|---|---|---|
| POST | `/api/v1/auth/register` | `EXISTING_VERIFIED` | Slice 2B source/tests: self-service email/password/DOB; optional invitation compatibility only. Running private candidate remains invitation-era and public production unchanged |
| POST | `/api/v1/auth/login` | `EXISTING_VERIFIED` | Private candidate + Slice 2B source tests; every valid normalized email uses discovery, one transaction, real-or-stable-dummy lock, authoritative lookup, and one Argon2 verify; registration-between-lookups re-locks/refetches the real user before issue |
| POST | `/api/v1/auth/refresh` | `EXISTING_VERIFIED` | Private candidate + source race tests; discover owner, lock, refetch, validate, then rotate with replay-family revocation |
| POST | `/api/v1/auth/logout` | `EXISTING_VERIFIED` | Private candidate |
| POST | `/api/v1/auth/logout-all` | `EXISTING_VERIFIED` | Private candidate |
| GET | `/api/v1/me` | `EXISTING_VERIFIED` | Private candidate legacy shape; Slice 2B source/tests return canonical username/avatar URL without DOB |
| POST | `/api/v1/auth/password/recovery/verify` | `EXISTING_VERIFIED` | Slice 2B source/tests; generic enumeration-safe failure, request-ID-bearing independent IP/email limits, Jakarta calendar boundary, per-user serialized replacement epochs using a post-lock DB clock, 600-second opaque token, and SHA-256 verifier only; not deployed |
| POST | `/api/v1/auth/password/recovery/reset` | `EXISTING_VERIFIED` | Slice 2B source/tests; per-user lock and post-lock DB clock precede refetch/atomic single use, sibling-epoch invalidation, Argon2id replacement, and transactional all-session/refresh revocation; not deployed |
| PATCH | `/api/v1/me/profile` | `EXISTING_VERIFIED` | Slice 2B source/tests; bearer-owned strict display-name/normalized-username patch and sanitized conflict |
| POST | `/api/v1/me/avatar` | `EXISTING_VERIFIED` | Slice 2B source/tests; independent user/IP limits, global 2-active/4-waiting admission before 5 MiB Multer buffering, one-owner/IP active/waiting fairness, bounded 30-second pre-parse receive deadline with sanitized 408, post-parse leases retained through processing despite disconnect, separate 2-active/4-waiting Sharp admission, 8 MP/4096 px/4:1/single-page decode bounds, WebP transcode, hardened runtime-owned storage, temp-plus-atomic-rename UUID publication, nonfatal old cleanup, and aged bounded paginated DB-rechecked orphan reconciliation |
| GET | `/media/avatars/:opaqueId.webp` | `EXISTING_VERIFIED` | Slice 2B source/tests; exact UUID WebP path, `image/webp`, `nosniff`, immutable cache, request context, and local sanitized errors; no directory listing |
| GET | `/api/v1/settings/user` | `EXISTING_VERIFIED` | Private candidate |
| PATCH | `/api/v1/settings/user` | `EXISTING_VERIFIED` | Private candidate |
| GET | `/api/v1/settings/personalization` | `EXISTING_VERIFIED` | Slice 2B exact-body source/tests; owner-scoped safe upsert returns the bare canonical seven-field object; Slice 5A consumes it in bounded server-built Hermes chat context |
| PATCH | `/api/v1/settings/personalization` | `EXISTING_VERIFIED` | Slice 2B exact-body source/tests; strict nonempty bounded canonical owner patch returns the bare seven-field object; Slice 5A consumes it in bounded server-built Hermes chat context |

## Pairing and devices

All four current pairing calls require a mobile bearer token. The ESP does not claim through `/ws`; the claim credential is supplied out-of-band.

| Method | Path | Status | Availability / gap |
|---|---|---|---|
| POST | `/api/v1/pairing/challenges` | `EXISTING_VERIFIED` | Private candidate; six digits, 600-second TTL, five attempts |
| GET | `/api/v1/pairing/:pairingId` | `EXISTING_VERIFIED` | Private candidate |
| POST | `/api/v1/pairing/:pairingId/claim` | `EXISTING_VERIFIED` | Private candidate; body includes code, hardwareId, deviceName, deviceCredential |
| POST | `/api/v1/pairing/:pairingId/revoke` | `EXISTING_VERIFIED` | Private candidate |
| GET | `/api/v1/devices` | `EXISTING_VERIFIED` | Private candidate |
| GET | `/api/v1/devices/:deviceId` | `EXISTING_VERIFIED` | Private candidate |
| PATCH | `/api/v1/devices/:deviceId/settings` | `EXISTING_VERIFIED` | Private candidate; DB-only settings route |
| POST | `/api/v1/devices/:deviceId/unpair` | `EXISTING_VERIFIED` | Private candidate |
| GET | `/api/v1/settings/devices/:deviceId` | `EXISTING_VERIFIED` | Private candidate; canonical settings read |
| PATCH | `/api/v1/settings/devices/:deviceId` | `EXISTING_VERIFIED` | Private candidate; canonical settings write |
| GET | `/api/v1/devices/:deviceId/status` | `READY_TO_IMPLEMENT` | Not registered |
| GET | `/api/v1/devices/:deviceId/wifi` | `EXISTING_VERIFIED` | Owner-scoped metadata only; plaintext/ciphertext never returned |
| PUT | `/api/v1/devices/:deviceId/wifi` | `EXISTING_VERIFIED` | Owner-scoped latest-write-wins AES-256-GCM desired state; physical apply pending |
| DELETE | `/api/v1/devices/:deviceId/wifi` | `EXISTING_VERIFIED` | Deletes Backend metadata only; does not factory-reset device |
| GET | `/api/v1/devices/:deviceId/logs` | `EXISTING_VERIFIED` | Owner-scoped bounded sanitized seven-day log read |
| GET | `/api/v1/devices/:deviceId/telemetry` | `EXISTING_VERIFIED` | Owner-scoped current RSSI/nullable battery read |

## Chat and mobile realtime

| Method/surface | Path/event | Status | Availability / gap |
|---|---|---|---|
| GET | `/api/v1/chat/sessions` | `EXISTING_VERIFIED` | Source/test tier; bearer-owner scope, bounded deterministic ordering; not candidate/public deployed |
| POST | `/api/v1/chat/sessions` | `EXISTING_VERIFIED` | Source/test tier; strict `{temporary}` and server-derived owner |
| GET | `/api/v1/chat/sessions/:sessionId/messages` | `EXISTING_VERIFIED` | Source/test tier; owned active session, positive signed-64-bit cursor, bounded stable ascending pagination |
| POST | `/api/v1/chat/sessions/:sessionId/messages` | `EXISTING_VERIFIED` | Source/test tier; durable 202 user message/operation, transactional per-user UUID idempotency and conflict rejection, globally bounded scheduling, PostgreSQL lower-cursor session ordering across runtimes, DB-clock lease renewal immediately before Hermes, claimable-session-head discovery before recovery `LIMIT`, non-blocking single-flight recovery with durable-claim progress/zero-progress deferral, and delete abort/persistence guard; `speakOnDevice:true` is explicitly unavailable until generic proactive delivery exists |
| DELETE | `/api/v1/chat/sessions/:sessionId` | `EXISTING_VERIFIED` | Source/test tier; owner-scoped soft deletion and cancellation of processing operations; no invented purge period |
| POST | `/api/v1/chat/messages/:messageId/feedback` | `EXISTING_VERIFIED` | Source/test tier; owner-scoped assistant-only bounded feedback upsert |
| WSS | `/api/v1/ws` | `EXISTING_VERIFIED` | Source/test tier; exact separate mobile upgrade path when P9 is enabled; candidate/public production unchanged |
| Mobile -> Backend | `authenticate` | `EXISTING_VERIFIED` | Source/test tier; strict `{event,accessToken}` within five seconds, no URL-query token or client identity |
| Backend -> Mobile | `authenticated` | `EXISTING_VERIFIED` | Source/test tier; verified token plus active server session supplies `userId`; expiry closes 4410 |
| Backend -> Mobile | `chat_thinking` | `EXISTING_VERIFIED` | Typed bounded schema plus Slice 5A best-effort per-user producer after durable acceptance; history remains recovery authority |
| Backend -> Mobile | `chat_message` | `EXISTING_VERIFIED` | Typed bounded schema plus Slice 5A per-user producer after sanitized assistant persistence; no token stream |
| Backend -> Mobile | `device_status` | `EXISTING_VERIFIED` | Typed nullable battery/RSSI schema + per-user fanout source/test; status producer remains `READY_TO_IMPLEMENT` |
| Backend -> Mobile | `voice_processing_status` | `EXISTING_VERIFIED` | Typed sanitized schema + per-user fanout source/test; no audio URL/stream; producer remains `READY_TO_IMPLEMENT` |
| Backend -> Mobile | `wifi_configuration_status` | `EXISTING_VERIFIED` | Typed bounded schema + per-user fanout source/test; device additive lifecycle remains physical pending |
| Backend -> Mobile | `proactive_delivery_status` | `EXISTING_VERIFIED` | Typed generic CHAT/SCHEDULE/WHATSAPP schema + per-user fanout and generic device-delivery lifecycle producer source/test; physical sender/playback remains `PENDING_PHYSICAL_ESP`; device-less MOBILE intents do not fabricate this device-scoped event |
| Backend -> Mobile | `schedule_status` | `EXISTING_VERIFIED` | Typed bounded schema + per-user schedule lifecycle/one-shot completion producer source/test; not candidate/public deployed |
| Backend -> Mobile | `integration_status` | `EXISTING_VERIFIED` | Typed WhatsApp/Spotify schema + per-user fanout source/test; adapter producers remain `READY_TO_IMPLEMENT`/externally blocked for live acceptance |
| Backend -> Mobile | `notification` | `EXISTING_VERIFIED` | Typed bounded GENERIC schema + per-user fanout source/test; feature producer remains `READY_TO_IMPLEMENT` |

## Memory and schedules

| Methods | Path family | Status | Availability / gap |
|---|---|---|---|
| GET/PATCH | `/api/v1/settings/memory` | `EXISTING_VERIFIED` | Source/test tier; exact `{automaticMemoryCandidates}` body and bearer-derived owner; not candidate/public deployed |
| GET | `/api/v1/memories`, `/api/v1/memories/:id` | `EXISTING_VERIFIED` | Source/test tier; deterministic opaque cursor, bounded pages, active/unexpired owner rows only |
| PATCH/DELETE | `/api/v1/memories/:id` | `EXISTING_VERIFIED` | Source/test tier; strict bounded patch, owner-safe soft delete, idempotent audited actions |
| GET | `/api/v1/memory-candidates` | `EXISTING_VERIFIED` | Source/test tier; bounded deterministic pending/unexpired owner candidates only |
| POST | `/api/v1/memory-candidates/:id/accept`, `.../reject` | `EXISTING_VERIFIED` | Source/test tier; transaction-locked owner scope and payload-aware idempotent replay/conflict behavior |
| POST | `/api/v1/memories/forget-topic`, `.../clear-all`, `.../export` | `EXISTING_VERIFIED` | Source/test tier; suppression includes pending candidates/summary as applicable; JSON export excludes deleted/expired memory and non-pending candidates |
| GET | `/api/v1/memory/summary` | `EXISTING_VERIFIED` | Source/test tier; active/unexpired owner summary or explicit null |
| POST | `/api/v1/memory/summary/regenerate`, `.../feedback` | `EXISTING_VERIFIED` | Source/test tier; durable `generating` boundary reports memory-record source and `not_configured` runtime; no invented Hermes summary provider |
| GET/POST | `/api/v1/schedules` | `EXISTING_VERIFIED` | Source/test; owner-derived strict create and deterministic bounded listing; not candidate/public deployed |
| GET/PATCH | `/api/v1/schedules/:id` | `EXISTING_VERIFIED` | Source/test; owner-safe lookup and required optimistic `version` conflict boundary |
| POST | `/api/v1/schedules/:id/pause`, `.../resume` | `EXISTING_VERIFIED` | Source/test; lifecycle transitions require the current positive version |
| DELETE | `/api/v1/schedules/:id` | `EXISTING_VERIFIED` | Source/test; durable CANCELLED transition, no silent purge |
| GET | `/api/v1/schedule-runs` | `EXISTING_VERIFIED` | Source/test; owner-scoped schedule filter and deterministic dueAt/id cursor |

## Integrations, plugins, and support

| Methods | Path | Status | Availability / gate |
|---|---|---|---|
| POST/GET | `/api/v1/integrations/whatsapp/connect`, `.../status` | `EXISTING_VERIFIED` | Source/test; owner-scoped metadata boundary; live provider `BLOCKED_EXTERNAL_SECRET` |
| GET/POST | `/api/v1/integrations/whatsapp/qr`, `.../confirm-scanned` | `EXISTING_VERIFIED` | Source/test; provider interaction fail-closed until exact Hermes boundary is proven |
| POST | `/api/v1/integrations/whatsapp/disconnect` | `EXISTING_VERIFIED` | Source/test; owner-scoped provider boundary |
| GET/PATCH | `/api/v1/integrations/whatsapp/notification-rules` | `EXISTING_VERIFIED` | Source/test; strict target shape and owner scope |
| POST | `/api/v1/integrations/whatsapp/send-preview`, `.../send-confirm` | `EXISTING_VERIFIED` | Source/test; bounded preview, five-minute confirmation, idempotency; live send blocked externally |
| POST | `/api/v1/integrations/spotify/connect` | `EXISTING_VERIFIED` | Source/test; server-side Authorization Code state route; live credentials/callback `BLOCKED_EXTERNAL_SECRET` |
| GET | `/api/v1/integrations/spotify/callback` | `EXISTING_VERIFIED` | Source/test; exact redirect and single-use state; tokens stay server-side |
| GET | `/api/v1/integrations/spotify/status` | `EXISTING_VERIFIED` | Source/test; normalized state only |
| POST | `/api/v1/integrations/spotify/disconnect` | `EXISTING_VERIFIED` | Source/test; owner-scoped credential removal |
| GET | `/api/v1/integrations/spotify/devices`, `.../playback` | `EXISTING_VERIFIED` | Source/test; normalized provider boundary; no active device result is safe |
| POST | `/api/v1/integrations/spotify/actions` | `EXISTING_VERIFIED` | Source/test; allowlisted action/idempotency/confirmation boundary; provider live blocked externally |
| GET | `/api/v1/plugins` | `EXISTING_VERIFIED` | Source/test; exactly WhatsApp + Spotify safe status catalog |
| POST | `/api/v1/support/bug-reports` | `EXISTING_VERIFIED` | Source/test; bounded authenticated multipart, max five images, opaque persistent keys |
| POST | `/api/v1/voice/preview` | `DEFERRED` | Not registered; last-priority optional surface |

## Existing device `/ws` events

| Direction | Event | Status | Evidence |
|---|---|---|---|
| ESP -> Backend | `authenticate` | `EXISTING_VERIFIED` | Config-based `DEVICE_ID`/`DEVICE_TOKEN`; 8 KiB max payload; source tests verify additive active hardware-ID/SHA-256 binding plus ACTIVE revalidation/clear before owner use without regressing legacy voice |
| Backend -> ESP | `authenticated` | `EXISTING_VERIFIED` | Current production source/runtime |
| Backend -> ESP | `authentication_failed` | `EXISTING_VERIFIED` | Current source |
| Backend -> ESP | `connection_replaced` | `EXISTING_VERIFIED` | One active connection per device |
| Backend -> ESP | `display_status` | `EXISTING_VERIFIED` | Current voice lifecycle |
| Backend -> ESP | `audio_ready` | `EXISTING_VERIFIED` | MP3 URL lifecycle |
| Backend -> ESP | `request_failed` | `EXISTING_VERIFIED` | Current error lifecycle |
| ESP -> Backend | `audio_playback_done` | `EXISTING_VERIFIED` | Current source |
| ESP -> Backend | `audio_playback_failed` | `EXISTING_VERIFIED` | Current source |

## Additive device `/ws` events

Every row below is unimplemented on the physical ESP at freeze time.

| Direction | Event | Status | Backend target / physical gate |
|---|---|---|---|
| Backend -> ESP | `wifi_configuration` | `PENDING_PHYSICAL_ESP` | Encrypted DB desired state; firmware apply required |
| ESP -> Backend | `wifi_configuration_received` | `PENDING_PHYSICAL_ESP` | Receipt only, not apply success |
| ESP -> Backend | `wifi_configuration_result` | `PENDING_PHYSICAL_ESP` | Physical reconnect/result required |
| ESP -> Backend | `device_log` | `PENDING_PHYSICAL_ESP` | Bounded/sanitized ingestion target |
| ESP -> Backend | `device_telemetry` | `PENDING_PHYSICAL_ESP` | RSSI/current state; battery nullable |
| Backend -> ESP | `device_settings` | `PENDING_PHYSICAL_ESP` | Initial physical field is playback volume |
| ESP -> Backend | `device_settings_applied` | `PENDING_PHYSICAL_ESP` | Physical application acknowledgement |
| Backend -> ESP | `proactive_audio_ready` | `PENDING_PHYSICAL_ESP` | Generic source-neutral playback request |
| ESP -> Backend | `proactive_playback_done` | `PENDING_PHYSICAL_ESP` | Physical completion proof |
| ESP -> Backend | `proactive_playback_failed` | `PENDING_PHYSICAL_ESP` | Physical failure proof |

No token-by-token LLM streaming or WebSocket audio streaming is in the frozen release. A new registered route/event must be added here in the same change or it is scope drift.
