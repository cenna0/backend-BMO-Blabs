# BMO Mobile ↔ Backend API Service Contract

**Version:** 2.0.0
**Date:** 2026-08-11
**Base path:** `/api/v1`
**Timezone:** `Asia/Jakarta`

**Contract state:** `READY_TO_IMPLEMENT` except surfaces explicitly marked otherwise. This is the Phase 2 target contract, not a claim that all routes are registered or public today.

This document defines the **Backend API service** surface the mobile app should consume. In the wider project, “backend” means the entire VPS platform; this file intentionally covers only the mobile-facing API service contract.

## Audited current availability

At freeze SHA `d638b20c381c676136c94524a38a1def5d70e565`:

- P9.1 source/private candidate implements invitation-based register, login, refresh, logout, logout-all, `/me`, four six-digit pairing routes, device list/detail/unpair, and user/device settings;
- those P9.1 routes are not enabled in the production Backend API service and return `404` publicly;
- current registration still requires `invitationToken` and does not accept DOB;
- every other route in this file is absent;
- exact per-route state is authoritative in `09-ENDPOINT-EVENT-COVERAGE-MATRIX.md`.

Slice 2B source now implements the account/profile/recovery/avatar and
personalization routes in sections 2, 3, and 5. This is source and automated
review-candidate evidence plus Phase 2.5 private candidate acceptance: the
candidate now runs the migrated Phase 2 image on its isolated DB, while public
production remains unchanged. The live-provider and physical-ESP limitations
remain as recorded in the matrix.

The earlier freeze wording in this section is historical entry-state evidence.
The current candidate identity, migration, runtime, and acceptance result are
authoritative in `05-IMPLEMENTATION-STATUS.md`.

`EXISTING_VERIFIED` in the matrix means verified at the stated availability tier; it does not imply public availability.

---

# 1. Global conventions

## Authentication

Authenticated REST requests:

```http
Authorization: Bearer <accessToken>
```

Access token remains short-lived. Refresh token remains opaque and rotated.

## Request IDs

Client may send:

```http
X-Request-Id: <safe-string>
```

Backend should echo it when present.

## Errors

```json
{
  "error": "ERROR_CODE",
  "message": "safe optional message"
}
```

Never leak stack traces, provider secrets, device tokens, Wi-Fi passwords, refresh tokens, or internal provider bodies.

---

# 2. Authentication

## 2.1 Register

### `POST /api/v1/auth/register`

This integration changes the Phase 2 product path from current invitation-required registration to self-service email/password registration. Invitation tables/operator tooling may remain, but mobile registration must not require an invitation.

Request:

```json
{
  "email": "user@example.com",
  "password": "minimum 12 characters",
  "displayName": "Cenna",
  "dateOfBirth": "2004-05-19"
}
```

Rules:

- normalize email;
- unique email;
- password Argon2id;
- `dateOfBirth` required for current MVP password-recovery flow;
- date must be a valid calendar date and not future;
- do not return date of birth in the normal `SafeUser`.

Success `201`:

```json
{
  "user": {
    "id": "<uuid>",
    "email": "user@example.com",
    "displayName": "Cenna",
    "username": null,
    "avatarUrl": null,
    "createdAt": "<ISO-8601>"
  },
  "session": {
    "sessionId": "<uuid>",
    "accessToken": "<jwt>",
    "refreshToken": "<opaque>",
    "accessTokenExpiresAt": "<ISO-8601>",
    "refreshTokenExpiresAt": "<ISO-8601>"
  }
}
```

Existing invitation data/schema may be retained for backwards compatibility/ops, but `invitationToken` is not required by mobile registration.

## 2.2 Login

Preserve the existing P9.1 semantics while activating them through the production Backend API service:

```http
POST /api/v1/auth/login
```

Request:

```json
{
  "email": "user@example.com",
  "password": "..."
}
```

## 2.3 Refresh / logout

Keep existing:

```text
POST /api/v1/auth/refresh
POST /api/v1/auth/logout
POST /api/v1/auth/logout-all
GET  /api/v1/me
```

Login may populate the existing Prisma `Session.clientDeviceId` only for an
active device owned by the authenticated user. Issuance and unpair serialize on
the same per-user transaction lock, so validation and session/token creation
cannot race device revocation. Pre-pairing registration/login may keep the field
null; logout, logout-all, refresh rotation, and replay-family revocation remain
the other verified controls.

## 2.4 Forgot password using date of birth

Use a two-step reset flow so a successful date-of-birth check does not directly mutate the password.

### `POST /api/v1/auth/password/recovery/verify`

Request:

```json
{
  "email": "user@example.com",
  "dateOfBirth": "2004-05-19"
}
```

Success `200`:

```json
{
  "recoveryToken": "<short-lived-single-use-opaque-token>",
  "expiresAt": "<ISO-8601>"
}
```

Security:

- generic failure response for unknown email vs wrong date;
- aggressively rate-limit per IP + normalized email;
- recovery token TTL baseline 10 minutes;
- store only hash of recovery token;
- one-time use;
- successful password reset revokes all existing sessions.

### `POST /api/v1/auth/password/recovery/reset`

Request:

```json
{
  "recoveryToken": "<opaque>",
  "newPassword": "minimum 12 characters"
}
```

Success:

```http
204 No Content
```

This is an MVP recovery factor and must be documented as weaker than production-grade multi-factor recovery.

---

# 3. Profile

## 3.1 SafeUser

Canonical mobile-safe user:

```json
{
  "id": "<uuid>",
  "email": "user@example.com",
  "displayName": "Cenna",
  "username": "cenna",
  "avatarUrl": "https://api.personalbmo.web.id/media/avatars/<opaque-id>.webp",
  "createdAt": "<ISO-8601>"
}
```

Do not add phone or subscription fields in this scope.

## 3.2 Update profile

```http
PATCH /api/v1/me/profile
```

Partial request:

```json
{
  "displayName": "Cenna",
  "username": "cenna"
}
```

Rules:

- username normalized case-insensitively;
- unique;
- allowed baseline: `a-z`, `0-9`, `_`, `.`;
- length baseline 3–30.

## 3.3 Avatar

```http
POST /api/v1/me/avatar
Content-Type: multipart/form-data
```

Field:

```text
file
```

Baseline:

- JPEG/PNG/WebP;
- max 5 MB;
- transcode/store as safe image type where practical;
- opaque filename;
- no user-controlled filesystem path;
- persistent VPS media directory;
- no directory listing.

Return:

```json
{
  "avatarUrl": "https://api.personalbmo.web.id/media/avatars/<opaque-id>.webp"
}
```

Avatar retrieval uses the URL returned by the API:

```http
GET /media/avatars/:opaqueId.webp
```

This route is intentionally outside `/api/v1`, serves only a transcoded safe
image by opaque identifier, and must not expose directory listing or an
original user filename.

---

# 4. User settings

Preserve the existing P9.1 fields and semantics when these candidate-only routes are integrated into production:

```text
GET   /api/v1/settings/user
PATCH /api/v1/settings/user
```

Existing fields remain:

```text
language
responseLength
automaticMemoryCandidates
timezone (server-enforced in response)
```

---

# 5. Personalization

```text
GET   /api/v1/settings/personalization
PATCH /api/v1/settings/personalization
```

Response/body shape:

```json
{
  "baseStyleTone": "default",
  "warmth": "default",
  "enthusiasm": "default",
  "headerAndLists": "default",
  "emoji": "default",
  "fastAnswers": false,
  "customInstructions": ""
}
```

Rules:

- strict body;
- bounded strings;
- custom instructions max baseline 4000 chars;
- Backend owns persistence;
- a later chat/voice slice will apply allowed personalization to Hermes context;
- user custom instructions cannot override system/security rules.

Slice 2B owns strict persistence and retrieval only; Hermes context integration
is not present yet.

No ESP32 protocol change is required.

---

# 6. Pairing — existing 6-digit flow

Preserve the actual implemented P9.1 route contract and align mobile to it:

```text
POST /api/v1/pairing/challenges
GET  /api/v1/pairing/:pairingId
POST /api/v1/pairing/:pairingId/claim
POST /api/v1/pairing/:pairingId/revoke
```

Expected mobile flow:

```text
authenticated mobile user
→ POST /pairing/challenges
→ show 6-digit code
→ authenticated owner submits the claim route with the pairing ID, code, hardware identity/name, and existing device credential obtained through the approved out-of-band hardware handoff
→ mobile polls GET /pairing/:pairingId
→ claimed device appears in /devices
```

The frozen current claim body is:

```json
{
  "code": "123456",
  "hardwareId": "<must equal the physical device_id used by /ws>",
  "deviceName": "BMO",
  "deviceCredential": "<existing out-of-band credential>"
}
```

All four current pairing routes require a mobile bearer session. The ESP does not currently claim a pairing over `/ws`. Phase 2 must not invent or expose a new device credential in the mobile UI; it must either use the approved out-of-band handoff or add a separately reviewed device-side claim flow.

Current claim validation is also frozen for regression: `hardwareId` is 1–128
characters after non-empty trimming, `deviceName` is 1–120, and
`deviceCredential` is 16–256 characters.

Rules:

- use the **actual current TypeScript implementation** as route/field truth if older docs disagree;
- do not silently change device credential semantics while current physical pairing is still being debugged;
- preserve TTL/rate-limit/attempt behavior already implemented;
- pairing regression is P0 because current hardware integration depends on it.

---

# 7. Devices

Preserve the existing P9.1 routes when they are integrated into production:

```text
GET   /api/v1/devices
GET   /api/v1/devices/:deviceId
GET   /api/v1/settings/devices/:deviceId
PATCH /api/v1/settings/devices/:deviceId
POST  /api/v1/devices/:deviceId/unpair
```

## Device status

```http
GET /api/v1/devices/:deviceId/status
```

Response:

```json
{
  "deviceId": "<uuid>",
  "online": true,
  "statusLabel": "Online",
  "lastSeenAt": "<ISO-8601>",
  "wifi": {
    "connected": true,
    "rssi": -57,
    "label": "Good"
  },
  "battery": {
    "supported": false,
    "percent": null
  }
}
```

`battery.supported=false` until hardware confirms reliable telemetry.

---

# 8. Wi-Fi configuration

Backend owns the persisted remote Wi-Fi configuration lifecycle.

## Read metadata

```http
GET /api/v1/devices/:deviceId/wifi
```

Never return plaintext password.

Response:

```json
{
  "configurationId": "<uuid>|null",
  "ssid": "Home WiFi",
  "security": "OPEN|WPA_PSK",
  "hasPassword": true,
  "status": "PENDING|DELIVERED|APPLYING|CONNECTED|FAILED|ROLLED_BACK|SUPERSEDED",
  "updatedAt": "<ISO-8601>"
}
```

## Create/update configuration

```http
PUT /api/v1/devices/:deviceId/wifi
```

Password is optional for open networks.

Request protected network:

```json
{
  "ssid": "Home WiFi",
  "password": "secret"
}
```

Open network:

```json
{
  "ssid": "Cafe Guest"
}
```

Behavior:

1. validate owner/device;
2. encrypt password at rest, do not hash it;
3. save a new versioned configuration;
4. use **latest-write-wins** for non-terminal pending configurations: a newer configuration supersedes an older unsent/pending configuration;
5. if ESP32 is online/authenticated and bound to the application device, deliver the additive device event;
6. if offline, leave the latest configuration pending and deliver after reconnect;
7. return status.

The encrypted password may be retained after successful connection because this release explicitly supports changing/re-applying device Wi-Fi from the app. It must never be returned by GET endpoints or logs.

Success:

```json
{
  "configurationId": "<uuid>",
  "status": "PENDING"
}
```

## Forget remote stored config

```http
DELETE /api/v1/devices/:deviceId/wifi
```

This removes Backend's stored configuration only after applying appropriate product rules. It must not silently factory-reset the device.

---

# 9. Chat

Backend is the authority. Mobile must never call Hermes directly.

## REST

```text
GET    /api/v1/chat/sessions
POST   /api/v1/chat/sessions
GET    /api/v1/chat/sessions/:sessionId/messages
POST   /api/v1/chat/sessions/:sessionId/messages
DELETE /api/v1/chat/sessions/:sessionId
POST   /api/v1/chat/messages/:messageId/feedback
```

Create session:

```json
{
  "temporary": false
}
```

Send message:

```json
{
  "idempotencyKey": "<client-uuid>",
  "text": "Halo BMO",
  "speakOnDevice": false,
  "deviceId": "<optional paired device uuid>"
}
```

`speakOnDevice` defaults to `false`. This prevents normal mobile chat from unexpectedly making the physical robot speak. Mobile may explicitly set it to `true`.

First valid submission returns `202 Accepted` after the user message/idempotency record is safely created:

```json
{
  "userMessage": {
    "id": "<uuid>",
    "sender": "user",
    "text": "Halo BMO",
    "createdAt": "<ISO-8601>"
  },
  "assistant": {
    "status": "processing",
    "operationId": "<uuid>"
  }
}
```

A retry with the same idempotency key must return the existing operation/result instead of generating a second Hermes response.

Backend flow:

```text
authenticate
→ validate ownership
→ persist user message + idempotency state
→ HTTP 202
→ emit chat_thinking
→ assemble chat + memory + settings context
→ Hermes internal call
→ persist assistant message
→ emit chat_message
→ optionally synthesize proactive audio
→ queue/deliver to physical BMO
```

If the mobile WebSocket is unavailable, the app recovers through `GET .../messages`; realtime delivery is an optimization, not the only source of truth.

Do not expose Hermes URL/key.

---

# 10. Mobile realtime WebSocket

Endpoint:

```text
WSS /api/v1/ws
```

Mobile opens the socket, then authenticates within 5 seconds:

```json
{
  "event": "authenticate",
  "accessToken": "<accessToken>"
}
```

Success:

```json
{
  "event": "authenticated",
  "status": "ok",
  "userId": "<uuid>"
}
```

Do not put access tokens in the URL query string.

Baseline heartbeat:

- server native ping every 60 seconds;
- reconnect on disconnect;
- re-authenticate on reconnect.

Mobile realtime events:

```text
chat_thinking
chat_message
device_status
voice_processing_status
wifi_configuration_status
proactive_delivery_status
schedule_status
integration_status
notification
```

This is **event streaming**, not token-by-token assistant text streaming and not audio streaming.

Example:

```json
{
  "event": "chat_thinking",
  "sessionId": "<uuid>",
  "messageId": "<uuid>"
}
```

```json
{
  "event": "chat_message",
  "sessionId": "<uuid>",
  "message": {
    "id": "<uuid>",
    "sender": "assistant",
    "text": "Hi!",
    "createdAt": "<ISO-8601>"
  }
}
```


Physical-device voice status may be mirrored to mobile without exposing the device audio URL:

```json
{
  "event": "voice_processing_status",
  "deviceId": "<device uuid>",
  "requestId": "<voice request uuid>",
  "status": "thinking|audio_ready|completed|failed",
  "errorCode": null
}
```

Mobile does not receive the ESP32 device token and does not need the ephemeral MP3 URL merely to display status.

Access-token expiry rule:

- the mobile socket is valid only while the authenticated access token is valid;
- at/after token expiry the server closes the mobile socket with an auth-specific close code;
- mobile refreshes through the existing REST refresh endpoint, reconnects, and authenticates again;
- refresh tokens are never sent over WebSocket.

Additional event shapes:

```json
{
  "event": "device_status",
  "deviceId": "<uuid>",
  "online": true,
  "lastSeenAt": "<ISO-8601>",
  "wifi": { "connected": true, "rssi": -57 },
  "battery": { "supported": false, "percent": null }
}
```

```json
{
  "event": "wifi_configuration_status",
  "deviceId": "<uuid>",
  "configurationId": "<uuid>",
  "status": "PENDING|DELIVERED|APPLYING|CONNECTED|FAILED|ROLLED_BACK|SUPERSEDED",
  "errorCode": null
}
```

```json
{
  "event": "proactive_delivery_status",
  "deviceId": "<uuid>",
  "deliveryId": "<uuid>",
  "source": "CHAT|SCHEDULE|WHATSAPP",
  "status": "PENDING|READY|DELIVERING|DELIVERED|FAILED|EXPIRED|MISSED",
  "errorCode": null
}
```

```json
{
  "event": "schedule_status",
  "scheduleId": "<uuid>",
  "runId": "<uuid>|null",
  "status": "ACTIVE|PAUSED|CANCELLED|COMPLETED",
  "statusLabel": "MONITORING|WEEKLY|PAUSED|COMPLETED"
}
```

```json
{
  "event": "integration_status",
  "integration": "whatsapp|spotify",
  "status": "CONNECTED|DISCONNECTED|PENDING|ERROR"
}
```

```json
{
  "event": "notification",
  "id": "<uuid>",
  "type": "GENERIC",
  "title": "BMO",
  "body": "Safe bounded text",
  "createdAt": "<ISO-8601>"
}
```

Mobile WebSocket close behavior:

```text
4401 AUTHENTICATION_REQUIRED
4403 INVALID_SESSION
4408 AUTHENTICATION_TIMEOUT
4410 ACCESS_TOKEN_EXPIRED
```

Authentication must arrive within 5 seconds. Mobile WS JSON messages are bounded (baseline 32 KB).

Mobile WebSocket is not the device voice WebSocket.

---

# 11. Memory

Implement Backend-owned memory APIs consistent with existing P9 docs:

```text
GET/PATCH /api/v1/settings/memory

GET    /api/v1/memories
GET    /api/v1/memories/:id
PATCH  /api/v1/memories/:id
DELETE /api/v1/memories/:id

GET    /api/v1/memory-candidates
POST   /api/v1/memory-candidates/:id/accept
POST   /api/v1/memory-candidates/:id/reject

POST   /api/v1/memories/forget-topic
POST   /api/v1/memories/clear-all
POST   /api/v1/memories/export

GET    /api/v1/memory/summary
POST   /api/v1/memory/summary/regenerate
POST   /api/v1/memory/summary/feedback
```

ESP32 is not a memory authority and requires no change.

---

# 12. Schedules

REST:

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

Backend scheduler uses `Asia/Jakarta`.

Create/update schedule uses the current mobile requirement vocabulary:

```json
{
  "prompt": "Remind me to stand up",
  "frequency": "Weekly",
  "every": 1,
  "repeatDay": "Thursday",
  "days": ["Thursday"],
  "timeOfDay": "Morning",
  "date": "2026-08-15",
  "deliveryTargets": ["DEVICE"]
}
```

Backend normalizes this into its scheduler model and server-enforces `Asia/Jakarta`.

The source implementation maps the bounded presentation periods to local clock
times as `Morning=09:00`, `Afternoon=13:00`, and `Evening=18:00`. Mutation
requests include the current positive `version`; stale PATCH/pause/resume/delete
requests fail with `409 CONFLICT`. `MOBILE` occurrences are durable delivery
intents without a fabricated device ID; the device-scoped
`proactive_delivery_status` event is emitted only for `DEVICE` delivery rows.

Durable schedule status is:

```text
ACTIVE
PAUSED
CANCELLED
COMPLETED
```

The following are presentation labels only; `WEEKLY` is derived from recurrence and is not stored as a lifecycle state:

```text
MONITORING
WEEKLY
PAUSED
COMPLETED
```

Delivery targets are explicit:

```text
DEVICE
MOBILE
```

Device speech uses the generic proactive-delivery contract in `02-BACKEND-DEVICE-ADDITIVE-CONTRACT.md`.

---

# 13. WhatsApp personal-account connector

WhatsApp is a BMO integration/action surface. The user pairs their personal
WhatsApp account; there is no separate BMO bot number. Mobile talks only to
these authenticated BMO routes and never to Hermes, Baileys, `/messages`,
`/send`, raw JIDs, session paths, or provider credentials.

## Connection

```text
GET  /api/v1/integrations/whatsapp/status
POST /api/v1/integrations/whatsapp/disconnect
```

Response:

```json
{
  "provider": "whatsapp",
  "status": "CONNECTED|DISCONNECTED|PENDING|ERROR",
  "connectedAt": "ISO_TIMESTAMP|null",
  "scopes": []
}
```

The QR/connect routes remain operator/provider setup surfaces and are not
needed by the mobile conversation UI.

## Conversations and recipients

```text
GET  /api/v1/integrations/whatsapp/conversations?limit=50&cursor=...
GET  /api/v1/integrations/whatsapp/conversations/:conversationId
POST /api/v1/integrations/whatsapp/conversations/resolve
```

All require the bearer token. The list response is:

```json
{
  "conversations": [
    {
      "id": "BMO_UUID",
      "displayName": "Rangga",
      "type": "DM",
      "notificationEnabled": true,
      "lastActivityAt": "ISO_TIMESTAMP"
    }
  ],
  "nextCursor": "ISO_TIMESTAMP|BMO_UUID|null"
}
```

Groups use `"type":"GROUP"` and are notification-disabled by default. The
Backend builds this traffic-derived index from observed messages and sends;
it does not import the complete WhatsApp address book or history. To create or
reuse a DM that has not yet been observed:

```json
POST /api/v1/integrations/whatsapp/conversations/resolve
{
  "phoneNumber": "<E.164_PHONE>",
  "displayName": "Rangga"
}
```

The response is one safe conversation object. Phone identity is normalized and
mapped to the provider destination only on the server; the response never
contains the phone number or JID. Invalid input returns `INVALID_INPUT` (400),
and a foreign/malformed conversation returns `OWNERSHIP_DENIED` (404).

For DM identity reconciliation, Backend keeps a private provider-alias index
for every explicit provider reference observed for the owner-scoped
conversation. This allows a phone-JID resolve and a Baileys LID/chat alias to
converge when the bridge exposes both references. If the official bridge emits
only an opaque LID with no phone alias, Backend does not guess from a display
name or message text; it keeps the event conservative until an explicit
provider/operator mapping is available. Alias rows never appear in Mobile
responses.

## Notification rules

```text
GET   /api/v1/integrations/whatsapp/notification-rules
PATCH /api/v1/integrations/whatsapp/notification-rules
```

The patch replaces the authenticated user's WhatsApp rule set:

```json
{
  "rules": [
    { "scope": "ALL", "enabled": true, "speakOnDevice": false },
    { "scope": "CONTACT", "conversationId": "BMO_UUID", "enabled": false, "speakOnDevice": false },
    { "scope": "GROUP", "conversationId": "BMO_UUID", "enabled": true, "speakOnDevice": false }
  ]
}
```

`ALL` is the DM default; `CONTACT` overrides one DM; `GROUP` is disabled
unless explicitly enabled. No raw provider target is accepted. Transport
ingestion continues for muted/unknown contacts and groups; only notification
and optional generic proactive speech are suppressed. Notification filtering
is PostgreSQL/BMO application state, not the Hermes transport allowlist.

## Send/reply

```text
POST /api/v1/integrations/whatsapp/send-preview
POST /api/v1/integrations/whatsapp/send-confirm
```

Preview request:

```json
{
  "conversationId": "BMO_UUID",
  "message": "Gw telat 10 menit",
  "idempotencyKey": "wa-send-1"
}
```

The preview/confirm response contains `id`, `conversationId`, `preview`,
`status`, `confirmationExpiresAt`, and nullable `errorCode`. The Backend checks
ownership, resolves the server-side provider mapping, calls the official
bridge `/send`, and persists an outbound delivery. Mobile never supplies or
receives a JID. Natural-language commands such as “bales Rangga ...” must first
be authenticated as a BMO chat/voice action and then use this explicit
allowlisted send boundary.

## Inbound data and realtime event

The dedicated official Hermes Baileys bridge feeds the Backend's sole
destructive `GET /messages` consumer. Each supported event is validated,
classified as DM/GROUP, indexed, and persisted only as bounded BMO routing and
delivery metadata; message bodies are not mirrored into the WhatsApp index.
Incoming WhatsApp text is `UNTRUSTED_MESSAGE_DATA`: it never becomes a Hermes
prompt, tool request, privileged action, or automatic reply. Only an
authenticated BMO user action can authorize tools or send/reply.

When the notification rule permits, mobile receives this metadata-only event
on `/api/v1/ws`:

```json
{
  "event": "whatsapp_notification",
  "conversationId": "BMO_UUID",
  "displayName": "Rangga",
  "conversationType": "DM",
  "receivedAt": "ISO_TIMESTAMP"
}
```

It contains no body preview, phone number, raw JID, session identifier, QR,
token, or credential. Official owner-forward events, where enabled, update
bounded conversation activity only and do not create duplicate notifications
for Backend `/send` echoes. Full history sync, media, typing/read receipts,
and address-book import are outside MVP. For duplicate provider aliases,
Backend keeps the conversation with an explicit notification rule, then uses
earliest creation time and BMO UUID as deterministic tie-breakers; deliveries
and send requests move to that winner. The bridge queue is in-memory and
destructive, so WhatsApp delivery is not durable or replayable.

## Runtime boundary

The unchanged Hermes 0.20.0 bridge is private at `http://127.0.0.1:3001` and
runs as the personal-account transport with `--mode bot`; `bot` is transport
semantics, not product identity. `hermes-gateway.service` remains separate with
`WHATSAPP_ENABLED=false` and does not consume this queue. `bmo-whatsapp-bridge.service`
runs as `hermes`, has bounded crash restart, and is independent of the shared
Hermes gateway. `WHATSAPP_GROUP_POLICY` is not the security enforcement layer;
Backend classification and ownership rules are authoritative.

Do not implement Telegram/SMS plugins.

---

# 14. Spotify

Priority integration.

Implement existing P9 planned contract:

```text
POST /api/v1/integrations/spotify/connect
GET  /api/v1/integrations/spotify/status
POST /api/v1/integrations/spotify/disconnect
GET  /api/v1/integrations/spotify/devices
GET  /api/v1/integrations/spotify/playback
POST /api/v1/integrations/spotify/actions
GET  /api/v1/integrations/spotify/callback
```

Phase 2.6 extends the candidate-only Spotify read/action surface with:

```text
GET /api/v1/integrations/spotify/search?q=<bounded-query>&type=track,artist,album,playlist
GET /api/v1/integrations/spotify/active-device
```

The allowlisted action boundary additionally covers explicit track/artist/
album/playlist playback, transfer/select device, seek, volume, shuffle, repeat,
queue, and natural-language query resolution. Search results are normalized;
provider tokens and raw provider payloads never enter mobile responses.

OAuth callback is server-side and authenticated by exact redirect + single-use OAuth state, not by a mobile bearer token. Mobile must not store Spotify access/refresh tokens. The current server-side Authorization Code flow is the frozen default because the Backend can protect the client secret; if code exchange moves into mobile, PKCE requires a separate contract change.

Spotify music plays on the user's Spotify device, not the BMO speaker.

---

# 15. Plugin catalog

Only two plugins:

```text
whatsapp
spotify
```

```http
GET /api/v1/plugins
```

Example:

```json
{
  "items": [
    {
      "id": "whatsapp",
      "title": "WhatsApp",
      "installed": true,
      "status": "CONNECTED"
    },
    {
      "id": "spotify",
      "title": "Spotify",
      "installed": false,
      "status": "DISCONNECTED"
    }
  ]
}
```

---

# 16. Bug reports

```http
POST /api/v1/support/bug-reports
Content-Type: multipart/form-data
```

Fields:

```text
description
includeScreenshot
screenshots[] (max 5)
```

Store reports in PostgreSQL and screenshots in bounded persistent storage.

Return:

```json
{
  "id": "<uuid>",
  "status": "received"
}
```

---

# 17. Voice preview

LAST PRIORITY.

If implemented:

```http
POST /api/v1/voice/preview
```

Request:

```json
{
  "text": "Hi! BMO is ready.",
  "deviceId": "<optional>"
}
```

Must use existing TTS path, be rate-limited, create no chat/memory side effects, and return an ephemeral audio URL.

If deadline pressure remains, leave as `DEFERRED` in implementation status.


---

# 18. Explicit mobile non-goals for this release

Do not add a separate mobile microphone/voice-upload feature merely because REST can technically upload audio.

For this release:

```text
Mobile chat input = text
Physical BMO voice input = existing ESP32 raw-WAV contract
Mobile WebSocket = realtime events, not audio/token streaming
```

Any future mobile voice input requires a separate approved contract.
