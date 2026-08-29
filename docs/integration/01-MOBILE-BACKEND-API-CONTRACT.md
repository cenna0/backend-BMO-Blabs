# Joy Mobile ↔ Backend API Contract

**Version:** 3.2.0  
**Status:** `PRODUCTION_VERIFIED`  
**Deployed-Image Runtime:** `joy-p9.1:production`  
**Production Base URL:** `https://api.personalbmo.web.id`  
**REST Base Path:** `/api/v1`  
**Mobile WebSocket URL:** `wss://api.personalbmo.web.id/api/v1/ws`  
**Hardware WebSocket URL:** `wss://api.personalbmo.web.id/ws`  
**Canonical Companion:** `09-ENDPOINT-EVENT-COVERAGE-MATRIX.md`

This document specifies the authoritative contract between the Joy Mobile client (iOS/Android) and the Joy Backend Gateway.

---

## 1. Network Boundaries & Environments

```text
Mobile REST API:        https://api.personalbmo.web.id/api/v1
Mobile WebSocket:       wss://api.personalbmo.web.id/api/v1/ws
Hardware WebSocket:     wss://api.personalbmo.web.id/ws
Public Media Storage:   https://api.personalbmo.web.id/media/avatars/:fileName
Audio CDN Stream:       https://api.personalbmo.web.id/audio/:audioId.mp3
```

- Mobile **MUST** use the public HTTPS/WSS URLs through the reverse proxy.
- Mobile **MUST NOT** communicate directly with internal VPS ports (`3000`, `8001`, `5432`, `8642`), candidate Compose networks, or the hardware WebSocket endpoint.
- Server-side state, provider credentials, OAuth client secrets, and device tokens are kept strictly internal.

---

## 2. Authentication & Authorization

### 2.1 Standard Bearer Authentication
All authenticated requests must include:
```http
Authorization: Bearer <accessToken>
```

If a token is invalid, expired, or revoked, the server responds with `401 Unauthorized`:
```json
{
  "error": "AUTHENTICATION_FAILED"
}
```

### 2.2 Public (Unauthenticated) Routes
The following bootstrap endpoints do not require an authorization header:
1. `POST /api/v1/auth/register` — User registration with email, password, and date of birth.
2. `POST /api/v1/auth/login` — User login returning session and tokens.
3. `POST /api/v1/auth/google` — Google OAuth ID token authentication.
4. `POST /api/v1/auth/password/recovery/verify` — Step 1 of password recovery.
5. `POST /api/v1/auth/password/recovery/reset` — Step 2 of password recovery with recovery token.
6. `POST /api/v1/auth/refresh` — Rotate refresh token and issue new access token.
7. `GET /media/avatars/:fileName` — Public avatar media delivery.
8. `GET /audio/:fileName` — Ephemeral speech audio download for playback.

---

## 3. Detailed REST API Inventory

### 3.1 Authentication & Profile
- **`POST /api/v1/auth/register`**
  - **Body**: `{ "email": string, "password": string, "dateOfBirth": "YYYY-MM-DD", "invitationCode"?: string }`
  - **Response 201**: `{ "user": SafeUser, "session": SafeSession }`
- **`POST /api/v1/auth/login`**
  - **Body**: `{ "email": string, "password": string, "clientDeviceId"?: string }`
  - **Response 200**: `{ "user": SafeUser, "session": SafeSession }`
- **`POST /api/v1/auth/google`**
  - **Body**: `{ "idToken": string, "clientDeviceId"?: string }`
  - **Response 200**: `{ "user": SafeUser, "session": SafeSession }`
- **`POST /api/v1/auth/password/recovery/verify`**
  - **Body**: `{ "email": string, "dateOfBirth": "YYYY-MM-DD" }`
  - **Response 200**: `{ "recoveryToken": string, "expiresAt": string }`
- **`POST /api/v1/auth/password/recovery/reset`**
  - **Body**: `{ "recoveryToken": string, "newPassword": string }`
  - **Response 204**: No Content
- **`POST /api/v1/auth/refresh`**
  - **Body**: `{ "refreshToken": string }`
  - **Response 200**: `{ "session": SafeSession }`
- **`POST /api/v1/auth/logout`**
  - **Response 204**: No Content (Revokes current session)
- **`POST /api/v1/auth/logout-all`**
  - **Response 204**: No Content (Revokes all user sessions)
- **`GET /api/v1/me`**
  - **Response 200**: `{ "user": SafeUser }`
- **`PATCH /api/v1/me/profile`**
  - **Body**: `{ "displayName"?: string, "birthDate"?: string, "timezone"?: string }`
  - **Response 200**: `{ "user": SafeUser }`
- **`POST /api/v1/me/profile/avatar`**
  - **Body**: Multipart form data with file field `avatar` (max 5 MB, JPEG/PNG/WebP).
  - **Response 200**: `{ "avatarUrl": string }`

### 3.2 Chat & Conversations
- **`GET /api/v1/chat/sessions`**
  - **Query**: `limit` (default 50, max 100), `cursor`
  - **Response 200**: `{ "sessions": SafeChatSession[], "nextCursor": string | null }`
- **`POST /api/v1/chat/sessions`**
  - **Body**: `{ "title"?: string, "temporary"?: boolean }`
  - **Response 201**: `{ "session": SafeChatSession }`
- **`GET /api/v1/chat/sessions/:sessionId/messages`**
  - **Query**: `limit` (1..100), `cursor` (message timestamp/UUID)
  - **Response 200**: `{ "messages": SafeChatMessage[], "nextCursor": string | null }`
- **`POST /api/v1/chat/sessions/:sessionId/messages`**
  - **Body**:
    ```json
    {
      "idempotencyKey": "uuid-v4",
      "text": "Hello Joy",
      "speakOnDevice": false,
      "deviceId": "optional-device-uuid"
    }
    ```
  - **Response 202 (Accepted)**:
    ```json
    {
      "userMessage": {
        "id": "uuid",
        "sender": "user",
        "text": "Hello Joy",
        "createdAt": "2026-08-27T10:00:00.000Z"
      },
      "assistant": {
        "status": "processing",
        "operationId": "uuid"
      }
    }
    ```
- **`DELETE /api/v1/chat/sessions/:sessionId`**
  - **Response 204**: No Content (Archives chat session)
- **`POST /api/v1/chat/messages/:messageId/feedback`**
  - **Body**: `{ "rating": "positive" | "negative", "reason"?: string }`
  - **Response 200**: `{ "feedback": SafeFeedback }`

### 3.3 Text-to-Speech (TTS) Synthesis
- **`POST /api/v1/tts/synthesize`**
  - **Auth**: Bearer token required
  - **Body**:
    ```json
    {
      "text": "Halo, aku Joy!",
      "voice": "en-US-AnaNeural",
      "speed": 1.0
    }
    ```
  - **Response 200**:
    ```json
    {
      "success": true,
      "audioId": "uuid",
      "audioUrl": "https://api.personalbmo.web.id/audio/uuid.mp3",
      "expiresAt": "2026-08-27T10:05:00.000Z",
      "engine": "edge-tts"
    }
    ```

### 3.4 Push Notifications Management
- **`POST /api/v1/settings/push-tokens`**
  - **Body**:
    ```json
    {
      "token": "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]",
      "platform": "expo",
      "deviceId": "optional-mobile-device-id"
    }
    ```
  - **Response 200**: `{ "ok": true, "token": { "id": "uuid", "token": string } }`
- **`DELETE /api/v1/settings/push-tokens`**
  - **Body or Query**: `{ "token": "ExponentPushToken[...]" }`
  - **Response 200**: `{ "ok": true, "success": boolean }`
- **`GET /api/v1/settings/push-tokens`**
  - **Response 200**: `{ "ok": true, "tokens": [ { "id": "uuid", "token": string, "platform": string, "createdAt": string } ] }`

### 3.5 Device Management & Pairing
- **`GET /api/v1/devices`**
  - **Response 200**: `{ "devices": SafeDevice[] }`
- **`GET /api/v1/devices/:deviceId`**
  - **Response 200**: `{ "device": SafeDevice }`
- **`PATCH /api/v1/devices/:deviceId/settings`**
  - **Body**: `{ "playbackVolume"?: number (0..100), "microphoneMuted"?: boolean }`
  - **Response 200**: `{ "settings": SafeDeviceSettings }`
- **`POST /api/v1/devices/:deviceId/unpair`**
  - **Response 204**: No Content (Revokes device binding and terminates session)
- **`POST /api/v1/pairing/claim`**
  - **Body**: `{ "code": "123456" }` (6-digit numeric pairing code displayed on ESP32 screen)
  - **Response 200**: `{ "device": SafeDevice }`
  - **Rule**: Enforces *One Active Device per User*. Pairing a new device automatically unpairs the previous active device.
- **`GET /api/v1/devices/:deviceId/wifi`**
  - **Response 200**: `{ "wifi": { "ssid": string, "security": "OPEN" | "WPA_PSK" } | null }`
- **`PUT /api/v1/devices/:deviceId/wifi`**
  - **Body**: `{ "ssid": string, "password"?: string, "security": "OPEN" | "WPA_PSK" }`
  - **Response 202**: `{ "status": "PENDING", "configurationId": "uuid" }`
- **`DELETE /api/v1/devices/:deviceId/wifi`**
  - **Response 204**: No Content
- **`GET /api/v1/devices/:deviceId/logs`**
  - **Query**: `limit` (1..100, default 50)
  - **Response 200**: `{ "logs": SafeDeviceLog[] }`
- **`GET /api/v1/devices/:deviceId/telemetry`**
  - **Response 200**: `{ "telemetry": SafeDeviceTelemetry }`

### 3.6 Memory Management & Privacy
- **`GET /api/v1/memories`**
  - **Query**: `limit`, `cursor`, `query`
  - **Response 200**: `{ "memories": SafeMemoryRecord[], "nextCursor": string | null }`
- **`GET /api/v1/memories/:id`**
  - **Response 200**: `{ "memory": SafeMemoryRecord }`
- **`PATCH /api/v1/memories/:id`**
  - **Body**: `{ "content": string, "tags"?: string[] }`
  - **Response 200**: `{ "memory": SafeMemoryRecord }`
- **`DELETE /api/v1/memories/:id`**
  - **Response 204**: No Content
- **`GET /api/v1/memory-candidates`**
  - **Response 200**: `{ "candidates": SafeMemoryCandidate[] }`
- **`POST /api/v1/memory-candidates/:id/accept`**
  - **Response 200**: `{ "memory": SafeMemoryRecord }`
- **`POST /api/v1/memory-candidates/:id/reject`**
  - **Response 204**: No Content
- **`POST /api/v1/memories/forget-topic`**
  - **Body**: `{ "topic": string }`
  - **Response 200**: `{ "forgottenCount": number }`
- **`POST /api/v1/memories/clear-all`**
  - **Response 204**: No Content
- **`POST /api/v1/memories/export`**
  - **Response 200**: `{ "exportUrl": string, "format": "JSON" }`
- **`GET /api/v1/memory/summary`**
  - **Response 200**: `{ "summary": SafeMemorySummary }`
- **`POST /api/v1/memory/summary/regenerate`**
  - **Response 202**: `{ "status": "GENERATING" }`
- **`POST /api/v1/memory/summary/feedback`**
  - **Body**: `{ "rating": "positive" | "negative", "comments"?: string }`
  - **Response 200**: `{ "ok": true }`

### 3.7 Schedules & Reminders
- **`GET /api/v1/schedules`**
  - **Response 200**: `{ "schedules": SafeSchedule[] }`
- **`POST /api/v1/schedules`**
  - **Body**:
    ```json
    {
      "prompt": "Minum obat",
      "targetDeviceId": "uuid-optional",
      "timezone": "Asia/Jakarta",
      "recurrence": {
        "frequency": "Once" | "Daily" | "Weekly" | "Monthly",
        "every": 1,
        "date": "YYYY-MM-DD",
        "timeOfDay": "Morning",
        "exactTime": "08:00"
      },
      "payload": {
        "title": "Minum obat",
        "prompt": "Minum obat penurun demam",
        "deliveryTargets": ["MOBILE", "DEVICE"]
      }
    }
    ```
  - **Response 201**: `{ "schedule": SafeSchedule }`
- **`GET /api/v1/schedules/:id`**
  - **Response 200**: `{ "schedule": SafeSchedule }`
- **`PATCH /api/v1/schedules/:id`**
  - **Body**: Partial schedule update.
  - **Response 200**: `{ "schedule": SafeSchedule }`
- **`POST /api/v1/schedules/:id/pause`**
  - **Response 200**: `{ "schedule": SafeSchedule }`
- **`POST /api/v1/schedules/:id/resume`**
  - **Response 200**: `{ "schedule": SafeSchedule }`
- **`DELETE /api/v1/schedules/:id`**
  - **Response 204**: No Content
- **`GET /api/v1/schedule-runs`**
  - **Query**: `scheduleId` (optional), `limit` (default 50)
  - **Response 200**: `{ "runs": SafeScheduleRun[] }`

### 3.8 Integrations & Plugins (Spotify, WhatsApp, Support)
- **`GET /api/v1/plugins`** — Returns list of active plugins and integration states.
- **`POST /api/v1/integrations/spotify/connect`** — Returns Spotify authorization URL.
- **`GET /api/v1/integrations/spotify/status`** — Connection status and authorized scopes.
- **`GET /api/v1/integrations/spotify/search`** — Search Spotify catalog.
- **`POST /api/v1/integrations/spotify/actions`** — Execute Spotify playback actions (`PLAY`, `PAUSE`, `RESUME`, `NEXT`, `PREVIOUS`, `VOLUME`).
- **`GET /api/v1/integrations/spotify/devices`** — Active Spotify Connect devices.
- **`GET /api/v1/integrations/spotify/playback`** — Current playback status.
- **`PUT /api/v1/integrations/spotify/preferred-device`** — Set preferred playback device.
- **`POST /api/v1/integrations/spotify/disconnect`** — Unlink Spotify account.
- **`POST /api/v1/integrations/whatsapp/connect`** — Connect WhatsApp session.
- **`GET /api/v1/integrations/whatsapp/status`** — WhatsApp connection state.
- **`GET /api/v1/integrations/whatsapp/conversations`** — Synced conversations.
- **`GET /api/v1/integrations/whatsapp/conversations/:id`** — Single conversation details.
- **`POST /api/v1/integrations/whatsapp/send-preview`** — Generate message draft preview.
- **`POST /api/v1/integrations/whatsapp/send-confirm`** — Confirm and dispatch message.
- **`GET /api/v1/integrations/whatsapp/notification-rules`** — Notification filter rules.
- **`PATCH /api/v1/integrations/whatsapp/notification-rules`** — Update rules.
- **`POST /api/v1/integrations/whatsapp/disconnect`** — Disconnect WhatsApp.
- **`POST /api/v1/support/bug-reports`** — Submit bug report with diagnostic attachments.

---

## 4. Mobile WebSocket Protocol (`wss://api.personalbmo.web.id/api/v1/ws`)

### 4.1 Connection & Authentication
Clients authenticate with one initial JSON message; do not put the access token in the URL query string:

```json
{"event":"authenticate","accessToken":"<access-token>"}
```

### 4.2 Inbound Events (Mobile → Backend)
- `{"event":"authenticate","accessToken":"<access-token>"}` — first message after open; liveness uses native WebSocket ping/pong.

### 4.3 Outbound Events (Backend → Mobile)
The server first sends a raw `authenticated` acknowledgement. The schema-defined application events below are forward-compatible and may be absent when no producer is active.
1. **`chat_thinking`**: `{"event":"chat_thinking","sessionId":"uuid","messageId":"uuid"}`.
2. **`chat_message`**:
   ```json
   {
     "event": "chat_message",
     "sessionId": "uuid",
     "message": {
       "id": "uuid",
       "sender": "assistant",
       "text": "Halo! Ada yang bisa aku bantu?",
       "sourceDeviceId": null,
       "createdAt": "2026-08-27T10:00:00.000Z"
     }
   }
   ```
3. **`chat_title_updated`**:
   ```json
   {
     "event": "chat_title_updated",
     "sessionId": "uuid",
     "title": "Percakapan Pagi"
   }
   ```
4. **`device_status`**:
   ```json
   {
     "event": "device_status",
     "deviceId": "uuid",
     "online": true,
     "lastSeenAt": "2026-08-27T10:00:00.000Z",
     "wifi": { "connected": true, "rssi": -55 },
     "battery": { "supported": false, "percent": null }
   }
   ```
5. **`voice_processing_status`**:
   ```json
   {
     "event": "voice_processing_status",
     "deviceId": "uuid",
     "requestId": "uuid",
     "status": "thinking",
     "errorCode": null
   }
   ```
6. **`schedule_status`**:
   ```json
   {
     "event": "schedule_status",
     "scheduleId": "uuid",
     "runId": null,
     "status": "ACTIVE",
     "statusLabel": "MONITORING"
   }
   ```
7. **`notification`**:
   ```json
   {
     "event": "notification",
     "id": "uuid",
     "type": "GENERIC",
     "title": "Joy Schedule",
     "body": "Saatnya meeting tim!",
     "createdAt": "2026-08-27T10:00:00.000Z"
   }
   ```
8. **`proactive_delivery_status`**:
   ```json
   {
     "event": "proactive_delivery_status",
     "deviceId": "uuid",
     "deliveryId": "uuid",
     "source": "SCHEDULE",
     "status": "DELIVERED",
     "errorCode": null
   }
   ```
9. **`integration_status`**:
   ```json
   {
     "event": "integration_status",
     "integration": "spotify",
     "status": "CONNECTED"
   }
   ```
10. **`whatsapp_notification`**:
   ```json
   {
     "event": "whatsapp_notification",
     "conversationId": "uuid",
     "displayName": "Budi",
     "conversationType": "DM",
     "receivedAt": "2026-08-27T10:00:00.000Z"
   }
   ```
11. **`wifi_configuration_status`**:
    ```json
    {
      "event": "wifi_configuration_status",
      "deviceId": "uuid",
      "configurationId": "uuid",
      "status": "CONNECTED",
      "errorCode": null
    }
    ```
