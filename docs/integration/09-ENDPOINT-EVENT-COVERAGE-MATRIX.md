# Mobile Endpoint and WebSocket Coverage Matrix

**Audited:** 2026-08-18
**Source:** backend/src/p9/http/*.ts, backend/src/p9/websocket/mobile-events.ts, backend/src/p9/websocket/mobile-websocket.server.ts
**Main:** 6f6a6b88b6f85166b92ad58e6f954a4b1c2c206a
**Production:** P9 base promoted and live; code-only enrollment remains
branch-scoped and is not production-verified

## Counting rule

The source registers 83 literal P9 HTTP routes. This Mobile inventory contains
79 routes: every P9 route except the three internal /ops/db/* routes and the
Spotify provider callback. The two authenticated WhatsApp QR setup routes are
included so they cannot become undocumented, but are marked OUT_OF_SCOPE for
the Mobile UI. The Spotify callback is documented separately as a provider
browser callback, not a Mobile API.

PRODUCTION_VERIFIED means the route is in the promoted production image. It
does not claim that a provider action or physical ESP behavior has been
exercised. IMPLEMENTED, PARTIALLY_IMPLEMENTED, NOT_IMPLEMENTED, OUT_OF_SCOPE,
BLOCKED, and PENDING_PHYSICAL_ESP retain their meanings from
05-IMPLEMENTATION-STATUS.md.

## REST route inventory

Auth is explicit per route row: `PUBLIC`, `BEARER`, or `OPERATOR_BEARER`.
`PUBLIC` routes are the five auth bootstrap routes plus the avatar media route; `OPERATOR_BEARER` is reserved for the two authenticated WhatsApp setup surfaces marked `OUT_OF_SCOPE` for Mobile UI.

| # | Method | Path | Auth | Request/query source | Response/status | Retry/idempotency | Mobile status/relevance |
|---:|---|---|---|---|---|---|
| 1 | POST | /api/v1/auth/register | PUBLIC | strict registration body; DOB required, optional legacy invitation | {user,session} / 201 | no key; duplicate 409 | PRODUCTION_VERIFIED |
| 2 | POST | /api/v1/auth/login | PUBLIC | {email,password,clientDeviceId?} | {user,session} / 200 | no key; invalid input is auth failure | PRODUCTION_VERIFIED |
| 3 | POST | /api/v1/auth/password/recovery/verify | PUBLIC | {email,dateOfBirth} | {recoveryToken,expiresAt} / 200 | no key; IP/email rate limits | PRODUCTION_VERIFIED |
| 4 | POST | /api/v1/auth/password/recovery/reset | PUBLIC | {recoveryToken,newPassword} | empty / 204 | token single-use | PRODUCTION_VERIFIED |
| 5 | POST | /api/v1/auth/refresh | PUBLIC | {refreshToken} | {session} / 200 | refresh rotation/replay-family handling | PRODUCTION_VERIFIED |
| 6 | POST | /api/v1/auth/logout | BEARER | bearer, no body required | empty / 204 | current session revoke | PRODUCTION_VERIFIED |
| 7 | POST | /api/v1/auth/logout-all | BEARER | bearer, no body required | empty / 204 | all-session revoke | PRODUCTION_VERIFIED |
| 8 | GET | /api/v1/me | BEARER | bearer | {user: SafeUser} / 200 | safe read | PRODUCTION_VERIFIED |
| 9 | GET | /api/v1/chat/sessions | BEARER | no body | {sessions} / 200 | safe read; max 100 | PRODUCTION_VERIFIED |
| 10 | POST | /api/v1/chat/sessions | BEARER | {temporary?: boolean} | {session} / 201 | no key | PRODUCTION_VERIFIED |
| 11 | GET | /api/v1/chat/sessions/:sessionId/messages | BEARER | limit 1..100, positive int64 cursor | {messages,nextCursor} / 200 | safe cursor read | PRODUCTION_VERIFIED |
| 12 | POST | /api/v1/chat/sessions/:sessionId/messages | BEARER | {idempotencyKey: UUID,text,speakOnDevice?,deviceId?} | {userMessage,assistant} / 202 | user/idempotency key replay | PRODUCTION_VERIFIED |
| 13 | DELETE | /api/v1/chat/sessions/:sessionId | BEARER | no body | empty / 204 | durable soft delete/cancel | PRODUCTION_VERIFIED |
| 14 | POST | /api/v1/chat/messages/:messageId/feedback | BEARER | {rating: positive\|negative,reason?} | {feedback} / 200 | owner-scoped upsert | PRODUCTION_VERIFIED |
| 15 | GET | /api/v1/devices/:deviceId/wifi | BEARER | no body | {wifi} or null / 200 | safe read | PRODUCTION_VERIFIED |
| 16 | PUT | /api/v1/devices/:deviceId/wifi | BEARER | {ssid,password?} | {wifi} / 202 | latest-write-wins, no client key | PRODUCTION_VERIFIED; physical apply PENDING_PHYSICAL_ESP |
| 17 | DELETE | /api/v1/devices/:deviceId/wifi | BEARER | no body | empty / 204 | metadata delete | PRODUCTION_VERIFIED |
| 18 | GET | /api/v1/devices/:deviceId/logs | BEARER | limit 1..100, default 50 | {logs} / 200 | safe bounded read | PRODUCTION_VERIFIED; physical emission pending |
| 19 | GET | /api/v1/devices/:deviceId/telemetry | BEARER | no body | {telemetry} / 200 | safe read | PRODUCTION_VERIFIED; physical emission pending |
| 20 | GET | /api/v1/devices | BEARER | no body | {devices: SafeDevice[]} / 200 | safe read | PRODUCTION_VERIFIED |
| 21 | GET | /api/v1/devices/:deviceId | BEARER | UUID path | {device: SafeDevice} / 200 | safe read | PRODUCTION_VERIFIED |
| 22 | PATCH | /api/v1/devices/:deviceId/settings | BEARER | strict device settings patch | {settings} / 200 | owner-scoped write | PRODUCTION_VERIFIED; firmware sync pending |
| 23 | POST | /api/v1/devices/:deviceId/unpair | BEARER | no body | empty / 204 | durable revoke; revokes bound sessions | PRODUCTION_VERIFIED |
| 24 | POST | /api/v1/integrations/whatsapp/connect | BEARER | {} | `{connection,blocked}` / 202 | provider operation | PRODUCTION_VERIFIED; provider gate separate |
| 25 | GET | /api/v1/integrations/whatsapp/status | BEARER | no body | connection / 200 | safe read | PRODUCTION_VERIFIED |
| 26 | GET | /api/v1/integrations/whatsapp/conversations | BEARER | limit 1..100, default 50, timestamp/UUID cursor | {conversations,nextCursor} / 200 | safe cursor read | PRODUCTION_VERIFIED |
| 27 | GET | /api/v1/integrations/whatsapp/conversations/:id | BEARER | UUID path | safe conversation / 200 | safe read | PRODUCTION_VERIFIED |
| 28 | POST | /api/v1/integrations/whatsapp/conversations/resolve | BEARER | {phoneNumber,displayName?} | safe conversation / 200 | provider mapping/idempotent convergence | PRODUCTION_VERIFIED |
| 29 | GET | /api/v1/integrations/whatsapp/qr | OPERATOR_BEARER | no body | {qr,expiresAt,status} / 200 | operator setup only | OUT_OF_SCOPE for Mobile UI |
| 30 | POST | /api/v1/integrations/whatsapp/confirm-scanned | OPERATOR_BEARER | {} | {connection} / 200 | operator setup only | OUT_OF_SCOPE for Mobile UI |
| 31 | POST | /api/v1/integrations/whatsapp/disconnect | BEARER | no body | empty / 204 | provider/state mutation | PRODUCTION_VERIFIED; provider gate separate |
| 32 | GET | /api/v1/integrations/whatsapp/notification-rules | BEARER | no body | {rules} / 200 | safe read | PRODUCTION_VERIFIED |
| 33 | PATCH | /api/v1/integrations/whatsapp/notification-rules | BEARER | {rules: 1..100} | {rules} / 200 | replacement write | PRODUCTION_VERIFIED |
| 34 | POST | /api/v1/integrations/whatsapp/send-preview | BEARER | {conversationId,message,idempotencyKey} | {send} / 201 | user/idempotency key | PRODUCTION_VERIFIED; provider send gate separate |
| 35 | POST | /api/v1/integrations/whatsapp/send-confirm | BEARER | {requestId: UUID,confirmed:true} | {send} / 200 | confirmation expiry/claim | PRODUCTION_VERIFIED; provider send gate separate |
| 36 | POST | /api/v1/integrations/spotify/connect | BEARER | {} | {authorizationUrl} / 200 | server OAuth state | PRODUCTION_VERIFIED |
| 37 | GET | /api/v1/integrations/spotify/status | BEARER | no body | connection / 200 | safe read | PRODUCTION_VERIFIED |
| 38 | GET | /api/v1/integrations/spotify/search | BEARER | q 1..200, optional types | {results} / 200 | safe read/provider retry policy | PRODUCTION_VERIFIED; provider gate separate |
| 39 | POST | /api/v1/integrations/spotify/disconnect | BEARER | no body | empty / 204 | credential/state wipe | PRODUCTION_VERIFIED |
| 40 | GET | /api/v1/integrations/spotify/devices | BEARER | no body | {devices} / 200 | safe read | PRODUCTION_VERIFIED |
| 41 | GET | /api/v1/integrations/spotify/active-device | BEARER | no body | {device} / 200 | safe read | PRODUCTION_VERIFIED |
| 42 | GET | /api/v1/integrations/spotify/playback | BEARER | no body | {playback} / 200 | safe read; NO_ACTIVE_DEVICE is typed | PRODUCTION_VERIFIED |
| 43 | PUT | /api/v1/integrations/spotify/preferred-device | BEARER | {deviceId: string\|null} | {device} / 200 | owner-scoped write | PRODUCTION_VERIFIED |
| 44 | POST | /api/v1/integrations/spotify/actions | BEARER | {action,idempotencyKey,payload?,confirmed?} | {action} / 202 | user/action idempotency | PRODUCTION_VERIFIED; provider gate separate |
| 45 | GET | /api/v1/plugins | BEARER | no body | {items} / 200 | safe read | PRODUCTION_VERIFIED |
| 46 | POST | /api/v1/support/bug-reports | BEARER | authenticated multipart; max 5 screenshots | {id,status:"received"} / 201 | new report per request | PRODUCTION_VERIFIED |
| 47 | GET | /api/v1/settings/memory | BEARER | no body | {automaticMemoryCandidates} / 200 | safe read | PRODUCTION_VERIFIED |
| 48 | PATCH | /api/v1/settings/memory | BEARER | {automaticMemoryCandidates:boolean} | same object / 200 | owner-scoped write | PRODUCTION_VERIFIED |
| 49 | GET | /api/v1/memories | BEARER | limit 1..100, default 25, opaque cursor | {memories,nextCursor} / 200 | safe cursor read | PRODUCTION_VERIFIED |
| 50 | GET | /api/v1/memories/:id | BEARER | UUID path | memory projection / 200 | safe read | PRODUCTION_VERIFIED |
| 51 | PATCH | /api/v1/memories/:id | BEARER | idempotency key plus bounded memory fields | memory projection / 200 | idempotent action | PRODUCTION_VERIFIED |
| 52 | DELETE | /api/v1/memories/:id | BEARER | idempotency key body or header | empty / 204 | idempotent action | PRODUCTION_VERIFIED |
| 53 | GET | /api/v1/memory-candidates | BEARER | limit 1..100, default 25, opaque cursor | {candidates,nextCursor} / 200 | safe cursor read | PRODUCTION_VERIFIED |
| 54 | POST | /api/v1/memory-candidates/:id/accept | BEARER | idempotency key plus optional category/importance/expiry | memory projection / 200 | idempotent accept | PRODUCTION_VERIFIED |
| 55 | POST | /api/v1/memory-candidates/:id/reject | BEARER | {idempotencyKey} | candidate projection / 200 | idempotent reject | PRODUCTION_VERIFIED |
| 56 | POST | /api/v1/memories/forget-topic | BEARER | {idempotencyKey,topic} | sanitized counts / 200 | idempotent action | PRODUCTION_VERIFIED |
| 57 | POST | /api/v1/memories/clear-all | BEARER | {idempotencyKey} | sanitized counts / 200 | idempotent action | PRODUCTION_VERIFIED |
| 58 | POST | /api/v1/memories/export | BEARER | {idempotencyKey} | JSON export / 200 | idempotent audit | PRODUCTION_VERIFIED |
| 59 | GET | /api/v1/memory/summary | BEARER | no body | {summary} / 200 | safe read | PRODUCTION_VERIFIED |
| 60 | POST | /api/v1/memory/summary/regenerate | BEARER | {idempotencyKey} | {summary,generation} / 202 | idempotent action | PRODUCTION_VERIFIED; runtime status not_configured |
| 61 | POST | /api/v1/memory/summary/feedback | BEARER | {idempotencyKey,feedback} | {summary} / 200 | idempotent action | PRODUCTION_VERIFIED |
| 62 | POST | /api/v1/pairing/claim | BEARER | strict {code: six digits} | {device} / 201; generic unusable-code 409; rate limit 429 | single-use transaction; user/session/IP limits | IMPLEMENTED; physical completion PENDING_PHYSICAL_ESP |
| 63 | GET | /api/v1/settings/personalization | BEARER | no body | seven-field object / 200 | safe read/upsert | PRODUCTION_VERIFIED |
| 64 | PATCH | /api/v1/settings/personalization | BEARER | strict non-empty seven-field patch | seven-field object / 200 | owner-scoped write | PRODUCTION_VERIFIED |
| 65 | PATCH | /api/v1/me/profile | BEARER | strict non-empty {displayName?,username?} | {user} / 200 | owner-scoped write; username conflict 409 | PRODUCTION_VERIFIED |
| 66 | POST | /api/v1/me/avatar | BEARER | multipart one file; JPEG/PNG/WebP, max 5 MiB | {avatarUrl} / 200 | upload admission/rate limits | PRODUCTION_VERIFIED |
| 67 | GET | /media/avatars/:fileName | PUBLIC | UUID .webp filename; no bearer required | WebP bytes / 200 | immutable cache read | PRODUCTION_VERIFIED |
| 68 | GET | /api/v1/schedules | BEARER | limit 1..100, default 50, timestamp/UUID cursor | {schedules,nextCursor} / 200 | safe cursor read | PRODUCTION_VERIFIED |
| 69 | POST | /api/v1/schedules | BEARER | Daily/Weekly/Once strict union | {schedule} / 201 | no key; new schedule | PRODUCTION_VERIFIED |
| 70 | GET | /api/v1/schedules/:id | BEARER | UUID path | {schedule} / 200 | safe read | PRODUCTION_VERIFIED |
| 71 | PATCH | /api/v1/schedules/:id | BEARER | current version plus mutable fields | {schedule} / 200 | optimistic version; 409 stale | PRODUCTION_VERIFIED |
| 72 | POST | /api/v1/schedules/:id/pause | BEARER | {version} | {schedule} / 200 | optimistic version | PRODUCTION_VERIFIED |
| 73 | POST | /api/v1/schedules/:id/resume | BEARER | {version} | {schedule} / 200 | optimistic version | PRODUCTION_VERIFIED |
| 74 | DELETE | /api/v1/schedules/:id | BEARER | {version} | empty / 204 | durable cancel, optimistic version | PRODUCTION_VERIFIED |
| 75 | GET | /api/v1/schedule-runs | BEARER | limit, cursor, optional scheduleId | {runs,nextCursor} / 200 | safe cursor read | PRODUCTION_VERIFIED |
| 76 | GET | /api/v1/settings/user | BEARER | no body | user settings / 200 | safe read | PRODUCTION_VERIFIED |
| 77 | PATCH | /api/v1/settings/user | BEARER | strict optional settings patch | user settings / 200 | owner-scoped write | PRODUCTION_VERIFIED |
| 78 | GET | /api/v1/settings/devices/:deviceId | BEARER | UUID path | device settings / 200 | safe read | PRODUCTION_VERIFIED |
| 79 | PATCH | /api/v1/settings/devices/:deviceId | BEARER | strict device settings patch | device settings / 200 | owner-scoped write | PRODUCTION_VERIFIED |

The two registered device-settings PATCH routes are aliases to the same
`SettingsService.updateDeviceSettings` behavior and remain separately
documented; source and tests do not designate a canonical/deprecated one.

### Routes intentionally outside the Mobile count

~~~
GET /api/v1/integrations/spotify/callback   provider browser callback, not Mobile API
GET /api/v1/ops/db/livez                    internal operator route
GET /api/v1/ops/db/readyz                   internal operator route
GET /api/v1/ops/db/migrations               internal operator route
~~~

The production Spotify callback is exactly
https://api.personalbmo.web.id/api/v1/integrations/spotify/callback. Mobile
starts OAuth with /spotify/connect and does not call the callback itself.

The source does not register GET /api/v1/devices/:deviceId/status or POST
/api/v1/voice/preview; both are NOT_IMPLEMENTED.

## Mobile WebSocket event inventory

The source defines 12 Mobile event names: one client authentication event, one
server authentication acknowledgement, and ten additional server events.

| Direction | Event | Runtime evidence | Authentication | Payload | Trigger/source | Mobile behavior |
|---|---|---|---|---|---|---|
| Mobile → Backend | authenticate | RUNTIME_PROTOCOL | First message within 5 seconds | `{event,accessToken}` | Client opens exact `/api/v1/ws` path | Send once; never use query token or refresh token |
| Backend → Mobile | authenticated | RUNTIME_PROTOCOL | After active JWT/session verification | `{event,status:"ok",userId}` | Successful authentication | Mark socket ready |
| Backend → Mobile | chat_thinking | RUNTIME_EMITTED | Authenticated socket | `{sessionId,messageId}` | Durable chat accepted/processing | Show transient thinking; recover from history |
| Backend → Mobile | chat_message | RUNTIME_EMITTED | Authenticated socket | `{sessionId,message:{id,sender:"assistant",text,createdAt}}` | Assistant message persisted | Insert/update chat; history remains authority |
| Backend → Mobile | device_status | SCHEMA_DEFINED_NO_CURRENT_EMITTER | Authenticated socket | device UUID, online, lastSeenAt, Wi-Fi RSSI, nullable battery | Schema-defined; no direct current `sendToUser` emitter found | Forward-compatible handler only; use REST device state as fallback |
| Backend → Mobile | voice_processing_status | SCHEMA_DEFINED_NO_CURRENT_EMITTER | Authenticated socket | device/request UUID, `thinking\|audio_ready\|completed\|failed`, nullable errorCode | Schema-defined; no direct current `sendToUser` emitter found | Forward-compatible handler only; do not require current delivery |
| Backend → Mobile | wifi_configuration_status | SCHEMA_DEFINED_NO_CURRENT_EMITTER | Authenticated socket | device/config UUID, Wi-Fi lifecycle status, nullable errorCode | Schema-defined; no direct current `sendToUser` emitter found | Forward-compatible handler only; use REST Wi-Fi state as fallback |
| Backend → Mobile | proactive_delivery_status | RUNTIME_EMITTED | Authenticated socket | device/delivery UUID, source, delivery status, nullable errorCode | Generic CHAT/SCHEDULE/WHATSAPP delivery | Show device delivery status; no fabricated device for MOBILE target |
| Backend → Mobile | schedule_status | RUNTIME_EMITTED | Authenticated socket | schedule UUID, nullable run UUID, durable status, label | Schedule create/update/lifecycle | Refresh schedule state |
| Backend → Mobile | integration_status | SCHEMA_DEFINED_NO_CURRENT_EMITTER | Authenticated socket | integration `whatsapp\|spotify`, status `CONNECTED\|DISCONNECTED\|PENDING\|ERROR\|RECONNECT_REQUIRED` | Schema-defined; no direct current `sendToUser` emitter found | Forward-compatible handler only; poll integration REST status |
| Backend → Mobile | notification | SCHEMA_DEFINED_NO_CURRENT_EMITTER | Authenticated socket | UUID, `GENERIC`, bounded title/body, createdAt | Schema-defined; no direct current `sendToUser` emitter found | Forward-compatible handler only; do not require current delivery |
| Backend → Mobile | whatsapp_notification | RUNTIME_EMITTED | Authenticated socket | conversation UUID, displayName, `DM\|GROUP`, receivedAt | Allowed inbound metadata notification | Refresh conversation; no message body/JID/phone/token |

The five `RUNTIME_EMITTED` application events have direct current emitters:
`chat_thinking`, `chat_message`, `proactive_delivery_status`,
`schedule_status`, and `whatsapp_notification`. The five
`SCHEMA_DEFINED_NO_CURRENT_EMITTER` events are forward-compatible schemas
only; Mobile must not require them to arrive and should use authoritative
REST state or reconnect reads where applicable.

All outbound schemas are strict. The Mobile socket has a 32 KiB maximum
payload, 60-second server ping, and termination after two missed pongs. Token
expiry closes 4410 ACCESS_TOKEN_EXPIRED; invalid session closes 4403; auth
timeout closes 4408; malformed pre-auth data closes 4401.

/api/v1/ws is an event transport, not a chat-history authority, command
channel, audio stream, or LLM token stream. REST history and resource reads are
the recovery source after reconnect.

## Separate hardware WebSocket

The hardware contract remains wss://api.personalbmo.web.id/ws with
device_id/device_token, existing raw-WAV voice, and MP3 playback events. It is
not interchangeable with Mobile /api/v1/ws. Additive Wi-Fi, telemetry, log,
settings, and proactive events remain PENDING_PHYSICAL_ESP until firmware and
real-device evidence exist. Pairing adds `pairing_code`,
`pairing_mode_request`, and `pairing_completed`; these are Backend-implemented
but remain PENDING_PHYSICAL_ESP for firmware acceptance.

## Coverage result

~~~
MOBILE_ROUTE_SOURCE_COUNT=79
MOBILE_WS_EVENT_SOURCE_COUNT=12
MOBILE_ROUTE_DOC_COVERAGE=100%
MOBILE_WS_EVENT_DOC_COVERAGE=100%
~~~

Any new registered route or event must update this matrix, the canonical Mobile
contract, and implementation status in the same source change.
