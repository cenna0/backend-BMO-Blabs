# Mobile Endpoint and WebSocket Coverage Matrix

**Audited:** 2026-08-29
**Status:** `PRODUCTION_VERIFIED`  
**Deployed-image runtime:** `joy-p9.1:production`  
**Base REST URL:** `https://api.personalbmo.web.id/api/v1`  
**Base Mobile WS URL:** `wss://api.personalbmo.web.id/api/v1/ws`

---

## Summary of Registered HTTP Endpoints

The Joy backend registers 98 HTTP routes in the current source/runtime inventory:
- **93 registrations from the P9 router** (including /api/v1 routes, public avatar media, provider callbacks, and database-ops routes)
- **1 hardware voice upload route** (/api/v1/voice)
- **1 ephemeral audio download route** (/audio/:fileName)
- **3 health routes** (/livez, /readyz, /health)




---

## Full REST Route Inventory

| # | Method | Path | Auth | Description | Status |
|---:|---|---|---|---|---|
| 1 | POST | `/api/v1/auth/register` | PUBLIC | User registration with DOB & password | PRODUCTION_VERIFIED |
| 2 | POST | `/api/v1/auth/login` | PUBLIC | Standard email + password login | PRODUCTION_VERIFIED |
| 3 | POST | `/api/v1/auth/google` | PUBLIC | Google OAuth ID token verification & sign-in | PRODUCTION_VERIFIED |
| 4 | POST | `/api/v1/auth/password/recovery/verify` | PUBLIC | Step 1 recovery verification by email & DOB | PRODUCTION_VERIFIED |
| 5 | POST | `/api/v1/auth/password/recovery/reset` | PUBLIC | Step 2 password reset with recovery token | PRODUCTION_VERIFIED |
| 6 | POST | `/api/v1/auth/refresh` | PUBLIC | Refresh token rotation & access token issuance | PRODUCTION_VERIFIED |
| 7 | POST | `/api/v1/auth/logout` | BEARER | Revoke current session token | PRODUCTION_VERIFIED |
| 8 | POST | `/api/v1/auth/logout-all` | BEARER | Revoke all active sessions for user | PRODUCTION_VERIFIED |
| 9 | GET | `/api/v1/me` | BEARER | Get current authenticated user profile | PRODUCTION_VERIFIED |
| 10 | PATCH | `/api/v1/me/profile` | BEARER | Update user profile metadata | PRODUCTION_VERIFIED |
| 11 | POST | `/api/v1/me/profile/avatar` | BEARER | Upload & process user avatar image | PRODUCTION_VERIFIED |
| 12 | GET | `/media/avatars/:fileName` | PUBLIC | Serve avatar image files | PRODUCTION_VERIFIED |
| 13 | GET | `/api/v1/chat/sessions` | BEARER | List user chat sessions | PRODUCTION_VERIFIED |
| 14 | POST | `/api/v1/chat/sessions` | BEARER | Create new chat session (standard or temporary) | PRODUCTION_VERIFIED |
| 15 | GET | `/api/v1/chat/sessions/:sessionId/messages` | BEARER | Paginated chat message history | PRODUCTION_VERIFIED |
| 16 | POST | `/api/v1/chat/sessions/:sessionId/messages` | BEARER | Send message to AI companion (two-tier NLU + LLM) | PRODUCTION_VERIFIED |
| 17 | DELETE | `/api/v1/chat/sessions/:sessionId` | BEARER | Archive / soft delete chat session | PRODUCTION_VERIFIED |
| 18 | POST | `/api/v1/chat/messages/:messageId/feedback` | BEARER | Submit positive/negative feedback on AI turn | PRODUCTION_VERIFIED |
| 19 | POST | `/api/v1/tts/synthesize` | BEARER | Synthesize plain text to temporary MP3 audio | PRODUCTION_VERIFIED |
| 20 | POST | `/api/v1/settings/push-tokens` | BEARER | Register/upsert mobile Expo push token | PRODUCTION_VERIFIED |
| 21 | DELETE | `/api/v1/settings/push-tokens` | BEARER | Unregister mobile Expo push token | PRODUCTION_VERIFIED |
| 22 | GET | `/api/v1/settings/push-tokens` | BEARER | List registered push tokens for user | PRODUCTION_VERIFIED |
| 23 | GET | `/api/v1/devices` | BEARER | List devices owned by user | PRODUCTION_VERIFIED |
| 24 | GET | `/api/v1/devices/:deviceId` | BEARER | Get specific device details | PRODUCTION_VERIFIED |
| 25 | PATCH | `/api/v1/devices/:deviceId/settings` | BEARER | Update device hardware settings (volume, mic) | PRODUCTION_VERIFIED |
| 26 | POST | `/api/v1/devices/:deviceId/unpair` | BEARER | Unpair device & revoke hardware binding | PRODUCTION_VERIFIED |
| 27 | POST | `/api/v1/pairing/claim` | BEARER | Claim 6-digit code to pair physical device | PRODUCTION_VERIFIED |
| 28 | GET | `/api/v1/devices/:deviceId/wifi` | BEARER | Read configured device Wi-Fi profile | PRODUCTION_VERIFIED |
| 29 | PUT | `/api/v1/devices/:deviceId/wifi` | BEARER | Queue new Wi-Fi credentials for device | PRODUCTION_VERIFIED |
| 30 | DELETE | `/api/v1/devices/:deviceId/wifi` | BEARER | Clear saved Wi-Fi configuration | PRODUCTION_VERIFIED |
| 31 | GET | `/api/v1/devices/:deviceId/logs` | BEARER | Query device diagnostic logs | PRODUCTION_VERIFIED |
| 32 | GET | `/api/v1/devices/:deviceId/telemetry` | BEARER | Query latest device telemetry | PRODUCTION_VERIFIED |
| 33 | GET | `/api/v1/settings/user` | BEARER | Read general user settings | PRODUCTION_VERIFIED |
| 34 | PATCH | `/api/v1/settings/user` | BEARER | Update general user settings | PRODUCTION_VERIFIED |
| 35 | GET | `/api/v1/settings/devices/:deviceId` | BEARER | Read device specific preferences | PRODUCTION_VERIFIED |
| 36 | PATCH | `/api/v1/settings/devices/:deviceId` | BEARER | Update device specific preferences | PRODUCTION_VERIFIED |
| 37 | GET | `/api/v1/settings/personalization` | BEARER | Read personality & conversation preferences | PRODUCTION_VERIFIED |
| 38 | PATCH | `/api/v1/settings/personalization` | BEARER | Update personality & prompt preferences | PRODUCTION_VERIFIED |
| 39 | GET | `/api/v1/settings/memory` | BEARER | Read long-term memory settings | PRODUCTION_VERIFIED |
| 40 | PATCH | `/api/v1/settings/memory` | BEARER | Update memory auto-retention flags | PRODUCTION_VERIFIED |
| 41 | GET | `/api/v1/memories` | BEARER | List stored memory records | PRODUCTION_VERIFIED |
| 42 | GET | `/api/v1/memories/:id` | BEARER | Read single memory record | PRODUCTION_VERIFIED |
| 43 | PATCH | `/api/v1/memories/:id` | BEARER | Edit memory record content | PRODUCTION_VERIFIED |
| 44 | DELETE | `/api/v1/memories/:id` | BEARER | Delete specific memory record | PRODUCTION_VERIFIED |
| 45 | GET | `/api/v1/memory-candidates` | BEARER | List unconfirmed memory candidates | PRODUCTION_VERIFIED |
| 46 | POST | `/api/v1/memory-candidates/:id/accept` | BEARER | Accept and persist candidate to memory | PRODUCTION_VERIFIED |
| 47 | POST | `/api/v1/memory-candidates/:id/reject` | BEARER | Reject candidate memory | PRODUCTION_VERIFIED |
| 48 | POST | `/api/v1/memories/forget-topic` | BEARER | Mass delete memories matching a topic query | PRODUCTION_VERIFIED |
| 49 | POST | `/api/v1/memories/clear-all` | BEARER | Clear entire user memory graph | PRODUCTION_VERIFIED |
| 50 | POST | `/api/v1/memories/export` | BEARER | Export all user memories to JSON | PRODUCTION_VERIFIED |
| 51 | GET | `/api/v1/memory/summary` | BEARER | Read user memory profile summary | PRODUCTION_VERIFIED |
| 52 | POST | `/api/v1/memory/summary/regenerate` | BEARER | Request background summary regeneration | PRODUCTION_VERIFIED |
| 53 | POST | `/api/v1/memory/summary/feedback` | BEARER | Submit summary accuracy feedback | PRODUCTION_VERIFIED |
| 54 | GET | `/api/v1/schedules` | BEARER | List user schedules & reminders | PRODUCTION_VERIFIED |
| 55 | POST | `/api/v1/schedules` | BEARER | Create new schedule/reminder | PRODUCTION_VERIFIED |
| 56 | GET | `/api/v1/schedules/:id` | BEARER | Read schedule details | PRODUCTION_VERIFIED |
| 57 | PATCH | `/api/v1/schedules/:id` | BEARER | Update schedule details/timing | PRODUCTION_VERIFIED |
| 58 | POST | `/api/v1/schedules/:id/pause` | BEARER | Pause active schedule | PRODUCTION_VERIFIED |
| 59 | POST | `/api/v1/schedules/:id/resume` | BEARER | Resume paused schedule | PRODUCTION_VERIFIED |
| 60 | DELETE | `/api/v1/schedules/:id` | BEARER | Delete schedule | PRODUCTION_VERIFIED |
| 61 | GET | `/api/v1/schedule-runs` | BEARER | Query schedule execution history | PRODUCTION_VERIFIED |
| 62 | GET | `/api/v1/plugins` | BEARER | List available & connected plugins | PRODUCTION_VERIFIED |
| 63 | POST | `/api/v1/integrations/spotify/connect` | BEARER | Initiate Spotify OAuth authorization | PRODUCTION_VERIFIED |
| 64 | GET | `/api/v1/integrations/spotify/status` | BEARER | Read Spotify connection & token status | PRODUCTION_VERIFIED |
| 65 | GET | `/api/v1/integrations/spotify/search` | BEARER | Search tracks/artists on Spotify | PRODUCTION_VERIFIED |
| 66 | POST | `/api/v1/integrations/spotify/actions` | BEARER | Execute playback action (Play, Pause, Next, etc.) | PRODUCTION_VERIFIED |
| 67 | GET | `/api/v1/integrations/spotify/devices` | BEARER | List active Spotify Connect devices | PRODUCTION_VERIFIED |
| 68 | GET | `/api/v1/integrations/spotify/active-device` | BEARER | Get current active Spotify device | PRODUCTION_VERIFIED |
| 69 | GET | `/api/v1/integrations/spotify/playback` | BEARER | Read current Spotify playback state | PRODUCTION_VERIFIED |
| 70 | PUT | `/api/v1/integrations/spotify/preferred-device` | BEARER | Set user default playback device | PRODUCTION_VERIFIED |
| 71 | POST | `/api/v1/integrations/spotify/disconnect` | BEARER | Disconnect Spotify and wipe tokens | PRODUCTION_VERIFIED |
| 72 | GET | `/api/v1/integrations/spotify/callback` | PUBLIC | Provider browser OAuth callback | PRODUCTION_VERIFIED |
| 73 | POST | `/api/v1/integrations/whatsapp/connect` | BEARER | Initiate WhatsApp session connection | PRODUCTION_VERIFIED |
| 74 | GET | `/api/v1/integrations/whatsapp/status` | BEARER | Read WhatsApp connection status | PRODUCTION_VERIFIED |
| 75 | GET | `/api/v1/integrations/whatsapp/pairing` | BEARER | Get WhatsApp pairing status | PRODUCTION_VERIFIED |
| 76 | GET | `/api/v1/integrations/whatsapp/conversations` | BEARER | List synced WhatsApp chats | PRODUCTION_VERIFIED |
| 77 | GET | `/api/v1/integrations/whatsapp/conversations/:id` | BEARER | Read single WhatsApp conversation | PRODUCTION_VERIFIED |
| 78 | POST | `/api/v1/integrations/whatsapp/conversations/resolve` | BEARER | Resolve conversation by phone number | PRODUCTION_VERIFIED |
| 79 | GET | `/api/v1/integrations/whatsapp/qr` | BEARER | Get WhatsApp pairing QR code | PRODUCTION_VERIFIED |
| 80 | POST | `/api/v1/integrations/whatsapp/confirm-scanned` | BEARER | Confirm WhatsApp QR code scanned | PRODUCTION_VERIFIED |
| 81 | POST | `/api/v1/integrations/whatsapp/disconnect` | BEARER | Disconnect WhatsApp bridge session | PRODUCTION_VERIFIED |
| 82 | GET | `/api/v1/integrations/whatsapp/notification-rules` | BEARER | Read WhatsApp notification rules | PRODUCTION_VERIFIED |
| 83 | PATCH | `/api/v1/integrations/whatsapp/notification-rules` | BEARER | Update WhatsApp notification rules | PRODUCTION_VERIFIED |
| 84 | POST | `/api/v1/integrations/whatsapp/send-preview` | BEARER | Preview drafted WhatsApp message | PRODUCTION_VERIFIED |
| 85 | POST | `/api/v1/integrations/whatsapp/send-confirm` | BEARER | Confirm & send WhatsApp message | PRODUCTION_VERIFIED |
| 86 | POST | `/api/v1/support/bug-reports` | BEARER | Submit user bug report with attachments | PRODUCTION_VERIFIED |
| 87 | GET | `/api/v1/ops/db/livez` | PUBLIC | Database connectivity liveness probe | PRODUCTION_VERIFIED |
| 88 | GET | `/api/v1/ops/db/readyz` | PUBLIC | Database readiness probe | PRODUCTION_VERIFIED |
| 89 | GET | /api/v1/ops/db/migrations | PUBLIC | Prisma migration status inspector | PRODUCTION_VERIFIED |
| 90 | GET | /api/v1/auth/google/start | PUBLIC | Start Google OAuth browser flow | PRODUCTION_VERIFIED |
| 91 | GET | /api/v1/auth/google/callback | PUBLIC | Complete Google OAuth browser callback | PRODUCTION_VERIFIED |
| 92 | GET | /api/v1/chat/search | BEARER | Search user chat history | PRODUCTION_VERIFIED |
| 93 | POST | /api/v1/integrations/whatsapp/dismiss-qr | BEARER | Dismiss WhatsApp pairing QR state | PRODUCTION_VERIFIED |
| 94 | GET | /livez | INTERNAL | Backend liveness probe | PRODUCTION_VERIFIED |
| 95 | GET | /readyz | INTERNAL | Backend readiness probe | PRODUCTION_VERIFIED |
| 96 | GET | /health | PUBLIC | Aggregated public health status | PRODUCTION_VERIFIED |
| 97 | POST | /api/v1/voice | DEVICE CREDENTIAL | Upload canonical WAV for hardware voice pipeline | PRODUCTION_VERIFIED |
| 98 | GET | /audio/:fileName | PUBLIC | Download ephemeral MP3 speech audio | PRODUCTION_VERIFIED |

---

## Full Mobile WebSocket Event Inventory

The Mobile server accepts one initial JSON authentication message:
{"event":"authenticate","accessToken":"<access-token>"}

The server returns an authenticated acknowledgement. After that, native
WebSocket ping/pong maintains liveness; there is no application-level ping
event and no token query parameter.

| Event Name | Direction | Payload Structure / Description |
|---|---|---|
| authenticate | Mobile → Backend | Initial auth message with accessToken |
| authenticated | Backend → Mobile | Handshake acknowledgement with status ok and userId |
| chat_thinking | Backend → Mobile | sessionId and messageId |
| chat_message | Backend → Mobile | sessionId and SafeMessage |
| chat_title_updated | Backend → Mobile | sessionId and title |
| device_status | Backend → Mobile | deviceId, online, lastSeenAt, wifi, battery |
| voice_processing_status | Backend → Mobile | deviceId, requestId, status, errorCode |
| wifi_configuration_status | Backend → Mobile | deviceId, configurationId, status, errorCode |
| proactive_delivery_status | Backend → Mobile | deviceId, deliveryId, source, status, errorCode |
| schedule_status | Backend → Mobile | scheduleId, runId, status, statusLabel |
| integration_status | Backend → Mobile | integration and status |
| notification | Backend → Mobile | id, type GENERIC, title, body, createdAt |
| whatsapp_notification | Backend → Mobile | conversationId, displayName, conversationType, receivedAt |

## Full Hardware WebSocket Event Inventory

### Inbound Events (ESP32 → Backend)

| Event Name | Direction | Payload Structure / Description |
|---|---|---|
| authenticate | ESP32 → Backend | device_id and device_token |
| audio_playback_done | ESP32 → Backend | request_id |
| audio_playback_failed | ESP32 → Backend | request_id and reason DOWNLOAD_FAILED, DECODE_FAILED, or PLAYBACK_FAILED |
| wifi_configuration_received | ESP32 → Backend | configuration_id |
| wifi_configuration_result | ESP32 → Backend | configuration_id, status CONNECTED, ROLLED_BACK, or FAILED; optional rssi and reason |
| device_log | ESP32 → Backend | level DEBUG, INFO, WARN, or ERROR; uppercase code; message; optional timestamp and metadata |
| device_telemetry | ESP32 → Backend | wifi_connected; optional wifi_rssi, battery_percent, firmware_version |
| device_settings_applied | ESP32 → Backend | positive version |
| pairing_mode_request | ESP32 → Backend | Empty request payload |
| voice_reserve | ESP32 → Backend | request_id |
| voice_cancel | ESP32 → Backend | request_id, lease_id, reserve_receipt, and reason |
| proactive_offer_accepted | ESP32 → Backend | delivery_id, attempt_id, and offer_receipt |
| proactive_done | ESP32 → Backend | SCHEDULE source, delivery_id, attempt_id, lease_id, audio_receipt, reason COMPLETED |
| proactive_failed | ESP32 → Backend | SCHEDULE source, delivery_id, attempt_id, lease_id, audio_receipt, and failure reason |

### Outbound Events (Backend → ESP32)

| Event Name | Direction | Payload Structure / Description |
|---|---|---|
| authenticated | Backend → ESP32 | status ok, device_id, backend_state, active_request_id |
| authentication_failed | Backend → ESP32 | error INVALID_DEVICE_CREDENTIALS |
| connection_replaced | Backend → ESP32 | reason NEW_CONNECTION_ESTABLISHED |
| display_status | Backend → ESP32 | request_id and status thinking |
| audio_ready | Backend → ESP32 | request_id, audio_url, format mp3, expiry, optional transcript and response text |
| request_failed | Backend → ESP32 | request_id, error code, recoverable true |
| wifi_configuration | Backend → ESP32 | configuration_id, ssid, security OPEN or WPA_PSK, optional password |
| device_settings | Backend → ESP32 | version and playback_volume |
| pairing_code | Backend → ESP32 | six-digit code and expires_at |
| pairing_completed | Backend → ESP32 | status ok |
| voice_reserve_accepted | Backend → ESP32 | request_id, lease_id, reserve_receipt, 45-second capture lease and expiry |
| voice_reserve_rejected | Backend → ESP32 | request_id and reason UNAUTHENTICATED, NOT_IDLE, BUSY, or STALE_REQUEST |
| voice_reserve_expired | Backend → ESP32 | request_id, lease_id, and reserve_receipt |
| proactive_offer | Backend → ESP32 | delivery_id, attempt_id, offer_receipt, and expires_at_ms |
| proactive_audio_ready | Backend → ESP32 | SCHEDULE source, delivery_id, attempt_id, lease_id, audio_url, audio_receipt, expires_at_ms |
| proactive_cancel | Backend → ESP32 | SCHEDULE source, delivery_id, attempt_id, and lease_id |
| display_qr | Backend → ESP32 | qr payload and expires_at |
| clear_qr | Backend → ESP32 | Clear the WhatsApp QR overlay |

Source authority: backend/src/p9/websocket/mobile-events.ts,
backend/src/p9/websocket/mobile-websocket.server.ts, and
backend/src/websocket/events.ts. Physical firmware acceptance remains
PENDING_PHYSICAL_ESP.
