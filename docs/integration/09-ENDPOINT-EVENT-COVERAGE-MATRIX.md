# Endpoint and Event Coverage Matrix

**Frozen:** 2026-08-11
**Rule:** Status uses `08-DOCS-MAINTENANCE-PROTOCOL.md`; availability is independent from implementation status.

Slice 2A adds the durable source schema behind the target routes below.
Subsequent Phase 2 source slices register the application routes and event
boundaries described in this matrix. Migration
`20260811190000_phase2_application_foundation` is applied to the isolated
Phase 2.5 candidate only; it has not been applied to production.

## Phase 2.5 candidate acceptance evidence

The private candidate was recreated from
`adeebca58719db4386f62330026f6c3b46a91bbe`, an explicitly recorded protected-
secret startup fix on requested source `437e48a70227220d1a40ad539ff09b307ef0c1ea`.
Candidate Backend is `bmo-p9-1-backend-1` on `127.0.0.1:3010`, Node `22.23.1`,
with candidate PostgreSQL `bmo-p9-1-postgres-1` on a private network and no
published database port. Public Caddy and production Backend were unchanged.

The live candidate acceptance harness passed `42/42` assertions. It covered the
registered REST surfaces for self-service auth, DOB recovery, profile,
personalization, pairing, devices, Wi-Fi, chat/history/idempotency, memory,
schedules, plugin catalog, and provider boundaries, plus ownership isolation,
validation, and secret-safe projections. It also passed mobile `/api/v1/ws`
authentication/timeout/path isolation and physical `/ws` authentication plus
server-side telemetry/log ingestion with a synthetic bound device.

The Node 22 full suite passed 72 files and 401 tests, with one pre-existing
authenticated database HTTP test skipped. Candidate chat operations and Hermes
responses persisted, and the schedule worker recorded the expected expired
occurrence as `MISSED`. Candidate voice regression completed whole-WAV upload,
STT, Hermes, Piper, MP3 storage, `audio_ready`, and playback lifecycle through
the fake-device boundary. These are private candidate results, not production
availability or physical ESP evidence.

Slice 2B registers the account/profile/recovery/avatar and personalization
surfaces in source and verifies them with automated route/service/storage
tests, including serialized recovery epochs and fair deadline-bounded avatar
multipart and image-processing admission. The Phase 2.5 private candidate
acceptance additionally exercised the live auth/profile/personalization path;
public production remains unchanged.

Slice 5A registers the six frozen chat REST routes in the production-shaped
source runtime and supplies the existing typed mobile chat event producers.
The Phase 2.5 private candidate exercised chat submission, idempotency,
history, Hermes persistence, and the separate mobile WebSocket; Caddy/public
routing was not changed, and physical proactive speech remains pending the
generic delivery slice and ESP evidence.

The memory slice registers all 15 frozen memory/settings/summary routes and
injects bounded active owner memory into chat. The Phase 2.5 private candidate
exercised the owner-scoped memory/settings read path; public production remains
unchanged.

The device additions slice registers owner-scoped Wi-Fi metadata/configuration,
device log, and telemetry routes in the production-shaped source runtime. Wi-Fi
passwords use protected AES-256-GCM configuration and never appear in read
responses or logs. Existing voice events remain unchanged; additive device
events and physical behavior remain `PENDING_PHYSICAL_ESP`.

Scheduler/proactive, device additions, and provider/support slices have
candidate evidence where noted above and remain source/test verified for
surfaces not exercised by the live harness. No production migration, recreation,
or activation occurred. Spotify live actions remain
`BLOCKED_EXTERNAL_SECRET`; WhatsApp live runtime actions remain
`BLOCKED_OPERATOR`; physical additive events remain
`PENDING_PHYSICAL_ESP`.

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

Existing P9.1 rows below are source- and private-candidate-verified. The Phase
2.5 candidate packages them with the full Backend voice runtime; public
production remains unchanged and still returns 404 for routes not enabled there.

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
| GET | `/api/v1/chat/sessions` | `EXISTING_VERIFIED` | Private candidate plus source tests; bearer-owner scope and bounded deterministic ordering; public production unchanged |
| POST | `/api/v1/chat/sessions` | `EXISTING_VERIFIED` | Private candidate plus source tests; strict `{temporary}` and server-derived owner |
| GET | `/api/v1/chat/sessions/:sessionId/messages` | `EXISTING_VERIFIED` | Private candidate plus source tests; owned active session, positive signed-64-bit cursor, bounded stable ascending pagination |
| POST | `/api/v1/chat/sessions/:sessionId/messages` | `EXISTING_VERIFIED` | Private candidate plus source tests; durable 202 user message/operation, transactional per-user UUID idempotency and conflict rejection, bounded scheduling, DB-clock lease renewal before Hermes, and delete abort/persistence guard; `speakOnDevice:false` accepted live, while physical proactive delivery remains pending |
| DELETE | `/api/v1/chat/sessions/:sessionId` | `EXISTING_VERIFIED` | Source tests; owner-scoped soft deletion and cancellation of processing operations; no invented purge period |
| POST | `/api/v1/chat/messages/:messageId/feedback` | `EXISTING_VERIFIED` | Source tests; owner-scoped assistant-only bounded feedback upsert |
| WSS | `/api/v1/ws` | `EXISTING_VERIFIED` | Private candidate plus source tests; exact separate mobile upgrade path with authentication timeout and path isolation; public production unchanged |
| Mobile -> Backend | `authenticate` | `EXISTING_VERIFIED` | Source/test tier; strict `{event,accessToken}` within five seconds, no URL-query token or client identity |
| Backend -> Mobile | `authenticated` | `EXISTING_VERIFIED` | Source/test tier; verified token plus active server session supplies `userId`; expiry closes 4410 |
| Backend -> Mobile | `chat_thinking` | `EXISTING_VERIFIED` | Typed bounded schema plus Slice 5A best-effort per-user producer after durable acceptance; history remains recovery authority |
| Backend -> Mobile | `chat_message` | `EXISTING_VERIFIED` | Typed bounded schema plus Slice 5A per-user producer after sanitized assistant persistence; no token stream |
| Backend -> Mobile | `device_status` | `EXISTING_VERIFIED` | Typed nullable battery/RSSI schema + per-user fanout source/test; status producer remains `READY_TO_IMPLEMENT` |
| Backend -> Mobile | `voice_processing_status` | `EXISTING_VERIFIED` | Typed sanitized schema + per-user fanout source/test; no audio URL/stream; producer remains `READY_TO_IMPLEMENT` |
| Backend -> Mobile | `wifi_configuration_status` | `EXISTING_VERIFIED` | Typed bounded schema + per-user fanout source/test; device additive lifecycle remains physical pending |
| Backend -> Mobile | `proactive_delivery_status` | `EXISTING_VERIFIED` | Typed generic CHAT/SCHEDULE/WHATSAPP schema + per-user fanout and generic device-delivery lifecycle producer source/test; physical sender/playback remains `PENDING_PHYSICAL_ESP`; device-less MOBILE intents do not fabricate this device-scoped event |
| Backend -> Mobile | `schedule_status` | `EXISTING_VERIFIED` | Typed bounded schema + per-user schedule lifecycle/one-shot completion producer source/test; candidate worker expiry path accepted, public production unchanged |
| Backend -> Mobile | `integration_status` | `EXISTING_VERIFIED` | Typed WhatsApp/Spotify schema + per-user fanout source/test; WhatsApp bridge adapter/poller is source-verified while live session acceptance remains `BLOCKED_OPERATOR`; Spotify live credentials remain blocked |
| Backend -> Mobile | `whatsapp_notification` | `SOURCE_VERIFIED` | Metadata-only per-user event with BMO conversation UUID/display name/DM-GROUP classification; no body, phone, JID, session, or credential; live provider acceptance is candidate-gated |
| Backend -> Mobile | `notification` | `EXISTING_VERIFIED` | Typed bounded GENERIC schema for non-WhatsApp notifications; WhatsApp uses the dedicated metadata-only event above |

## Memory and schedules

| Methods | Path family | Status | Availability / gap |
|---|---|---|---|
| GET/PATCH | `/api/v1/settings/memory` | `EXISTING_VERIFIED` | Private candidate read plus source tests; exact `{automaticMemoryCandidates}` body and bearer-derived owner; public production unchanged |
| GET | `/api/v1/memories`, `/api/v1/memories/:id` | `EXISTING_VERIFIED` | Private candidate read plus source tests; deterministic opaque cursor, bounded pages, active/unexpired owner rows only |
| PATCH/DELETE | `/api/v1/memories/:id` | `EXISTING_VERIFIED` | Source/test tier; strict bounded patch, owner-safe soft delete, idempotent audited actions |
| GET | `/api/v1/memory-candidates` | `EXISTING_VERIFIED` | Source/test tier; bounded deterministic pending/unexpired owner candidates only |
| POST | `/api/v1/memory-candidates/:id/accept`, `.../reject` | `EXISTING_VERIFIED` | Source/test tier; transaction-locked owner scope and payload-aware idempotent replay/conflict behavior |
| POST | `/api/v1/memories/forget-topic`, `.../clear-all`, `.../export` | `EXISTING_VERIFIED` | Source/test tier; suppression includes pending candidates/summary as applicable; JSON export excludes deleted/expired memory and non-pending candidates |
| GET | `/api/v1/memory/summary` | `EXISTING_VERIFIED` | Source/test tier; active/unexpired owner summary or explicit null |
| POST | `/api/v1/memory/summary/regenerate`, `.../feedback` | `EXISTING_VERIFIED` | Source/test tier; durable `generating` boundary reports memory-record source and `not_configured` runtime; no invented Hermes summary provider |
| GET/POST | `/api/v1/schedules` | `EXISTING_VERIFIED` | Private candidate plus source tests; owner-derived strict create and deterministic bounded listing; public production unchanged |
| GET/PATCH | `/api/v1/schedules/:id` | `EXISTING_VERIFIED` | Private candidate plus source tests; owner-safe lookup and required optimistic `version` conflict boundary |
| POST | `/api/v1/schedules/:id/pause`, `.../resume` | `EXISTING_VERIFIED` | Source/test; lifecycle transitions require the current positive version |
| DELETE | `/api/v1/schedules/:id` | `EXISTING_VERIFIED` | Source/test; durable CANCELLED transition, no silent purge |
| GET | `/api/v1/schedule-runs` | `EXISTING_VERIFIED` | Source/test; owner-scoped schedule filter and deterministic dueAt/id cursor |

## Integrations, plugins, and support

| Methods | Path | Status | Availability / gate |
|---|---|---|---|
| GET/POST | `/api/v1/integrations/whatsapp/connect`, `.../status` | `CANDIDATE_VERIFIED` | Candidate-only authenticated smoke passed connection/status against the paired loopback bridge; mobile receives application status only, not bridge details |
| GET/POST | `/api/v1/integrations/whatsapp/qr`, `.../confirm-scanned` | `CANDIDATE_VERIFIED` | Operator-only setup surface; QR pairing completed outside mobile UI and the dedicated bridge is active |
| POST | `/api/v1/integrations/whatsapp/disconnect` | `SOURCE_VERIFIED` | Owner-scoped metadata/provider boundary; no live disconnect acceptance claimed |
| GET | `/api/v1/integrations/whatsapp/conversations`, `.../:id` | `CANDIDATE_VERIFIED` | Candidate-only authenticated smoke passed owner-scoped list/detail; responses contain BMO UUID and safe display/type/activity/notification fields only |
| POST | `/api/v1/integrations/whatsapp/conversations/resolve` | `CANDIDATE_VERIFIED` | Candidate-only smoke passed validated international phone resolution/creation; when the private resolver is available, forward/reverse provider mappings are added before candidate lookup, otherwise the phone alias remains conservative; no provider identity projection is performed |
| GET/PATCH | `/api/v1/integrations/whatsapp/notification-rules` | `CANDIDATE_VERIFIED` | Candidate-only smoke passed authenticated `ALL` DM default plus UUID-scoped `CONTACT`; `GROUP` remains default-disabled and ingestion-independent |
| POST | `/api/v1/integrations/whatsapp/send-preview`, `.../send-confirm` | `CANDIDATE_VERIFIED` | Candidate-only smoke passed conversation-scoped preview and bounded foreign-confirm rejection; outbound resolution uses the server-side canonical mapping and any explicit provider aliases |
| POST | `/api/v1/integrations/spotify/connect` | `SOURCE_VERIFIED` | Server-side Authorization Code state route; live credentials/callback `BLOCKED_EXTERNAL_SECRET` |
| GET | `/api/v1/integrations/spotify/callback` | `SOURCE_VERIFIED` | Exact configured redirect and single-use state; tokens stay server-side |
| GET | `/api/v1/integrations/spotify/status` | `SOURCE_VERIFIED` | Normalized owner-scoped state only |
| POST | `/api/v1/integrations/spotify/disconnect` | `SOURCE_VERIFIED` | Owner-scoped credential removal |
| GET | `/api/v1/integrations/spotify/search`, `/.../active-device` | `SOURCE_VERIFIED` | Concrete normalized catalog search and server-derived active-device projection; candidate provider credentials blocked |
| GET | `/api/v1/integrations/spotify/devices`, `.../playback` | `SOURCE_VERIFIED` | Concrete normalized provider client; no active device result is safe |
| POST | `/api/v1/integrations/spotify/actions` | `SOURCE_VERIFIED` | Explicit allowlist for search/resolution, track/artist/album/playlist play, pause/resume/skip, transfer, seek, volume, shuffle, repeat, queue, idempotency, and confirmation; live provider blocked |
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
