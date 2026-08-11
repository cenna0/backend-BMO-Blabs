# Endpoint and Event Coverage Matrix

**Frozen:** 2026-08-11
**Rule:** Status uses `08-DOCS-MAINTENANCE-PROTOCOL.md`; availability is independent from implementation status.

## Runtime and existing voice surfaces

| Method/surface | Path/event | Status | Availability / evidence |
|---|---|---|---|
| GET | `/health` | `EXISTING_VERIFIED` | Public production 200 |
| GET | `/livez` | `EXISTING_VERIFIED` | Backend loopback 200; Caddy deliberately returns public 404 |
| GET | `/readyz` | `EXISTING_VERIFIED` | Backend loopback; Caddy deliberately returns public 404 |
| POST | `/api/v1/voice` | `EXISTING_VERIFIED` | Production device-authenticated whole raw-WAV upload |
| GET | `/audio/:fileName` | `EXISTING_VERIFIED` | Canonical client form `/audio/:audioId.mp3`; production MP3 delivery |
| WSS | `/ws` | `EXISTING_VERIFIED` | Production physical-device contract; not mobile realtime |
| GET | `/api/v1/ops/db/livez` | `EXISTING_VERIFIED` | Private candidate only (`includeOps=true`) |
| GET | `/api/v1/ops/db/readyz` | `EXISTING_VERIFIED` | Private candidate only |
| GET | `/api/v1/ops/db/migrations` | `EXISTING_VERIFIED` | Private candidate only; sanitized migration state |
| TCP exposure | `*:5555` | `EXISTING_VERIFIED` | Phase 2 remediation: manual Prisma Studio stopped; no listener, Docker publication, or Caddy route. Firewall rules unreadable without passworded sudo. |

## Auth, profile, and settings

Existing P9.1 rows below are source- and private-candidate-verified but public production currently returns 404 because the P9 router is disabled there.

| Method | Path | Status | Availability / gap |
|---|---|---|---|
| POST | `/api/v1/auth/register` | `EXISTING_VERIFIED` | Private candidate; currently requires `invitationToken`; self-service change `READY_TO_IMPLEMENT` |
| POST | `/api/v1/auth/login` | `EXISTING_VERIFIED` | Private candidate |
| POST | `/api/v1/auth/refresh` | `EXISTING_VERIFIED` | Private candidate; opaque rotating refresh token |
| POST | `/api/v1/auth/logout` | `EXISTING_VERIFIED` | Private candidate |
| POST | `/api/v1/auth/logout-all` | `EXISTING_VERIFIED` | Private candidate |
| GET | `/api/v1/me` | `EXISTING_VERIFIED` | Private candidate; extended profile fields absent |
| POST | `/api/v1/auth/password/recovery/verify` | `READY_TO_IMPLEMENT` | Not registered |
| POST | `/api/v1/auth/password/recovery/reset` | `READY_TO_IMPLEMENT` | Not registered |
| PATCH | `/api/v1/me/profile` | `READY_TO_IMPLEMENT` | Not registered |
| POST | `/api/v1/me/avatar` | `READY_TO_IMPLEMENT` | Not registered |
| GET | `/media/avatars/:opaqueId.webp` | `READY_TO_IMPLEMENT` | Not registered; opaque public media identifier target |
| GET | `/api/v1/settings/user` | `EXISTING_VERIFIED` | Private candidate |
| PATCH | `/api/v1/settings/user` | `EXISTING_VERIFIED` | Private candidate |
| GET | `/api/v1/settings/personalization` | `READY_TO_IMPLEMENT` | Not registered |
| PATCH | `/api/v1/settings/personalization` | `READY_TO_IMPLEMENT` | Not registered |

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
| GET | `/api/v1/devices/:deviceId/wifi` | `READY_TO_IMPLEMENT` | Not registered; never return password |
| PUT | `/api/v1/devices/:deviceId/wifi` | `READY_TO_IMPLEMENT` | Not registered; encrypt secret at rest |
| DELETE | `/api/v1/devices/:deviceId/wifi` | `READY_TO_IMPLEMENT` | Not registered |

## Chat and mobile realtime

| Method/surface | Path/event | Status | Availability / gap |
|---|---|---|---|
| GET | `/api/v1/chat/sessions` | `READY_TO_IMPLEMENT` | Not registered |
| POST | `/api/v1/chat/sessions` | `READY_TO_IMPLEMENT` | Not registered |
| GET | `/api/v1/chat/sessions/:sessionId/messages` | `READY_TO_IMPLEMENT` | Not registered |
| POST | `/api/v1/chat/sessions/:sessionId/messages` | `READY_TO_IMPLEMENT` | Not registered; target 202 + idempotency |
| DELETE | `/api/v1/chat/sessions/:sessionId` | `READY_TO_IMPLEMENT` | Not registered |
| POST | `/api/v1/chat/messages/:messageId/feedback` | `READY_TO_IMPLEMENT` | Not registered |
| WSS | `/api/v1/ws` | `READY_TO_IMPLEMENT` | Separate mobile socket; not registered/public |
| Mobile -> Backend | `authenticate` | `READY_TO_IMPLEMENT` | Target uses `accessToken` after open |
| Backend -> Mobile | `authenticated` | `READY_TO_IMPLEMENT` | Target event |
| Backend -> Mobile | `chat_thinking` | `READY_TO_IMPLEMENT` | Target event |
| Backend -> Mobile | `chat_message` | `READY_TO_IMPLEMENT` | Target event uses `messageId` |
| Backend -> Mobile | `device_status` | `READY_TO_IMPLEMENT` | Target event |
| Backend -> Mobile | `voice_processing_status` | `READY_TO_IMPLEMENT` | Sanitized status, no audio streaming |
| Backend -> Mobile | `wifi_configuration_status` | `READY_TO_IMPLEMENT` | Target event |
| Backend -> Mobile | `proactive_delivery_status` | `READY_TO_IMPLEMENT` | Target event |
| Backend -> Mobile | `schedule_status` | `READY_TO_IMPLEMENT` | Target event |
| Backend -> Mobile | `integration_status` | `READY_TO_IMPLEMENT` | Target event |
| Backend -> Mobile | `notification` | `READY_TO_IMPLEMENT` | Target event |

## Memory and schedules

| Methods | Path family | Status | Availability / gap |
|---|---|---|---|
| GET/PATCH | `/api/v1/settings/memory` | `READY_TO_IMPLEMENT` | Not registered |
| GET | `/api/v1/memories`, `/api/v1/memories/:id` | `READY_TO_IMPLEMENT` | Not registered |
| PATCH/DELETE | `/api/v1/memories/:id` | `READY_TO_IMPLEMENT` | Not registered |
| GET | `/api/v1/memory-candidates` | `READY_TO_IMPLEMENT` | Not registered |
| POST | `/api/v1/memory-candidates/:id/accept`, `.../reject` | `READY_TO_IMPLEMENT` | Not registered |
| POST | `/api/v1/memories/forget-topic`, `.../clear-all`, `.../export` | `READY_TO_IMPLEMENT` | Not registered |
| GET | `/api/v1/memory/summary` | `READY_TO_IMPLEMENT` | Not registered |
| POST | `/api/v1/memory/summary/regenerate`, `.../feedback` | `READY_TO_IMPLEMENT` | Not registered |
| GET/POST | `/api/v1/schedules` | `READY_TO_IMPLEMENT` | Not registered |
| GET/PATCH | `/api/v1/schedules/:id` | `READY_TO_IMPLEMENT` | Not registered |
| POST | `/api/v1/schedules/:id/pause`, `.../resume` | `READY_TO_IMPLEMENT` | Not registered |
| DELETE | `/api/v1/schedules/:id` | `READY_TO_IMPLEMENT` | Not registered |
| GET | `/api/v1/schedule-runs` | `READY_TO_IMPLEMENT` | Not registered |

## Integrations, plugins, and support

| Methods | Path | Status | Availability / gate |
|---|---|---|---|
| POST/GET | `/api/v1/integrations/whatsapp/connect`, `.../status` | `READY_TO_IMPLEMENT` | Not registered; live acceptance `BLOCKED` by unverified BMO session |
| GET/POST | `/api/v1/integrations/whatsapp/qr`, `.../confirm-scanned` | `READY_TO_IMPLEMENT` | Not registered; exact Hermes boundary must be proven |
| POST | `/api/v1/integrations/whatsapp/disconnect` | `READY_TO_IMPLEMENT` | Not registered |
| GET/PATCH | `/api/v1/integrations/whatsapp/notification-rules` | `READY_TO_IMPLEMENT` | Not registered |
| POST | `/api/v1/integrations/whatsapp/send-preview`, `.../send-confirm` | `READY_TO_IMPLEMENT` | Not registered |
| POST | `/api/v1/integrations/spotify/connect` | `READY_TO_IMPLEMENT` | Not registered |
| GET | `/api/v1/integrations/spotify/callback` | `READY_TO_IMPLEMENT` | Not registered; server-side state/callback target |
| GET | `/api/v1/integrations/spotify/status` | `READY_TO_IMPLEMENT` | Not registered; live OAuth `BLOCKED` by provider config |
| POST | `/api/v1/integrations/spotify/disconnect` | `READY_TO_IMPLEMENT` | Not registered |
| GET | `/api/v1/integrations/spotify/devices`, `.../playback` | `READY_TO_IMPLEMENT` | Not registered |
| POST | `/api/v1/integrations/spotify/actions` | `READY_TO_IMPLEMENT` | Not registered |
| GET | `/api/v1/plugins` | `READY_TO_IMPLEMENT` | Not registered; frozen catalog is WhatsApp + Spotify only |
| POST | `/api/v1/support/bug-reports` | `READY_TO_IMPLEMENT` | Not registered |
| POST | `/api/v1/voice/preview` | `DEFERRED` | Not registered; last-priority optional surface |

## Existing device `/ws` events

| Direction | Event | Status | Evidence |
|---|---|---|---|
| ESP -> Backend | `authenticate` | `EXISTING_VERIFIED` | Config-based `DEVICE_ID`/`DEVICE_TOKEN`; 8 KiB max payload |
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
