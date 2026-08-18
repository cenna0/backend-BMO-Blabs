# BMO Mobile ↔ Backend API Contract

**Version:** 3.0.0
**Audited:** 2026-08-18
**Canonical source:** `main` at `e4f87ca5faf81e1c495c2719f3bb19b056340657`
**Production base URL:** `https://api.personalbmo.web.id`
**REST base path:** `/api/v1`
**Canonical companion:** `09-ENDPOINT-EVENT-COVERAGE-MATRIX.md`

This is the one primary Mobile contract. It describes the Backend that is
currently promoted to production. The matrix is the source-derived inventory
for every registered Mobile API route and Mobile WebSocket event. Registered
REST routes in this contract are `PRODUCTION_VERIFIED`; explicit gaps such as
missing physical input provenance and schema-only WebSocket events are called
out separately rather than implied by route registration.

## Boundaries

```text
Mobile REST:       https://api.personalbmo.web.id/api/v1
Mobile WebSocket:  wss://api.personalbmo.web.id/api/v1/ws
Hardware WebSocket:wss://api.personalbmo.web.id/ws
```

Mobile must use the public HTTPS/WSS URLs. It must not use `127.0.0.1`, VPS
ports, port `3010`, candidate Compose resources, Hermes, PostgreSQL, Audio
Service, WhatsApp bridge/resolver, Spotify Web API, or the hardware socket.

The Backend owns authentication, authorization, persistence, provider calls,
and the translation between Mobile and internal services. Spotify/provider
access and refresh tokens, OAuth state, resolver/provider/session internals,
and internal service keys are server-side only. Mobile holds the BMO
application access and refresh tokens, submits the Wi-Fi password to the
Backend, and may submit `deviceCredential` for pairing if its external
provenance is resolved. Wi-Fi passwords are never returned by Backend
responses; pairing `deviceCredential` is never returned and is hashed before
persistence.

## Common contract

### Authentication

Authenticated REST requests use:

```http
Authorization: Bearer <accessToken>
```

The following Mobile inventory routes are public and do not require an access
token bearer header: `POST /api/v1/auth/register`, `POST
/api/v1/auth/login`, `POST /api/v1/auth/password/recovery/verify`, `POST
/api/v1/auth/password/recovery/reset`, and `POST /api/v1/auth/refresh`. The
avatar media route `GET /media/avatars/:fileName` is also public. Every other
route in the 82-route Mobile inventory requires a bearer access token, except
the authenticated WhatsApp QR setup routes, which are `OPERATOR_BEARER` and
`OUT_OF_SCOPE` for Mobile UI. The provider browser callback is outside the
Mobile inventory and is separately public.

The access token is short-lived. The refresh token is opaque, rotated, and is
sent only to `POST /api/v1/auth/refresh`. An invalid, expired, revoked, or
missing bearer token returns `401` with:

```json
{"error":"AUTHENTICATION_FAILED"}
```

### Request IDs

Mobile may send `X-Request-Id` containing 1–128 characters matching
`[A-Za-z0-9._:-]+`. The Backend returns the accepted or generated value in the
same response header. It is an observability identifier, not an idempotency
key.

### Errors

Validation and domain failures use this safe envelope:

```json
{"error":"ERROR_CODE","message":"safe optional message"}
```

Malformed JSON/body or Zod validation is `400 INVALID_INPUT`; authentication
failure is `401 AUTHENTICATION_FAILED`; ownership failures are normally
`404 OWNERSHIP_DENIED`; state/version conflicts are `409 CONFLICT`; rate
limits are `429 RATE_LIMITED`; unavailable providers/services are `503`.
Unexpected failures are `500 INTERNAL_ERROR`. The Backend never returns stack
traces, provider bodies, tokens, passwords, or device credentials.

### Identifiers, time, and pagination

- IDs are UUID strings unless a route explicitly says otherwise.
- Timestamps are ISO-8601 strings with an offset; production uses UTC serialization.
- Cursor responses use `nextCursor: string | null`.
- List limits are bounded by the route; the matrix records each route family.
- A retry is safe only where the route defines an idempotency key or the operation is a read.

## Authentication and account

### `POST /api/v1/auth/register` — `201`

Body, strict:

```json
{
  "email":"user@example.com",
  "password":"at-least-12-characters",
  "displayName":"Cenna",
  "dateOfBirth":"2004-05-19",
  "invitationToken":"optional-legacy-token"
}
```

`email` is normalized; `password` is 12–256 characters; `displayName` is
optional and 1–120 characters; `dateOfBirth` is required, `YYYY-MM-DD`, a real
calendar date, and not future. `invitationToken` is optional compatibility
input, not a Mobile prerequisite.

Success is `{ user: SafeUser, session: Session }`. A duplicate account is
`409 CONFLICT`.

### `POST /api/v1/auth/login` — `200`

```json
{
  "email":"user@example.com",
  "password":"password",
  "clientDeviceId":"optional-device-uuid"
}
```

`clientDeviceId` is optional and must be a UUID. Success is `{ user, session }`;
invalid credentials and malformed login input are intentionally indistinguishable
`401 AUTHENTICATION_FAILED`.

### Session object

```json
{
  "sessionId":"<uuid>",
  "accessToken":"<jwt>",
  "refreshToken":"<opaque>",
  "accessTokenExpiresAt":"<ISO-8601>",
  "refreshTokenExpiresAt":"<ISO-8601>"
}
```

### Session routes

```text
POST /api/v1/auth/refresh       body { refreshToken }                         → 200 { session }
POST /api/v1/auth/logout        bearer, no required body                      → 204
POST /api/v1/auth/logout-all    bearer, no required body                      → 204
GET  /api/v1/me                 bearer                                        → 200 { user }
```

Refresh rotates the token and revokes replay families when reuse is detected.
Logout revokes the current session; logout-all revokes all user sessions.

### Password recovery

```text
POST /api/v1/auth/password/recovery/verify
body: { email, dateOfBirth }                         → 200 { recoveryToken, expiresAt }

POST /api/v1/auth/password/recovery/reset
body: { recoveryToken, newPassword }                 → 204
```

The recovery token is opaque, single-use, hashed at rest, and expires after
the configured 600-second window. Verification is enumeration-safe and
rate-limited by IP and normalized email. Reset requires a 12–256 character
password and revokes existing sessions. This is an MVP recovery factor, not
MFA.

## User profile, avatar, and settings

`SafeUser` is exactly:

```json
{
  "id":"<uuid>",
  "email":"user@example.com",
  "displayName":"Cenna|null",
  "username":"cenna|null",
  "avatarUrl":"https://api.personalbmo.web.id/media/avatars/<uuid>.webp|null",
  "createdAt":"<ISO-8601>"
}
```

```text
PATCH /api/v1/me/profile
body: { displayName?: string|null, username?: string }       → 200 { user }
```

The body is strict and non-empty. `username` is normalized NFKC/lowercase and
must match `[a-z0-9_.]{3,30}`. Duplicate usernames return `409 CONFLICT`.

```text
POST /api/v1/me/avatar                                      → 200 { avatarUrl }
GET  /media/avatars/<uuid>.webp                             → 200 image/webp
```

Avatar upload is authenticated `multipart/form-data` with one `file`; accepted
MIME types are JPEG, PNG, and WebP; the configured maximum is 5 MiB. The server
transcodes to WebP and publishes an opaque UUID key. The GET path accepts only
that UUID plus `.webp`, returns `image/webp`, `nosniff`, and immutable caching,
and never lists directories.

User settings:

```text
GET   /api/v1/settings/user
PATCH /api/v1/settings/user
```

Body fields are optional and strict: `language` (2–16 characters),
`responseLength` (`brief|standard|detailed`), and
`automaticMemoryCandidates` (boolean). The response is:

```json
{"language":"en","responseLength":"standard","automaticMemoryCandidates":true,"timezone":"Asia/Jakarta"}
```

Personalization:

```text
GET   /api/v1/settings/personalization
PATCH /api/v1/settings/personalization
```

Fields are `baseStyleTone`, `warmth`, `enthusiasm`, `headerAndLists`, and
`emoji` (trimmed strings, max 32), `fastAnswers` (boolean), and
`customInstructions` (max 4,000). PATCH is strict and non-empty. Defaults are
`default` for the five text fields, `false` for `fastAnswers`, and an empty
custom instruction string.

Device settings:

```text
PATCH /api/v1/devices/:deviceId/settings
GET   /api/v1/settings/devices/:deviceId
PATCH /api/v1/settings/devices/:deviceId
```

Both PATCH routes call the same `SettingsService.updateDeviceSettings` service
with the same owner check and request body. They are currently registered
aliases; source and tests do not designate one as deprecated or canonical.
Mobile may use either PATCH route, while the GET route is available under the
`/settings/devices` family.

Supported fields are `displayName`, `defaultDevice`, `playbackVolume` 0–100,
`quietHours { start, end, timezone } | null`, `notificationBehavior`
(`all|important|none`), `voiceProfileId` (`prudence`), `speechSpeed` 0.85–1.15,
and `enabled`. Responses also include fixed `timezone: "Asia/Jakarta"` and
the current voice projection `{ model: "en_GB-semaine-medium", speaker:
"prudence", speakerId: 0 }`.

## Pairing and devices

There is one six-digit BMO pairing flow. There is no robot QR pairing route.
The ESP32 does not claim through `/ws`; the Mobile bearer session calls the
claim route with the approved out-of-band hardware credential.

`PAIRING_MOBILE_INPUT_SOURCE_NEEDS_REVIEW`: the current Backend source defines
the claim body and validates `hardwareId`, `deviceName`, and
`deviceCredential`, but does not define a Mobile-accessible discovery,
provisioning, BLE, QR, invitation, or device-credential handoff flow for those
values. The six-digit `code` comes from the challenge response; the other three
values must currently be supplied through an external hardware/operator
process that is not specified by this Backend contract. Do not present pairing
as a fully implementable Mobile UX until that input provenance is defined.

```text
POST /api/v1/pairing/challenges                         → 201 { pairingId, code, expiresAt }
GET  /api/v1/pairing/:pairingId                        → 200 { pairing }
POST /api/v1/pairing/:pairingId/claim                  → 201 { device }
POST /api/v1/pairing/:pairingId/revoke                 → 204
```

The challenge is a six-digit code, expires after the configured 600-second
TTL, and allows at most five failed attempts. A new challenge invalidates
previous issued challenges. Pairing status is `{ id, status, expiresAt,
attemptCount }`; status is lower-case (`issued`, `claimed`, `expired`,
`failed`, `revoked`, or `invalidated`). Claim body:

```json
{
  "code":"123456",
  "hardwareId":"<1-128 chars>",
  "deviceName":"BMO",
  "deviceCredential":"<16-256 chars, supplied out of band>"
}
```

Device routes:

```text
GET  /api/v1/devices                              → 200 { devices: SafeDevice[] }
GET  /api/v1/devices/:deviceId                    → 200 { device: SafeDevice }
POST /api/v1/devices/:deviceId/unpair             → 204
```

`SafeDevice` is `{ id, hardwareId, name, status, pairedAt, lastSeenAt }`.
Unpair revokes the device and sessions bound to it. The source does **not**
register `/api/v1/devices/:deviceId/status`; that proposed route is
`NOT_IMPLEMENTED`. Device status is exposed through the Mobile WebSocket event
when a producer has current status data.

## Wi-Fi and diagnostics

```text
GET    /api/v1/devices/:deviceId/wifi             → 200 { wifi } | null
PUT    /api/v1/devices/:deviceId/wifi             → 202 { wifi }
DELETE /api/v1/devices/:deviceId/wifi             → 204
GET    /api/v1/devices/:deviceId/logs             → 200 { logs }
GET    /api/v1/devices/:deviceId/telemetry        → 200 { telemetry }
```

Wi-Fi PUT is strict `{ ssid, password? }`: SSID is 1–32 characters; password
is optional for `OPEN`, otherwise 8–63 characters. The response never contains
the password or ciphertext and has `{ configurationId, ssid, security,
hasPassword, status, updatedAt }`. Status is `PENDING`, `DELIVERED`,
`APPLYING`, `CONNECTED`, `FAILED`, `ROLLED_BACK`, or `SUPERSEDED`. Backend
stores the password encrypted and uses latest-write-wins for non-terminal
configurations. Physical application remains `PENDING_PHYSICAL_ESP`.

`logs` accepts query `limit` 1–100, default 50. `telemetry` is the current
sanitized device projection. The physical device must never send credentials,
passwords, or provider data in logs or telemetry.

## Chat

```text
GET    /api/v1/chat/sessions
POST   /api/v1/chat/sessions
GET    /api/v1/chat/sessions/:sessionId/messages
POST   /api/v1/chat/sessions/:sessionId/messages
DELETE /api/v1/chat/sessions/:sessionId
POST   /api/v1/chat/messages/:messageId/feedback
```

Create body is strict `{ temporary?: boolean }` and returns `201 { session }`.
Session is `{ id, temporary, title, lastMessageAt, createdAt, updatedAt }`.

Message history accepts `limit` 1–100 (default 50) and an unsigned positive
64-bit `cursor`; it returns `{ messages, nextCursor }`. A message is
`{ id, sender: "user"|"assistant"|"system", text, createdAt, cursor? }`.
History is the authoritative recovery source when the WebSocket is delayed or
disconnected.

Message submission is strict:

```json
{
  "idempotencyKey":"<uuid>",
  "text":"Hello BMO",
  "speakOnDevice":false,
  "deviceId":"<optional-owned-device-uuid>"
}
```

It returns `202` with `{ userMessage, assistant: { status, operationId } }`.
The first request creates one durable operation; a retry with the same
idempotency key replays the existing operation/result. `text` is 1–16,384
characters. `speakOnDevice` defaults to `false`; `true` currently returns
`503 SERVICE_UNAVAILABLE` because physical proactive delivery is not available
to this REST path. Mobile should send `false`.

Feedback body is `{ rating: "positive"|"negative", reason?: string }`, with a
maximum 500-character reason, and returns `200 { feedback }`.

The Backend, not Mobile, calls Hermes. No Hermes URL, key, prompt-injection
boundary, provider response, or audio stream is exposed.

## Mobile WebSocket

Endpoint: `wss://api.personalbmo.web.id/api/v1/ws`.

The upgrade path must be exact and must not contain a query string. The client
sends exactly one pre-auth JSON message within 5 seconds:

```json
{"event":"authenticate","accessToken":"<accessToken>"}
```

The server verifies the JWT, active session, and expiry, then sends:

```json
{"event":"authenticated","status":"ok","userId":"<uuid>"}
```

An expired token closes with `4410 ACCESS_TOKEN_EXPIRED`; an invalid session
closes with `4403 INVALID_SESSION`; timeout or invalid pre-auth data uses
`4408 AUTHENTICATION_TIMEOUT` or `4401 AUTHENTICATION_REQUIRED`.
After authentication, an unexpected client message closes the socket rather
than becoming a command channel. Native server ping is every 60 seconds and
two missed pongs terminate the connection. Maximum WebSocket payload is 32 KiB.

On disconnect or token expiry, refresh through REST and reconnect; never send a
refresh token over WebSocket. The server permits multiple sockets for a user.

Server event schemas are defined exactly in `mobile-events.ts` and summarized
below. This stream carries bounded status/events, not token-by-token LLM text
and not audio. Each event has an evidence label:

- `RUNTIME_PROTOCOL`: `authenticate` and `authenticated` are required socket
  lifecycle messages.
- `RUNTIME_EMITTED`: `chat_thinking`, `chat_message`,
  `proactive_delivery_status`, `schedule_status`, and
  `whatsapp_notification` have direct current `sendToUser` emitters.
- `SCHEMA_DEFINED_NO_CURRENT_EMITTER`: `device_status`,
  `voice_processing_status`, `wifi_configuration_status`,
  `integration_status`, and `notification` are strict forward-compatible
  schemas with no direct current `sendToUser` emitter found. Mobile may accept
  them defensively, but must not require them for current UX; use REST state and
  reconnect reads as the fallback.

```json
{"event":"chat_thinking","sessionId":"<uuid>","messageId":"<uuid>"}
```

```json
{"event":"chat_message","sessionId":"<uuid>","message":{"id":"<uuid>","sender":"assistant","text":"…","createdAt":"<ISO-8601>"}}
```

```json
{"event":"device_status","deviceId":"<uuid>","online":true,"lastSeenAt":"<ISO-8601>","wifi":{"connected":true,"rssi":-57},"battery":{"supported":false,"percent":null}}
```

`voice_processing_status` has `deviceId`, `requestId`, status
`thinking|audio_ready|completed|failed`, and nullable `errorCode`.
`wifi_configuration_status` has `deviceId`, `configurationId`, status
`PENDING|DELIVERED|APPLYING|CONNECTED|FAILED|ROLLED_BACK|SUPERSEDED`, and
nullable `errorCode`.
`proactive_delivery_status` has `deviceId`, `deliveryId`, source
`CHAT|SCHEDULE|WHATSAPP`, status
`PENDING|READY|DELIVERING|DELIVERED|FAILED|EXPIRED|MISSED`, and nullable
`errorCode`.
`schedule_status` has `scheduleId`, nullable `runId`, status
`ACTIVE|PAUSED|CANCELLED|COMPLETED`, and status label
`MONITORING|WEEKLY|PAUSED|COMPLETED`.
`integration_status` has integration `whatsapp|spotify` and status
`CONNECTED|DISCONNECTED|PENDING|ERROR|RECONNECT_REQUIRED`.
`notification` has `id`, type `GENERIC`, bounded `title`/`body`, and
`createdAt`. `whatsapp_notification` has `conversationId`, `displayName`,
`conversationType` (`DM|GROUP`), and `receivedAt`; it never contains message
body, phone number, JID, QR data, session data, or credentials.

The two chat events, `proactive_delivery_status`, `schedule_status`, and
`whatsapp_notification` are `RUNTIME_EMITTED`. The other outbound schemas in
this section are `SCHEMA_DEFINED_NO_CURRENT_EMITTER`; they are not promises of
current runtime delivery. Mobile should implement forward-compatible handlers
but use REST state and reconnect reads as the required fallback.

Event delivery is best effort. REST state, especially chat history, is the
source of truth.

## Memory

```text
GET/PATCH /api/v1/settings/memory
GET       /api/v1/memories
GET       /api/v1/memories/:id
PATCH     /api/v1/memories/:id
DELETE    /api/v1/memories/:id
GET       /api/v1/memory-candidates
POST      /api/v1/memory-candidates/:id/accept
POST      /api/v1/memory-candidates/:id/reject
POST      /api/v1/memories/forget-topic
POST      /api/v1/memories/clear-all
POST      /api/v1/memories/export
GET       /api/v1/memory/summary
POST      /api/v1/memory/summary/regenerate
POST      /api/v1/memory/summary/feedback
```

Memory settings body is `{ automaticMemoryCandidates: boolean }`.
Memory lists accept `limit` 1–100 (default 25) and an opaque cursor. Memory
records expose `id, topic, category, content, importance, source, expiresAt,
createdAt, updatedAt`; candidates expose `id, sourceMessageId, proposedContent,
topic, status, expiresAt, reviewedAt, createdAt`.

Mutating memory routes require an `idempotencyKey` (1–128 characters). PATCH
memory also accepts optional `topic`, `category`, `normalizedContent`,
`importance` 1–100, and nullable `expiresAt`. Accept may override category,
importance, and expiry. Forget-topic requires `topic`; summary feedback
requires `feedback` up to 500 characters. Delete may take the key in the body
or `Idempotency-Key` header; conflicting values are invalid. Clear/forget
responses contain sanitized counts. Export returns JSON containing active
memories, pending candidates, actions, topic-forgets, and summary.

Summary GET returns `{ summary: object | null }`. Regeneration returns `202`
with a durable `generation` result whose current runtime status is
`not_configured`; it does not claim an external summarizer exists.

## Schedules

```text
GET    /api/v1/schedules
POST   /api/v1/schedules
GET    /api/v1/schedules/:id
PATCH  /api/v1/schedules/:id
POST   /api/v1/schedules/:id/pause
POST   /api/v1/schedules/:id/resume
DELETE /api/v1/schedules/:id
GET    /api/v1/schedule-runs
```

Create is one of these strict shapes:

```json
{"prompt":"Stand up","frequency":"Daily","every":1,"timeOfDay":"Morning","deliveryTargets":["MOBILE"]}
```

```json
{"prompt":"Stand up","frequency":"Weekly","every":1,"repeatDay":"Thursday","days":["Thursday"],"timeOfDay":"Morning","deliveryTargets":["DEVICE"],"deviceId":"<uuid>"}
```

```json
{"prompt":"Stand up","frequency":"Once","every":1,"date":"2026-08-20","timeOfDay":"Morning","deliveryTargets":["MOBILE"]}
```

Common fields are `prompt` 1–1,000 characters, `every` 1–365,
`timeOfDay` (`Morning|Afternoon|Evening`), and one or two unique delivery
targets (`DEVICE|MOBILE`). `DEVICE` requires exactly one owned `deviceId`;
`MOBILE` does not fabricate a device. Weekly requires `repeatDay` and unique
`days` containing it; once requires a valid calendar `date`.

All schedule writes return the serialized schedule, usually wrapped as
`{ schedule }`, and emit `schedule_status`. PATCH/pause/resume/delete require
the current positive `version`; stale or terminal mutations return `409
CONFLICT`. DELETE is a durable `CANCELLED` transition, not a purge. Lists use
limit 1–100 (default 50) and an ISO-timestamp/UUID cursor. Runs can filter by
`scheduleId` and return `{ runs, nextCursor }`.

Durable states are `ACTIVE|PAUSED|CANCELLED|COMPLETED`; `MONITORING` and
`WEEKLY` are presentation labels. The timezone is fixed to `Asia/Jakarta`.

## WhatsApp

Mobile uses only these authenticated Backend routes:

```text
POST  /api/v1/integrations/whatsapp/connect          → 202 connection
GET   /api/v1/integrations/whatsapp/status           → connection
GET   /api/v1/integrations/whatsapp/conversations   → page
GET   /api/v1/integrations/whatsapp/conversations/:id → conversation
POST  /api/v1/integrations/whatsapp/conversations/resolve → conversation
GET   /api/v1/integrations/whatsapp/notification-rules → { rules }
PATCH /api/v1/integrations/whatsapp/notification-rules → { rules }
POST  /api/v1/integrations/whatsapp/send-preview     → 201 { send }
POST  /api/v1/integrations/whatsapp/send-confirm     → { send }
POST  /api/v1/integrations/whatsapp/disconnect       → 204
```

`POST /integrations/whatsapp/connect` asks the Backend to begin or inspect the
server-side provider connection. Its source response is `{ connection, blocked
}`; the connection projection may indicate `PENDING`, `CONNECTED`, or an error
state, while `blocked: true` means provider/operator setup is not complete.
Mobile should show the returned status and poll `GET
/integrations/whatsapp/status` for changes. It must not expose a QR flow or call
`/whatsapp/qr` / `/whatsapp/confirm-scanned`; those are operator-only setup
surfaces and remain `OUT_OF_SCOPE` for Mobile UI.

Connection is `{ provider, status, connectedAt, scopes }`. Conversation lists
use `limit` 1–100 (default 50) and a timestamp/UUID cursor and expose only
`id, displayName, type, notificationEnabled, lastActivityAt`.
Resolve body is `{ phoneNumber, displayName? }`; the number is normalized as
an international number and is never returned. Rules are 1–100 strict entries
with scope `ALL|CONTACT|GROUP`, optional conversation UUID for non-ALL rules,
`enabled`, and `speakOnDevice`.

Preview body is `{ conversationId, message, idempotencyKey }`, with a 1,000
character message and a 1–128 character key. Confirm body is
`{ requestId: UUID, confirmed: true }`; confirmation expires on the server.
The send projection contains `id, conversationId, preview, status,
confirmationExpiresAt, errorCode`.

`/whatsapp/qr` and `/whatsapp/confirm-scanned` are registered authenticated
operator setup surfaces, not Mobile UI features. Mark them `OUT_OF_SCOPE` for
Mobile. Mobile never calls bridge `/health`, `/messages`, `/send`, the resolver,
Hermes, or any provider/session path. WhatsApp provider/runtime availability is
an independent `BLOCKED` or connected state; route registration is not proof of
real-world delivery.

## Spotify

The production callback is exactly:

`https://api.personalbmo.web.id/api/v1/integrations/spotify/callback`

It is already registered provider-side. Mobile does not call the callback;
Mobile starts OAuth through the Backend:

```text
POST /api/v1/integrations/spotify/connect       → 200 { authorizationUrl }
GET  /api/v1/integrations/spotify/status        → connection
GET  /api/v1/integrations/spotify/search        → { results }
GET  /api/v1/integrations/spotify/devices       → { devices }
GET  /api/v1/integrations/spotify/active-device → { device }
GET  /api/v1/integrations/spotify/playback      → { playback }
PUT  /api/v1/integrations/spotify/preferred-device → { device }
POST /api/v1/integrations/spotify/actions       → 202 { action }
POST /api/v1/integrations/spotify/disconnect    → 204
```

Spotify connection lifecycle:

1. Mobile calls `POST /api/v1/integrations/spotify/connect` with its bearer
   token and receives `authorizationUrl`; the URL is opened in the device's
   system browser/authentication surface.
2. Spotify redirects the browser to the Backend callback. The callback is a
   public provider browser route, consumes the single-use server-side OAuth
   state, exchanges the code, stores encrypted provider credentials, and
   returns the plain text response `Spotify connection completed. You may
   return to BMO.` on success. Denial or invalid state is returned as an HTTP
   error; no Mobile deep-link callback is registered in the current source.
3. The user returns to the Mobile app through the browser/app switcher. Mobile
   then polls `GET /api/v1/integrations/spotify/status`; this REST projection
   is the authoritative completion signal. Do not depend on
   `integration_status`: its schema exists, but there is no direct current
   `sendToUser` emitter.
4. `CONNECTED` means the server-side credential lifecycle completed.
   `DISCONNECTED` means no connection is present. `RECONNECT_REQUIRED` means
   the server invalidated or wiped unusable credentials, such as after
   `invalid_grant`; Mobile should offer the connect flow again. Provider or
   configuration failures remain visible through the status/error response and
   should not be treated as successful linking.

Search query is `q` 1–200 characters and optional comma-separated `type` values
from `track,artist,album,playlist`. Preferred-device body is
`{ deviceId: string | null }`.

Action body is strict `{ action, idempotencyKey, payload?, confirmed? }`.
Actions are `PLAY`, `PLAY_TRACK`, `PLAY_ARTIST`, `PLAY_ALBUM`, `PLAY_PLAYLIST`,
`PAUSE`, `RESUME`, `NEXT`, `PREVIOUS`, `TRANSFER`, `SEEK`, `VOLUME`, `SHUFFLE`,
`REPEAT`, and `SEARCH`. Payload keys are action-specific and bounded to four
keys/1,000 bytes. URIs must be typed Spotify URIs; seek is 0–86,400,000 ms;
volume is 0–100; repeat is `track|context|off`; shuffle is boolean.
Actions are idempotent by user/idempotency key and may require
`confirmed: true` before execution. Results contain only BMO action status,
result/error codes, and expiry metadata.

Provider access/refresh tokens and OAuth state remain server-side. Spotify
audio plays on Spotify Connect devices, never through the BMO speaker or Audio
Service. A missing usable device is reported as `NO_ACTIVE_DEVICE`, not fake
success. Provider actions remain subject to provider/account availability.

## Plugins and bug reports

```text
GET  /api/v1/plugins                  → 200 { items }
POST /api/v1/support/bug-reports      → 201 { id, status: "received" }
```

The plugin catalog is a safe WhatsApp/Spotify application projection. Bug
reports are authenticated multipart requests with fields `category` (default
`GENERAL`, max 64), `description` (max 4,000), optional `context` (max 4,000),
and `includeScreenshot` (`true|false`); up to five `screenshots` files are
accepted, with a 5 MiB per-file Multer limit. Stored files and internal keys
are never returned.

## Explicit non-goals

The source does not register `POST /api/v1/voice/preview`; it is
`NOT_IMPLEMENTED`. Mobile text chat is the current Mobile voice-adjacent
surface. The physical device continues to use raw-WAV `/api/v1/voice`, MP3
delivery, and `/ws`. There is no Mobile audio WebSocket, token streaming,
provider-token projection, direct Hermes API, direct Spotify API, direct
WhatsApp API, or robot QR pairing.
