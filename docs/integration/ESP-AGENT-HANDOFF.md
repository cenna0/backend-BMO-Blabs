# Joy ESP / Hardware Agent Handoff
> **CURRENT / CANONICAL**
> Backend/VPS code-only pairing and streaming voice pipeline are production-deployed.
> The external ESP32-S3 repository reports 105/105 contract tests across 14 suites; physical bench acceptance remains `PENDING_PHYSICAL_ESP`.

---

## Endpoint and repository boundary
- **Hardware WSS**: `wss://api.personalbmo.web.id/ws`
- **Voice Upload**: `POST https://api.personalbmo.web.id/api/v1/voice` (Canonical WAV 16kHz 16-bit Mono PCM)
- **Audio Download**: `GET https://api.personalbmo.web.id/audio/:audioId.mp3` (MP3 Chunked Streaming)
- **Hardware Auth**: existing `device_id` / `device_token` (e.g. `joy-001`)
- `DEVICE_TOKEN` is hardware ↔ Backend only and never goes to Mobile.
- Dedicated hardware repository: `/Users/ranggabiner/binerlabs/Joy-1-2` (ESP-IDF C++ Project in `esp/`).

---

## Immediate milestone: `HW_VPS_CONNECTION_STABLE`
Prove this sequence before pairing work:
1. Wi-Fi association;
2. DNS resolution of `api.personalbmo.web.id`;
3. correct device time through SNTP/NTP;
4. TLS certificate-chain, hostname, and SNI validation (`esp_crt_bundle_attach`);
5. WSS upgrade to `wss://api.personalbmo.web.id/ws`;
6. first JSON message within five seconds: `authenticate` using the existing hardware identity/token;
7. receive `authenticated`;
8. maintain native server ping/pong liveness (60s heartbeat);
9. bounded reconnect and re-authentication;
10. preserve existing wakeword, whole-WAV upload, MP3 playback, and completion continuity.

---

## Exact current source events

### Hardware → Backend:
```text
authenticate
audio_playback_done
audio_playback_failed
voice_reserve
voice_cancel
proactive_offer_accepted
proactive_done
proactive_failed
wifi_configuration_received
wifi_configuration_result
device_log
device_telemetry
device_settings_applied
pairing_mode_request
```

### Backend → hardware:
```text
authenticated
authentication_failed
connection_replaced
display_status
audio_ready
request_failed
voice_reserve_accepted
voice_reserve_rejected
voice_reserve_expired
proactive_offer
proactive_audio_ready
proactive_cancel
display_qr
clear_qr
wifi_configuration
device_settings
pairing_code
pairing_completed
```

Authority: `backend/src/websocket/events.ts`,
[`02-BACKEND-DEVICE-ADDITIVE-CONTRACT.md`](02-BACKEND-DEVICE-ADDITIVE-CONTRACT.md),
[`11-FULL-ECOSYSTEM-ARCHITECTURE-AND-STATUS.md`](11-FULL-ECOSYSTEM-ARCHITECTURE-AND-STATUS.md),
and the immutable existing voice contract
[`../hardware-contract/BMO-MVP-HW-INTERFACE-CONTRACT-v1.0.5.md`](../hardware-contract/BMO-MVP-HW-INTERFACE-CONTRACT-v1.0.5.md).

---

## Status Fitur Firmware Terverifikasi (`Joy-1-2`)

1. **Non-Blocking Wake Acknowledgment Cue (Earcon)**:
   - Dedicated worker task `wake_ack_worker_task` pada Core 0 di `audio.cpp`.
   - Dipicu seketika WakeNet mendeteksi wake word *"Hi Joy"* via `audio_triggerWakeAck()`.
   - Memutar `wake_ack.wav` (<=600ms, 16kHz mono WAV) atau dual-tone chime (659Hz -> 880Hz) melalui MAX98357A dengan **0ms blocking delay** pada microphone recording loop.

2. **Seamless Single-Breath Wake Word Capture**:
   - Rolling circular pre-roll buffer (`PREROLL_BUFFER_SAMPLES = 8192` / ~512ms pada 16kHz mono PCM) aktif selama state `IDLE`.
   - User dapat berbicara kalimat perintah langsung dalam satu tarikan nafas (contoh: *"Hi Joy jam berapa sekarang"*).
   - Seluruh buffer pre-roll otomatis dikomit ke `record_buffer` saat `start_recording()` aktif.

3. **Dynamic Thinking Filler Voice Speech ("Zero Dead-Air Latency Masking")**:
   - Begitu upload WAV diterima dengan HTTP `202 Accepted` (`Joy_UPLOAD_ACCEPTED`), firmware seketika memutar 1 dari 5 clip WAV filler berbahasa Indonesia (`thinking_01.wav` .. `thinking_05.wav`) melalui speaker I2S.
   - Menghilangkan jeda hening selama LLM dan TTS backend memproses jawaban.

4. **Shared Playback Job Architecture (`PlaybackJob`)**:
   - Abstraksi `PlaybackJob` di `playback.cpp` mengatur hak kepemilikan speaker DAC tunggal (arbitrasi eksklusif).
   - Voice audio diprioritaskan utama; proactive delivery diisolasi secara aman.

5. **Development Pairing UI Suppression**:
   - Compile-time flag `JOY_DEV_SUPPRESS_PAIRING_UI=ON` memungkinkan firmware development menguji flow pairing tanpa merender 6-digit PIN ke LCD.

6. **Python Contract Test Suite**:
   - **105/105 Tests Passing (100% across 14 test suites)** di `esp/tests/` (`python3 -m unittest discover -s esp/tests`).

---

## Pairing Flow (6-Digit PIN)

1. An authenticated unbound device receives `pairing_code` (`code: "123564"`, `expires_at: "..."`).
2. Firmware displays the six digits on LCD (or suppresses display when `JOY_DEV_SUPPRESS_PAIRING_UI=ON`).
3. Mobile user submits the PIN via `POST /api/v1/pairing/claim {"code":"123564"}` with their JWT Bearer token.
4. Backend binds the hardware device to the user account and sends `pairing_completed` over `/ws`.
5. Firmware clears pairing UI, closes old socket, and reconnects/re-authenticates with unchanged hardware credential.
