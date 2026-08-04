# BMO MVP — Hardware Integration Handoff

**Audience:** ESP32-S3 firmware/hardware team  
**Protocol authority:** [`../hardware-contract/BMO-MVP-HW-INTERFACE-CONTRACT-v1.0.5.md`](../hardware-contract/BMO-MVP-HW-INTERFACE-CONTRACT-v1.0.5.md)  
**Deployment values:** [`DEPLOYMENT-CONFIG.md`](DEPLOYMENT-CONFIG.md)

This file answers one question: **what does the ESP32 need to implement to talk to the existing BMO voice backend?**

> Do not invent endpoint, event, state, acknowledgment, field, or retry behavior. If this summary ever conflicts with the canonical hardware contract, stop and use the canonical contract.

## 5-Minute Implementation Overview

```text
BOOT
  ↓
connect Wi-Fi
  ↓
connect WSS /ws
  ↓
send authenticate
  ↓
receive authenticated
  ↓
IDLE
  ↓ wake word (local)
record WAV while display stays IDLE
  ↓ silence 2.5s OR max 60s
generate UUID v4 request_id
  ↓
POST raw WAV /api/v1/voice
  ↓
HTTP 202 processing
  ↕ ordering is not guaranteed
WS display_status: thinking
  ↓
WS audio_ready + temporary MP3 URL
  ↓
GET MP3
  ↓
start playback → firmware sets SPEAKING
  ↓
playback complete
  ↓
firmware completion actions: IDLE + cleanup + WS audio_playback_done
```

Failure path:

```text
request_failed OR final playback failure
  ↓
firmware sets ERROR
  ↓
play local error audio if possible
  ↓
return IDLE
```

---

## 1. Alamat backend

Verified production endpoint:

```text
HTTPS base : https://api.personalbmo.web.id
WebSocket  : wss://api.personalbmo.web.id/ws
```

The general gate is to use these URLs only when
[`DEPLOYMENT-CONFIG.md`](DEPLOYMENT-CONFIG.md) contains:

```text
DEPLOYMENT_STATUS: VERIFIED
```

That condition is now satisfied: the endpoint is live and the public
fake-client matrix passed `23/23`. Physical ESP32 acceptance remains
`NOT_RUN`/P10, so do not label firmware integration verified yet.

Production TLS prerequisite: before opening HTTPS/WSS, firmware must
synchronize a trustworthy wall clock (normally NTP/SNTP), validate the server
certificate chain, and never disable certificate verification as a workaround.
Avoid pinning a short-lived leaf certificate; P10 records physical-device TLS
evidence.

The physical BMO communicates through public HTTPS/WSS. Tailscale is an infrastructure/admin access mechanism and is **not** part of the firmware protocol.

Public routes used by hardware:

```text
WS   /ws
POST /api/v1/voice
GET  /audio/:audioId.mp3
```

Optional diagnostic route:

```text
GET /health
```

Hardware must not call Hermes `:8642`, Audio Service `:8001`, PostgreSQL `:5432`, Beszel, STT internal routes, or TTS internal routes.

---

## 2. Device ID & Token

MVP identity:

```text
device_id    = bmo-001
device_token = PROVIDED_OUT_OF_BAND
```

The same credential pair is used for:

- WebSocket authentication;
- HTTP WAV upload authentication.

Never put `device_token` in the WebSocket URL/query string or logs.

### WebSocket authenticate payload

Send immediately after socket open, within the backend auth window:

```json
{
  "event": "authenticate",
  "device_id": "bmo-001",
  "device_token": "<device-secret>"
}
```

Success:

```json
{
  "event": "authenticated",
  "status": "ok",
  "device_id": "bmo-001",
  "backend_state": "idle",
  "active_request_id": null
}
```

`backend_state` can be:

```text
idle
thinking
audio_ready
```

If it is not `idle`, `active_request_id` identifies the request to resume/synchronize.

Auth failure:

```json
{
  "event": "authentication_failed",
  "error": "INVALID_DEVICE_CREDENTIALS"
}
```

Close codes:

| Close code | Meaning | Firmware action |
|---:|---|---|
| `4001` | authentication required / event sent before auth | fix sequence, reconnect |
| `4003` | invalid credentials | stop retry loop until credential/config is fixed |
| `4008` | auth timeout | reconnect and authenticate promptly |

---

## 3. Format WAV

Required upload audio:

```text
Container    : WAV / RIFF
Codec        : PCM signed 16-bit little-endian
Sample rate  : 16000 Hz
Channels     : mono
Normal stop  : 2.5 seconds of silence
Hard limit   : 60 seconds
Size limit   : current backend baseline 3 MiB
```

Do not send:

- MP3/AAC as voice input;
- base64 audio;
- JSON audio payload;
- `multipart/form-data`;
- WebSocket audio chunks.

Wake word detection and recording are local firmware behavior. There is no public `wake_word_detected` event.

---

## 4. Endpoint upload

```http
POST /api/v1/voice HTTP/1.1
Host: api.personalbmo.web.id
X-Device-Id: bmo-001
X-Device-Token: <device-secret>
X-Request-Id: <uuid-v4>
Content-Type: audio/wav
Content-Length: <wav-byte-count>

<raw RIFF/WAV bytes>
```

Rules:

1. WebSocket must already be connected and authenticated.
2. Generate a new UUID v4 for every new recording.
3. Retry of the **same recording** must reuse the same request ID and same WAV bytes.
4. Only one active voice request is allowed per device.
5. Upload uses raw body, not multipart.

---

## 5. WebSocket Event — Backend → ESP32

Only these public events are valid:

### `authenticated`

```json
{
  "event": "authenticated",
  "status": "ok",
  "device_id": "bmo-001",
  "backend_state": "idle | thinking | audio_ready",
  "active_request_id": null
}
```

### `authentication_failed`

```json
{
  "event": "authentication_failed",
  "error": "INVALID_DEVICE_CREDENTIALS"
}
```

### `connection_replaced`

Sent to an older connection when a newer authenticated connection for the same device takes ownership:

```json
{
  "event": "connection_replaced",
  "reason": "NEW_CONNECTION_ESTABLISHED"
}
```

### `display_status`

Backend sends only `thinking`:

```json
{
  "event": "display_status",
  "request_id": "<uuid-v4>",
  "status": "thinking"
}
```

### `audio_ready`

```json
{
  "event": "audio_ready",
  "request_id": "<uuid-v4>",
  "audio_url": "https://api.personalbmo.web.id/audio/<audio-uuid>.mp3",
  "format": "mp3",
  "expires_in_seconds": 300
}
```

`expires_in_seconds` is remaining TTL at send time. On reconnect it can be less than `300`.

### `request_failed`

```json
{
  "event": "request_failed",
  "request_id": "<uuid-v4>",
  "code": "NO_SPEECH",
  "recoverable": true
}
```

Do **not** implement an `audio_ready_received` acknowledgment. It does not exist in the MVP contract.

---

## 6. Event yang ESP32 harus kirim

Only these events are sent by ESP32:

### `authenticate`

```json
{
  "event": "authenticate",
  "device_id": "bmo-001",
  "device_token": "<device-secret>"
}
```

### `audio_playback_done`

Send only after playback has actually completed. At completion, firmware transitions the display to `idle`, clears local playback state/buffer, and sends this event as the completion signal. These completion actions are adjacent; do not interpret documentation ordering as permission to send the event before playback is finished.

```json
{
  "event": "audio_playback_done",
  "request_id": "<uuid-v4>"
}
```

### `audio_playback_failed`

Send only after the firmware's allowed download retry has been exhausted or playback cannot complete:

```json
{
  "event": "audio_playback_failed",
  "request_id": "<uuid-v4>",
  "reason": "DOWNLOAD_FAILED"
}
```

Valid reasons:

```text
DOWNLOAD_FAILED
DECODE_FAILED
PLAYBACK_FAILED
```

Playback completion/failure events are idempotent: firmware may resend them after reconnect when delivery is uncertain.

---

## 7. Response upload

### Success / duplicate

| HTTP | Body state | Meaning | Firmware action |
|---:|---|---|---|
| `202` | `processing` | new request accepted | wait for WebSocket events |
| `200` | `duplicate:true`, `processing` | same request already processing | keep waiting; do not create new request |
| `200` | `duplicate:true`, `audio_ready` | MP3 already ready | consume/resume matching `audio_ready`; never double-play |
| `200` | `duplicate:true`, `completed` | request already finished | clear local request, return idle |
| `200` | `duplicate:true`, `failed` | request already failed | handle `error_code`, return idle |
| `200` | `duplicate:true`, `expired` | result expired | local error behavior, return idle |

New accepted request:

```json
{
  "request_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "processing"
}
```

Duplicate example:

```json
{
  "request_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "audio_ready",
  "duplicate": true,
  "error_code": null
}
```

### Upload errors

| HTTP | Error | Firmware action |
|---:|---|---|
| `400` | `MISSING_REQUIRED_HEADER` | do not retry same malformed request |
| `400` | `INVALID_REQUEST_ID` | do not retry same malformed request |
| `401` | `INVALID_DEVICE_CREDENTIALS` | stop retry until credential fixed |
| `409` | `WEBSOCKET_NOT_CONNECTED` | reconnect/auth WS, retry same WAV + same request ID |
| `409` | `DEVICE_BUSY` | wait for active request to finish |
| `409` | `REQUEST_ID_CONFLICT` | do not reuse that ID for different bytes; new ID only for a new recording |
| `413` | `AUDIO_TOO_LARGE` | do not retry identical WAV |
| `415` | `UNSUPPORTED_AUDIO_TYPE` | fix content type/input format |
| `422` | `INVALID_AUDIO_FORMAT` | fix WAV generation |
| `5xx` | server failure | retry same recording/request ID within retry policy |

Canonical disconnected response:

```json
{
  "error": "WEBSOCKET_NOT_CONNECTED",
  "message": "Device must reconnect before uploading audio."
}
```

`display_status: thinking` can arrive immediately before or after HTTP `202`. Correlate by `request_id`; never depend on arrival order across HTTP and WebSocket.

**Concurrency rule:** only one backend voice request may be active per device. While the current request is `thinking` or playing/speaking, firmware must not start/upload a different voice request; a new request will be rejected with `DEVICE_BUSY`. Retry of the same recording is not a new request and reuses the same `request_id`.

---

## 8. Audio download

After `audio_ready`, perform HTTP GET against the supplied URL.

Success headers include:

```http
HTTP/1.1 200 OK
Content-Type: audio/mpeg
Content-Length: <bytes>
Cache-Control: no-store, private, max-age=0
```

Current target encoding:

```text
Codec       : MP3
Channels    : mono
Sample rate : 24 kHz
Bitrate     : 96 kbps
TTL         : 300 seconds
```

The MP3 is fully generated on the server before `audio_ready`. Firmware may download progressively into a small buffer while playing.

Recommended initial buffering from the canonical contract:

```text
32–64 KiB OR roughly 0.5–1 second of audio
```

Set display to `speaking` only when playback actually starts.

### Expired vs unknown URL

Expired previously-valid audio:

```http
HTTP/1.1 410 Gone
```

```json
{"error":"AUDIO_EXPIRED"}
```

Unknown/nonexistent audio ID: HTTP `404`.

After backend processes `audio_playback_done` or final `audio_playback_failed`, the MP3 is deleted. A later GET is expected to be unavailable.

---

## 9. Display / Ekspresi

Only four display modes are part of the voice MVP:

```text
idle
thinking
speaking
error
```

Ownership:

| Mode | Owner / trigger |
|---|---|
| `idle` | firmware; default, wake word, and recording remain visually idle |
| `thinking` | backend via `display_status` after accepted upload |
| `speaking` | firmware when MP3 playback actually starts |
| `error` | firmware after request/playback failure |

There is **no `listening` display mode** in this MVP.

State sequence:

```text
IDLE
  └─ wake word + record locally (display remains IDLE)
       ↓ upload accepted
THINKING
       ↓ audio_ready + playback begins
SPEAKING
       ↓ playback_done
IDLE

failure → ERROR → IDLE
```

During `thinking` or `speaking`, do not start another voice request.

---

## 10. Error Code

Backend pipeline failure codes:

```text
NO_SPEECH
INVALID_AUDIO
STT_FAILED
HERMES_FAILED
TTS_FAILED
AUDIO_EXPIRED
PIPELINE_TIMEOUT
INTERNAL_ERROR
```

Firmware behavior:

| Error | Required behavior |
|---|---|
| `NO_SPEECH` | error expression + local “too noisy/cannot hear” audio |
| other recoverable pipeline errors | error expression + generic local failure audio |
| audio subsystem cannot play error audio | error expression still required |

Suggested local audio text from the canonical contract:

```text
NO_SPEECH:
“Sorry, it is too noisy. BMO cannot hear you.”

Other recoverable error:
“Oh no. BMO could not answer. Please try again.”
```

Provider/Hermes/TTS internal details are not sent to firmware as raw provider errors.

---

## 11. Timeout

Firmware-relevant values:

| Item | Current contract/baseline |
|---|---:|
| WebSocket authenticate after connect | `5 s` |
| Backend native WebSocket ping | every `60 s` |
| Missed pongs before backend closes connection | `2` |
| Healthy WebSocket application idle timeout | none; keep the connection alive while ping/pong is healthy |
| Reconnect backoff | `1s → 2s → 4s → 8s → 16s → max 30s` |
| Recording silence stop | `2.5 s` |
| Recording hard limit | `60 s` |
| HTTP upload timeout baseline | `90 s` |
| MP3 TTL | `300 s` |
| Backend request tombstone baseline | `10 min` |

Backend-internal STT/Hermes/TTS/RVC/total pipeline timeouts are server implementation details. Firmware responds to the resulting `request_failed` event and does not reproduce those timers locally.

---

## 12. Retry

### WebSocket reconnect

Reconnect with exponential backoff:

```text
1s → 2s → 4s → 8s → 16s → max 30s
```

Reset backoff to `1s` after successful authentication.

### WAV upload

If network fails before a valid HTTP response or a retryable server error occurs:

```text
attempt 1
→ wait 1s
attempt 2
→ wait 2s
attempt 3
→ final failure
```

All attempts for the same recording use the **same request ID and same WAV bytes**.

### MP3 download

```text
first download fails
→ discard incomplete buffer
→ wait 1s
→ retry once from byte 0
→ if still failed: audio_playback_failed
```

HTTP Range/resume is not required.

### Duplicate `audio_ready`

Keep local request state at least as:

```text
current_request_id
playback_state:
  waiting
  downloading
  playing
  done_pending_send
  failed_pending_send
```

For duplicate `audio_ready` with the same request ID:

- `downloading` / `playing`: ignore duplicate, do not start second playback;
- `done_pending_send`: resend `audio_playback_done`;
- `failed_pending_send`: resend `audio_playback_failed`;
- not downloaded yet: use the newest still-valid URL.

### Reconnect synchronization

After reconnect/authentication:

- `backend_state: idle` → cancel stale local server request and return idle;
- `thinking` → keep thinking for `active_request_id`; backend replays state;
- `audio_ready` → backend replays `audio_ready` if MP3 is still valid.

---

## 13. Testing

Do not call hardware integration complete until the physical ESP32 passes the matrix in [`ACCEPTANCE-TESTS.md`](ACCEPTANCE-TESTS.md).

Minimum smoke sequence:

```text
[ ] Wi-Fi connected
[ ] WSS connection established
[ ] authenticate succeeds
[ ] valid WAV upload returns 202
[ ] thinking received for same request_id
[ ] audio_ready received
[ ] MP3 GET returns audio/mpeg
[ ] decoder can play target MP3
[ ] speaking starts only when playback starts
[ ] audio_playback_done sent
[ ] backend becomes idle / next request accepted
[ ] reconnect while thinking works
[ ] reconnect while audio_ready works
[ ] duplicate upload does not run second pipeline
[ ] duplicate audio_ready never causes double playback
[ ] invalid credentials handled
[ ] invalid WAV handled
[ ] no-speech/error path handled
[ ] download retry and playback_failed handled
[ ] expired URL handled
```

---

## 14. End-to-End Flow

### Happy path

```text
ESP32                                       Backend
  |                                            |
  |--- WSS connect --------------------------->|
  |--- authenticate -------------------------->|
  |<-- authenticated --------------------------|
  |                                            |
  | wake word + record locally                 |
  |                                            |
  |--- POST raw WAV -------------------------->|
  |<-- HTTP 202 processing --------------------|
  |<-- display_status: thinking ---------------|
  |                                            |
  |<-- audio_ready -----------------------------|
  |--- GET MP3 -------------------------------->|
  |<-- MP3 bytes -------------------------------|
  |                                            |
  | playback starts → SPEAKING                 |
  | playback finishes                           |
  | IDLE + cleanup + audio_playback_done ------>|
  |                                            |
```

HTTP `202` and `display_status: thinking` can cross in transit. Always match `request_id`.

### Backend processing behind the public API

Hardware does not implement or call these steps, but this explains what happens after upload:

```text
WAV upload
→ faster-whisper STT
→ Hermes response
→ Piper Prudence TTS
→ Kokoro `af_heart` speed `0.80` fallback if Piper fails
→ FFmpeg MP3
→ audio_ready
```

Current STT implementation uses `medium` multilingual CPU INT8 with `BMO` hotword after local accuracy tuning. This does not change the hardware contract.

P8 production uses Piper Prudence speaker ID `0` as primary. Kokoro `af_heart`
at speed `0.80` is the internal fallback; firmware still receives the same MP3
contract.

RVC runtime artifacts are removed from production and retained only as archived
evidence/history. Firmware must not depend on RVC state; it always receives MP3
through the same `audio_ready` contract.

---

## 15. State Machine

```text
                    backend failure
                         ┌─────────┐
                         ▼         │
IDLE ──record/upload──> THINKING ──┼──> ERROR ──> IDLE
                         │         │
                         │ audio_ready + playback starts
                         ▼
                      SPEAKING
                         │
                         │ done
                         ▼
                        IDLE
```

Recording before upload is local activity inside `IDLE` for display purposes.

---

## 16. Reconnect + Idempotency

Two identifiers have different jobs:

```text
request_id = UUID v4 generated by ESP32 for one recording
 audio_id  = random server-generated UUID used in MP3 URL
```

Never use the MP3 audio UUID as `X-Request-Id`.

Backend stores a SHA-256 of the accepted WAV:

- same device + same request ID + same WAV → duplicate, no second pipeline;
- same request ID + different WAV → `REQUEST_ID_CONFLICT`;
- same request ID from a different device → `REQUEST_ID_CONFLICT`.

The request store is in memory for the voice MVP. If the backend restarts, an old in-flight request can disappear. After reconnect, `authenticated.backend_state: idle` is authoritative and firmware must clear the stale local request.

---

## 17. Do / Don't

### Do

- keep WSS alive and answer native ping/pong;
- authenticate immediately after socket connect;
- use UUID v4 request IDs;
- send raw canonical WAV over HTTP;
- correlate all asynchronous events by `request_id`;
- handle `thinking` before or after HTTP `202`;
- deduplicate `audio_ready`;
- send playback completion/failure;
- keep local error audio available offline;
- validate TLS certificates in production firmware.

### Don't

- do not send audio through WebSocket;
- do not use multipart upload;
- do not send token in URL/query string;
- do not create `listening` display mode from this contract;
- do not invent `audio_ready_received`, `audio_chunk`, `wake_word_detected`, `ack`, or other non-canonical event;
- do not play the same `audio_ready` twice after reconnect;
- do not start a new request while current request is thinking/speaking;
- do not call internal Hermes/Audio Service/PostgreSQL endpoints;
- do not disable TLS certificate verification for production.

---

## File lifecycle the firmware needs to understand

```text
ESP32 records WAV locally
→ backend receives/stores temporary input
→ backend produces MP3
→ input WAV is cleaned after final MP3 exists or on failure
→ MP3 stays available temporarily
→ playback_done/playback_failed removes MP3
→ otherwise TTL expires it
```

Firmware-visible consequences:

- valid unexpired URL → `200 audio/mpeg`;
- expired previously-valid URL → `410 AUDIO_EXPIRED`;
- unknown/deleted URL → `404`;
- do not assume the URL remains reusable after playback completion.

---

## Final implementation gate

Firmware is ready for backend integration when:

1. every item in [`FIRMWARE-CHECKLIST.md`](FIRMWARE-CHECKLIST.md) is implemented;
2. the deployment file says the backend is available;
3. the physical-device matrix in [`ACCEPTANCE-TESTS.md`](ACCEPTANCE-TESTS.md) passes;
4. no workaround changes endpoint/event/payload semantics from the canonical contract.
