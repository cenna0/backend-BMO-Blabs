# Joy Backend — Public API and WebSocket Contract

**Version:** 3.2.0  
**Status:** CANONICAL PRODUCTION INTERFACE  
**Authority:** Hardware Contract v1.0.5 & P9.1 Production Platform

Dokumen ini mendefinisikan seluruh kontrak antarmuka publik dan internal antara Joy Backend dengan Perangkat Hardware (ESP32-S3), Aplikasi Joy Mobile (iOS/Android), serta health check load balancer/Caddy.

---

## 1. Ringkasan Endpoint & Protokol

```text
Hardware WebSocket:  wss://api.personalbmo.web.id/ws
Hardware Voice In:   POST https://api.personalbmo.web.id/api/v1/voice
Hardware Audio Out:  GET https://api.personalbmo.web.id/audio/:audioId.mp3
Mobile WebSocket:    wss://api.personalbmo.web.id/api/v1/ws
Mobile REST API:     https://api.personalbmo.web.id/api/v1/*
TTS Synthesis:       POST https://api.personalbmo.web.id/api/v1/tts/synthesize
Push Notification:   POST|DELETE|GET https://api.personalbmo.web.id/api/v1/settings/push-tokens
Health Checks:       GET https://api.personalbmo.web.id/readyz, /livez, /health
```

---

## 2. Kontrak Perangkat Keras ESP32 (Hardware Voice Interface)

### 2.1 Upload Audio Suara (`POST /api/v1/voice`)
ESP32 mengunggah rekaman suara pengguna ke backend melalui HTTP POST.

- **Header Wajib**:
  ```http
  X-Device-Id: joy-001
  X-Device-Token: <secret-device-token>
  X-Request-Id: <uuid-v4>
  Content-Type: audio/wav
  Content-Length: <bytes>
  ```
- **Header Opsional (Voice Reservation Protocol)**:
  ```http
  X-Voice-Lease-Id: <uuid-v4>
  X-Voice-Reserve-Receipt: <string>
  ```
- **Spesifikasi WAV PCM**:
  - Format: RIFF WAV PCM signed 16-bit little-endian
  - Sample Rate: 16.000 Hz (16 kHz)
  - Channels: 1 (Mono)
  - Maksimal Ukuran: 3.145.728 bytes (3 MB)
  - Maksimal Durasi: 60 detik
- **Prasyarat**: Koneksi WebSocket `/ws` harus dalam status aktif dan terautentikasi.
- **Respons HTTP**:
  - `202 Accepted`: Upload valid diterima, proses pipeline dimulai asynchronous:
    ```json
    {
      "request_id": "1340f6a2-5438-48f0-922e-d4b78483c804",
      "status": "processing"
    }
    ```
  - `200 OK`: Duplicate request ID yang valid (`{"request_id":"...","status":"processing|audio_ready|completed","duplicate":true}`).
  - `401 Unauthorized`: Device credential salah (`INVALID_DEVICE_CREDENTIALS`).
  - `409 Conflict`: WebSocket belum terhubung (`WEBSOCKET_NOT_CONNECTED`) atau device sedang memproses request lain (`DEVICE_BUSY`).
  - `413 Payload Too Large`: Ukuran WAV melebihi 3 MB (`AUDIO_TOO_LARGE`).
  - `415 Unsupported Media Type`: Header bukan `audio/wav` (`UNSUPPORTED_AUDIO_TYPE`).
  - `422 Unprocessable Entity`: Struktur RIFF WAV PCM tidak valid (`INVALID_AUDIO_FORMAT`).

### 2.2 Pengambilan Audio Output (`GET /audio/:audioId.mp3`)
ESP32 mengunduh file audio respons Joy yang telah disintesis:
- **Format Respons**: Audio MPEG Layer 3 (MP3), 24 kHz Mono, 96 kbps.
- **Header Respons**:
  ```http
  Content-Type: audio/mpeg
  Transfer-Encoding: chunked
  Cache-Control: public, max-age=300
  ```
- **Durasi Kedaluwarsa (TTL)**: 300 detik (5 menit) sejak audio selesai dibuat.

---

## 3. Protokol Hardware WebSocket (`wss://api.personalbmo.web.id/ws`)

### 3.1 Handshake & Autentikasi
1. ESP32 membuka koneksi TCP WSS ke `/ws`.
2. ESP32 **wajib** mengirim event `authenticate` dalam waktu 5 detik:
   ```json
   {
     "event": "authenticate",
     "device_id": "joy-001",
     "device_token": "secret-device-token"
   }
   ```
3. Backend membalas:
   ```json
   { "event": "authenticated", "status": "ok", "device_id": "joy-001", "backend_state": "idle", "active_request_id": null }
   ```
   Atau jika gagal:
   ```json
   { "event": "authentication_failed", "error": "INVALID_DEVICE_CREDENTIALS" }
   ```

### 3.2 Alur Percakapan Normal
1. ESP32 merekam audio, memulai upload `POST /api/v1/voice`.
2. Backend mengirim status indikator layar ke ESP32:
   ```json
   { "event": "display_status", "request_id": "uuid", "status": "thinking" }
   ```
3. Pipeline AI memproses Groq Whisper STT (dengan local faster-whisper fallback) -> Hermes Core production provider -> Edge-TTS (dengan Piper fallback) -> FFmpeg.
4. Backend mengirim event `audio_ready` berisi URL MP3 dan transkrip teks:
   ```json
   {
     "event": "audio_ready",
     "request_id": "1340f6a2-5438-48f0-922e-d4b78483c804",
     "audio_url": "https://api.personalbmo.web.id/audio/a1b2c3d4.mp3",
     "format": "mp3",
     "expires_in_seconds": 300,
     "transcript": "Halo Joy, apa kabar?",
     "response_text": "Aku baik banget! Kamu gimana?",
     "text": "Aku baik banget! Kamu gimana?"
   }
   ```
5. ESP32 mengunduh MP3, memutar via I2S DAC, lalu mengirim konfirmasi selesai:
   ```json
   {
     "event": "audio_playback_done",
     "request_id": "1340f6a2-5438-48f0-922e-d4b78483c804"
   }
   ```
6. Firmware returns to IDLE after playback; the source hardware schema only defines display_status with status thinking.

### 3.3 Penanganan Error (`request_failed`)
Jika terjadi kegagalan pada tahapan pipeline mana pun, backend mengirim:
```json
{
  "event": "request_failed",
  "request_id": "1340f6a2-5438-48f0-922e-d4b78483c804",
  "code": "STT_FAILED",
  "recoverable": true
}
```
**Daftar Kode Error**:
- `NO_SPEECH`: Tidak ada suara pengguna yang terdeteksi (audio kosong/hening).
- `INVALID_AUDIO`: File WAV rusak atau spesifikasi tidak sesuai.
- `STT_FAILED`: Layanan transkripsi gagal.
- `HERMES_FAILED`: Layanan LLM gagal merespons.
- `TTS_FAILED`: Layanan sintesis suara gagal.
- `AUDIO_EXPIRED`: URL audio diakses setelah melewati batas TTL 300 detik.
- `PIPELINE_TIMEOUT`: Total waktu pemrosesan melebihi batas waktu (default 300 detik).
- `INTERNAL_ERROR`: Kesalahan tak terduga pada server backend.

---


### 3.4 WhatsApp QR Display Protocol (`display_qr` & `clear_qr`)
1. Backend / WhatsApp Bridge mengirim event `display_qr` saat sesi pairing WhatsApp dimulai:
   ```json
   {
     "event": "display_qr",
     "qr": "2@abc...xyz,123...",
     "expires_at": "2026-08-27T10:10:00.000Z"
   }
   ```
2. ESP32 meng-generate visual QR code secara realtime via library `qrcodegen` dan menampilkannya pada layar TFT LCD ILI9341 320x240.
3. Saat user selesai scan via WhatsApp Linked Devices atau sesi kedaluwarsa, backend mengirim `clear_qr`:
   ```json
   {
     "event": "clear_qr"
   }
   ```
   ESP32 membersihkan layar dan kembali ke animasi wajah `IDLE`.

---

## 4. Protokol Proactive Speech & Voice Reservation

### 4.1 Voice Capture Reservation
Digunakan untuk mengamankan slot audio capture hardware secara terkoordinasi:
- **Inbound (ESP32 -> Backend)**:
  - `voice_reserve`: `{"event": "voice_reserve", "request_id": UUID}`
  - `voice_cancel`: `{"event": "voice_cancel", "request_id": UUID, "lease_id": UUID, "reserve_receipt": string, "reason": "NO_SPEECH"|"LOCAL_ABORT"|"UPLOAD_HANDOFF_FAILED"}`
- **Outbound (Backend -> ESP32)**:
  - `voice_reserve_accepted`: `{"event": "voice_reserve_accepted", "request_id": UUID, "lease_id": UUID, "reserve_receipt": string, "capture_lease_duration_seconds": 45, "capture_lease_expires_at": ISO}`
  - `voice_reserve_rejected`: `{"event": "voice_reserve_rejected", "request_id": UUID, "reason": "UNAUTHENTICATED"|"NOT_IDLE"|"BUSY"|"STALE_REQUEST"}`
  - `voice_reserve_expired`: `{"event": "voice_reserve_expired", "request_id": UUID, "lease_id": UUID, "reserve_receipt": string}`

### 4.2 Proactive Schedule Delivery
Digunakan ketika backend memicu jadwal pengingat untuk disuarakan langsung di robot Joy:
- **Backend -> ESP32**:
  - `proactive_offer`: `{"event": "proactive_offer", "delivery_id": UUID, "attempt_id": UUID, "offer_receipt": string, "expires_at_ms": number}`
  - `proactive_audio_ready`: `{"event": "proactive_audio_ready", "source": "SCHEDULE", "delivery_id": UUID, "attempt_id": UUID, "lease_id": UUID, "audio_url": URL, "audio_receipt": string, "expires_at_ms": number}`
  - `proactive_cancel`: `{"event": "proactive_cancel", "source": "SCHEDULE", "delivery_id": UUID, "attempt_id": UUID, "lease_id": UUID}`
- **ESP32 -> Backend**:
  - `proactive_offer_accepted`: `{"event": "proactive_offer_accepted", "delivery_id": UUID, "attempt_id": UUID, "offer_receipt": string}`
  - `proactive_done`: `{"event": "proactive_done", "source": "SCHEDULE", "delivery_id": UUID, "attempt_id": UUID, "lease_id": UUID, "audio_receipt": string, "reason": "COMPLETED"}`
  - `proactive_failed`: `{"event": "proactive_failed", "source": "SCHEDULE", "delivery_id": UUID, "attempt_id": UUID, "lease_id": UUID, "audio_receipt": string, "reason": "DOWNLOAD_FAILED"|"DECODE_FAILED"|"PLAYBACK_FAILED"|"CANCELLED"|"LEASE_EXPIRED"|"WATCHDOG_STALLED"}`

---

## 5. Health Checks & Diagnostic Probes

- **Liveness Probe**: `GET /livez` -> `{"status":"ok"}` (HTTP 200)
- **Readiness Probe**: `GET /readyz` / `GET /health` -> `{"status":"ok", ...}` (HTTP 200 jika DB & Audio Service siap, HTTP 503 jika tidak siap).
- **Database Ops Probes**:
  - `GET /api/v1/ops/db/livez` -> DB connection liveness
  - `GET /api/v1/ops/db/readyz` -> DB connection pool readiness
  - `GET /api/v1/ops/db/migrations` -> Applied Prisma migrations list
