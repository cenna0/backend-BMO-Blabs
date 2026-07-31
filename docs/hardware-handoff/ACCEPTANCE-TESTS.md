# BMO MVP — Physical ESP32 Acceptance Tests

**Purpose:** Final verification that firmware behavior matches the canonical backend contract.

**Current state:** the P7 public endpoint and fake-client matrix are verified,
but this physical matrix has not run. `PHYSICAL_ESP32_STATUS: NOT_RUN` remains
authoritative until P10 records real-device evidence. RVC status does not alter
these protocol tests.

## Evidence header

Record once per test session:

```text
Date/time:
Firmware build ID / commit:
Backend deployed commit:
DEPLOYMENT_STATUS:
Device ID:
Wi-Fi/network:
Tester:
```

For each test record:

```text
Test ID:
PASS | FAIL | BLOCKED
request_id (when relevant):
Observed HTTP status/body:
Observed WebSocket events:
Display transitions:
Playback result:
Notes:
```

## Test matrix

### HW-AT-001 — Production TLS/time prerequisite

**Action:** Boot on normal network, synchronize device time, connect to the verified `wss://api.personalbmo.web.id/ws` hostname with certificate validation enabled.
**Pass:** device clock is trustworthy enough for certificate validity, WSS handshake succeeds without insecure/skip-verify mode, and firmware connects by hostname rather than hardcoding the VPS IP.

### HW-AT-002 — Local recording stop rules

**Action:** Exercise one utterance followed by silence and one long recording case.
**Pass:** normal recording stops after about 2.5 s silence; hard stop occurs by 60 s; generated WAV remains canonical PCM 16-bit LE/16 kHz/mono.

### HW-AT-003 — WSS connect + authenticate

**Action:** Boot device, connect Wi-Fi and WSS, send valid `authenticate`.  
**Pass:** `authenticated` received for `bmo-001`; socket remains open.

### HW-AT-004 — Invalid WebSocket credentials

**Action:** Authenticate using an invalid token.  
**Pass:** `authentication_failed` with `INVALID_DEVICE_CREDENTIALS`, then close `4003`.

### HW-AT-005 — Authentication timeout

**Action:** Open socket but do not authenticate within the auth window.  
**Pass:** backend closes with `4008`.

### HW-AT-006 — Event before authentication

**Action:** Send a non-auth event before authenticating.  
**Pass:** backend rejects/closes using `4001`; process remains healthy.

### HW-AT-007 — Healthy WebSocket heartbeat

**Action:** Keep authenticated connection idle through multiple backend pings.  
**Pass:** firmware replies pong and connection stays alive.


### HW-AT-008 — Duplicate connection replacement

**Action:** Keep one authenticated connection open, then authenticate a newer connection using the same device identity.
**Pass:** the newer connection becomes active; the old connection receives `connection_replaced` with `NEW_CONNECTION_ESTABLISHED` when deliverable and is closed; future events use the new connection.

### HW-AT-009 — Canonical WAV upload

**Action:** Record canonical PCM 16-bit LE, 16 kHz, mono WAV and upload with valid headers.  
**Pass:** HTTP `202` with matching `request_id` and `status: processing`.

### HW-AT-010 — Thinking race tolerance

**Action:** Perform repeated valid uploads.  
**Pass:** firmware works whether `display_status: thinking` arrives just before or just after HTTP `202`.

### HW-AT-011 — Full happy path playback

**Action:** Valid upload through real backend pipeline.  
**Pass:** `thinking` → `audio_ready` → HTTP `200 audio/mpeg` → playback starts → `speaking`; after playback is truly finished, firmware performs completion actions (`idle`/cleanup and `audio_playback_done`) without signaling completion early.

### HW-AT-012 — MP3 decoder target format

**Action:** Play backend output with current target encoding.  
**Pass:** MP3 mono, 24 kHz, 96 kbps plays without decode/playback failure.

### HW-AT-013 — New request after completion

**Action:** Finish playback, send `audio_playback_done`, then issue a new recording.  
**Pass:** second upload is accepted; device/backend are not stuck busy.

### HW-AT-014 — Upload without WebSocket

**Action:** Disconnect WSS, then attempt upload.  
**Pass:** HTTP `409 WEBSOCKET_NOT_CONNECTED`; firmware reconnects/authenticates before retrying same recording/request ID.

### HW-AT-015 — Duplicate upload same bytes

**Action:** Upload same WAV twice with same request ID.  
**Pass:** first is `202`; duplicate is `200 duplicate:true`; no second voice pipeline/playback is created.

### HW-AT-016 — Request ID conflict

**Action:** Reuse request ID with different WAV bytes.  
**Pass:** HTTP `409 REQUEST_ID_CONFLICT`; original request is not replaced.

### HW-AT-017 — Device busy

**Action:** While one request is active, attempt a different request ID.  
**Pass:** HTTP `409 DEVICE_BUSY`; firmware waits rather than creating another active request.

### HW-AT-018 — Invalid WAV

**Action:** Send wrong WAV metadata.  
**Pass:** HTTP `422 INVALID_AUDIO_FORMAT`; firmware does not repeatedly resend identical invalid bytes.

### HW-AT-019 — Oversized WAV

**Action:** Exceed current upload size baseline.  
**Pass:** HTTP `413 AUDIO_TOO_LARGE`; firmware ends that attempt and returns through local error behavior.


### HW-AT-020 — Invalid upload credentials

**Action:** Upload using an invalid device token.
**Pass:** HTTP `401 INVALID_DEVICE_CREDENTIALS`; firmware does not retry until credential/config is corrected.

### HW-AT-021 — Missing/invalid request metadata

**Action:** In controlled test firmware/client mode, omit a required header and separately send a non-UUID-v4 request ID.
**Pass:** `400 MISSING_REQUIRED_HEADER` and `400 INVALID_REQUEST_ID` are handled as non-retryable malformed requests.

### HW-AT-022 — Unsupported content type

**Action:** Send otherwise-valid WAV bytes with the wrong `Content-Type`.
**Pass:** HTTP `415 UNSUPPORTED_AUDIO_TYPE`; firmware/client does not blind-retry identical malformed request.

### HW-AT-023 — Retryable upload failure budget

**Action:** Simulate network/no-response or retryable `5xx` failure without receiving a valid response.
**Pass:** the same WAV bytes and request ID are used for at most 3 total attempts with the baseline 1 s then 2 s wait; no duplicate pipeline is created if a previous attempt was actually accepted.

### HW-AT-024 — Reconnect while thinking

**Action:** Disconnect WSS after request accepted while backend is processing; reconnect/authenticate.  
**Pass:** `authenticated.backend_state=thinking` with matching `active_request_id`; processing continues without a second upload/playback.

### HW-AT-025 — Reconnect while audio ready

**Action:** Disconnect after backend generated audio but before completion. Reconnect/authenticate.  
**Pass:** `backend_state=audio_ready` and still-valid `audio_ready` is replayed; TTL reflects remaining time.

### HW-AT-026 — Duplicate audio_ready while downloading/playing

**Action:** Cause/replay same `audio_ready` during download or playback.  
**Pass:** firmware does not start a second download/playback sequence.

### HW-AT-027 — Completion resend after reconnect

**Action:** Finish playback, lose socket before delivery certainty, reconnect.  
**Pass:** firmware can resend `audio_playback_done`; backend handles duplicate idempotently.

### HW-AT-028 — MP3 download retry

**Action:** Force first MP3 download attempt to fail.  
**Pass:** firmware discards incomplete buffer, waits 1 s, retries once from beginning, and does not use Range/resume.

### HW-AT-029 — Final download/playback failure

**Action:** Make allowed download retry fail or force decoder/playback failure.  
**Pass:** firmware sends `audio_playback_failed` with valid reason, shows error, returns idle; backend does not regenerate/resend as a retry mechanism.

### HW-AT-030 — Audio expiry

**Action:** Allow generated MP3 URL to expire before playback.  
**Pass:** backend sends/returns `AUDIO_EXPIRED`/HTTP `410`; firmware treats URL as final failure and returns through error → idle.

### HW-AT-031 — No speech / noise

**Action:** Upload valid canonical WAV containing no useful speech/noise case.  
**Pass:** `request_failed` with `NO_SPEECH`; firmware shows error and uses local noisy/cannot-hear audio.


### HW-AT-032 — Unknown audio URL

**Action:** Request an audio UUID that was never valid (controlled test).
**Pass:** HTTP `404`; firmware does not treat it as permission to regenerate/re-upload the original request automatically.

### HW-AT-033 — Generic recoverable pipeline failure

**Action:** Trigger one controlled backend failure such as `HERMES_FAILED`, `STT_FAILED`, or `TTS_FAILED`.
**Pass:** firmware shows `error`, uses generic local failure audio when possible, then returns `idle`; raw provider/internal error text is not expected or spoken.

### HW-AT-034 — Backend restart / lost in-memory request

**Action:** Have a local pending request, restart backend so in-memory state is lost, reconnect/authenticate.  
**Pass:** backend reports `backend_state: idle`; firmware clears stale local request and returns idle instead of waiting forever.

## Final gate

Hardware integration can be declared:

```text
HARDWARE INTEGRATION VERIFIED
```

only when:

- `DEPLOYMENT-CONFIG.md` is `VERIFIED`;
- fake-client public E2E passed first;
- all mandatory tests above are `PASS` or an explicitly approved hardware/environment exception is documented;
- firmware build ID and representative request IDs are recorded;
- no protocol workaround changes canonical endpoint/event/payload semantics.
