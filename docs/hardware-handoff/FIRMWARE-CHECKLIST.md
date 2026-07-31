# BMO MVP — Firmware Implementation Checklist

Use together with [`README.md`](README.md) and the canonical [`../hardware-contract/BMO-MVP-HW-INTERFACE-CONTRACT-v1.0.5.md`](../hardware-contract/BMO-MVP-HW-INTERFACE-CONTRACT-v1.0.5.md).

Current gate: `DEPLOYMENT-CONFIG.md` is `VERIFIED` and the live endpoint is
available. This checklist is still incomplete until physical P10 evidence is
recorded; `PHYSICAL_ESP32_STATUS` remains `NOT_RUN`.

- [ ] Synchronize trustworthy device time (NTP/SNTP or equivalent) before production HTTPS/WSS certificate validation.
- [ ] Validate the server certificate chain; never disable TLS verification to make production connection work.
- [ ] Connect using the production hostname (not hardcoded VPS IP) so DNS migration and TLS/SNI remain valid.

## A. Connectivity and identity

- [ ] Connect ESP32-S3 to Wi-Fi.
- [ ] Connect to the WSS URL from `DEPLOYMENT-CONFIG.md`.
- [ ] Send `authenticate` within the authentication window after socket open.
- [ ] Store/use `device_id=bmo-001` for current MVP.
- [ ] Store the real device token outside source-controlled documentation.
- [ ] Never put the token in the WebSocket URL/query string.
- [ ] Handle close codes `4001`, `4003`, and `4008`.
- [ ] Answer native WebSocket ping with pong.
- [ ] Keep a healthy authenticated WebSocket open; do not add a one-hour/application idle disconnect that is absent from the contract.
- [ ] Implement reconnect backoff `1s → 2s → 4s → 8s → 16s → max 30s`.
- [ ] Reset reconnect backoff after successful authentication.

## B. Voice capture

- [ ] Wake word runs locally.
- [ ] Display remains `idle` during wake word and local recording.
- [ ] Record WAV RIFF.
- [ ] PCM signed 16-bit little-endian.
- [ ] 16 kHz.
- [ ] Mono.
- [ ] Stop after 2.5 s silence.
- [ ] Hard stop at 60 s.
- [ ] Respect current backend size baseline of 3 MiB.

## C. Request identity and upload

- [ ] Generate UUID v4 `request_id` before each new recording upload.
- [ ] Same recording retry uses same UUID and same bytes.
- [ ] New recording uses new UUID.
- [ ] WebSocket is authenticated before upload.
- [ ] Send raw bytes to `POST /api/v1/voice`.
- [ ] Send `X-Device-Id`.
- [ ] Send `X-Device-Token`.
- [ ] Send `X-Request-Id`.
- [ ] Send `Content-Type: audio/wav`.
- [ ] Send correct `Content-Length`.
- [ ] Do not use multipart.
- [ ] Correlate HTTP response and WebSocket events by `request_id`.
- [ ] Do not assume HTTP `202` arrives before `display_status: thinking`.

## D. Upload response handling

- [ ] `202 processing`: wait for events.
- [ ] duplicate `200 processing`: keep waiting for same request.
- [ ] duplicate `200 audio_ready`: use/resume matching result without double playback.
- [ ] duplicate `200 completed`: clear local state and idle.
- [ ] duplicate `200 failed/expired`: handle error and idle.
- [ ] `400 MISSING_REQUIRED_HEADER`: do not blind-retry malformed request.
- [ ] `400 INVALID_REQUEST_ID`: fix ID generation.
- [ ] `401 INVALID_DEVICE_CREDENTIALS`: stop retries until configuration is fixed.
- [ ] `409 WEBSOCKET_NOT_CONNECTED`: reconnect/auth, then retry same recording/request ID.
- [ ] `409 DEVICE_BUSY`: wait; do not create a second active request.
- [ ] `409 REQUEST_ID_CONFLICT`: never reuse that ID for different bytes.
- [ ] `413 AUDIO_TOO_LARGE`: do not resend identical WAV.
- [ ] `415 UNSUPPORTED_AUDIO_TYPE`: fix input/content type.
- [ ] `422 INVALID_AUDIO_FORMAT`: fix WAV output.
- [ ] Retry eligible network/5xx failures with the same request ID and same bytes; baseline maximum is 3 total upload attempts (initial + 2 retries).

## E. WebSocket events Backend → ESP32

- [ ] `authenticated`.
- [ ] `authentication_failed`.
- [ ] `connection_replaced`; a newer authenticated connection for the same device replaces the old one. Treat the old socket as superseded/closed and ensure the connection manager does not create a reconnect fight with the newer active socket.
- [ ] `display_status` with `status: thinking`.
- [ ] `audio_ready`.
- [ ] `request_failed`.
- [ ] Do not expect `audio_ready_received`.
- [ ] Do not expect audio bytes through WebSocket.

## F. WebSocket events ESP32 → Backend

- [ ] `authenticate`.
- [ ] `audio_playback_done`.
- [ ] `audio_playback_failed`.
- [ ] Failure reason is one of `DOWNLOAD_FAILED`, `DECODE_FAILED`, `PLAYBACK_FAILED`.
- [ ] Completion/failure can be resent after reconnect when delivery is uncertain.

## G. Display and local state

- [ ] Only `idle`, `thinking`, `speaking`, `error` are display modes for voice MVP.
- [ ] No `listening` display mode.
- [ ] Backend controls only `thinking`.
- [ ] Firmware controls `idle`.
- [ ] Firmware starts `speaking` only when playback actually starts.
- [ ] Firmware controls `error`.
- [ ] Return to `idle` after completion/failure.
- [ ] Do not start another voice request while `thinking` or `speaking`.

## H. Audio download and playback

- [ ] Use URL from `audio_ready`; do not construct audio ID from request ID.
- [ ] Validate HTTP `200` and `Content-Type: audio/mpeg`.
- [ ] Decoder supports current target MP3 mono, 24 kHz, 96 kbps.
- [ ] Buffer enough audio before starting playback.
- [ ] Progressive HTTP reading is allowed.
- [ ] Retry a failed download once from the beginning after 1 s.
- [ ] No HTTP Range/resume dependency.
- [ ] `410 AUDIO_EXPIRED` is final for that URL.
- [ ] Unknown/deleted URL `404` is not a new TTS request trigger.

## I. Duplicate/reconnect state

Keep at least:

```text
current_request_id
playback_state = waiting | downloading | playing | done_pending_send | failed_pending_send
```

- [ ] Duplicate `audio_ready` while downloading/playing is ignored.
- [ ] `done_pending_send` resends `audio_playback_done` after reconnect.
- [ ] `failed_pending_send` resends `audio_playback_failed` after reconnect.
- [ ] `authenticated.backend_state=idle` clears stale request after backend restart/loss of in-memory state.
- [ ] `backend_state=thinking` resumes same `active_request_id`.
- [ ] `backend_state=audio_ready` accepts replayed still-valid `audio_ready`.

## J. Error behavior

- [ ] Handle `NO_SPEECH`.
- [ ] Handle `INVALID_AUDIO`.
- [ ] Handle `STT_FAILED`.
- [ ] Handle `HERMES_FAILED`.
- [ ] Handle `TTS_FAILED`.
- [ ] Handle `AUDIO_EXPIRED`.
- [ ] Handle `PIPELINE_TIMEOUT`.
- [ ] Handle `INTERNAL_ERROR`.
- [ ] Show error expression for failures.
- [ ] Play local no-speech/noisy audio when possible.
- [ ] Play generic local recoverable-error audio when possible.
- [ ] Local error expression still works if audio output itself failed.

## K. Security / production transport

- [ ] Use HTTPS/WSS production endpoint only after deployment is verified.
- [ ] Confirm the current `DEPLOYMENT-CONFIG.md` still says `VERIFIED` before each physical test session.
- [ ] Validate TLS certificates.
- [ ] Do not log device token.
- [ ] Do not send credentials to internal service ports.

## L. Final integration

- [ ] `DEPLOYMENT-CONFIG.md` says `VERIFIED`.
- [ ] Fake ESP32 public-domain E2E is PASS.
- [ ] Execute all physical tests in `ACCEPTANCE-TESTS.md`.
- [ ] Record firmware build ID and request IDs used as evidence.
