# Joy Ecosystem End-to-End Integration Guide
> **STATUS: CANONICAL / PRODUCTION-ALIGNED**
> Panduan integrasi komprehensif antara **ESP32-S3 Hardware Client (Joy-1-2)**, **Joy Mobile App (joy-mobile)**, dan **Joy Backend Ecosystem (P9 Platform + Streaming Voice Pipeline)**.

---

## 1. Arsitektur Komprehensif Ekosistem

Ekosistem Joy terdiri atas tiga pilar utama yang saling terintegrasi:

```mermaid
graph TD
    subgraph Hardware ["Hardware Layer (ESP32-S3 / Joy-1-2)"]
        ESP[ESP32-S3 Microcontroller]
        MIC[INMP441 I2S Mic] --> ESP
        ESP --> AMP[MAX98357A I2S Amp / Speaker]
        ESP --> LCD[ILI9341 320x240 SPI LCD]
        TOUCH[GPIO 14 Touch Sensor] --> ESP
        BTN[GPIO 15/16 Vol Up/Down] --> ESP
    end

    subgraph Backend ["Joy Backend Ecosystem (VPS joy-vps)"]
        CADDY[Caddy Reverse Proxy :443 / TLS]
        GATEWAY[Node.js 22 Express Gateway :3000]
        CADDY --> GATEWAY
        
        WSS_DEV[Device WebSocket Server : /ws]
        WSS_MOB[Mobile WebSocket Server : /api/v1/ws]
        REST_API[REST API Router : /api/v1/*]
        
        GATEWAY --> WSS_DEV
        GATEWAY --> WSS_MOB
        GATEWAY --> REST_API

        PIPE[Voice Pipeline Service]
        TEMP_AUDIO[Temp Audio & LiveAudioStream]
        P9_SERVICES[P9 Services: Auth, Pairing, Memory, Schedule, Integrations]
        DB[(PostgreSQL 16 Database)]
        
        GATEWAY --> PIPE
        GATEWAY --> P9_SERVICES
        P9_SERVICES --> DB
        PIPE --> TEMP_AUDIO

        AUDIO_SVC[Audio Service FastAPI :8001]
        HERMES_LLM[Hermes Core LLM / Fast Voice LLM]
        
        PIPE --> AUDIO_SVC
        PIPE --> HERMES_LLM
    end

    subgraph Mobile ["Mobile App Layer (joy-mobile / Expo React Native)"]
        MOB_APP[Joy Mobile App]
        MOB_APP -->|HTTPS REST : /api/v1/*| CADDY
        MOB_APP -->|WSS : /api/v1/ws| CADDY
    end

    ESP -->|WSS /ws & HTTPS POST /voice| CADDY
    ESP -->|HTTPS GET /audio/*.mp3| CADDY
```

---

## 2. Matriks Boundary & Endpoint Ekosistem

| Komponen | Protokol | Endpoint / Port | Fungsi Utama | Kredensial & Autentikasi |
|---|---|---|---|---|
| **ESP32 Hardware WSS** | `wss://` | `wss://api.personalbmo.web.id/ws` | Event stream hardware, display status, audio ready, pairing code | `{"event":"authenticate", "device_id":"joy-001", "device_token":"..."}` |
| **ESP32 Audio Upload** | `https://` | `POST https://api.personalbmo.web.id/api/v1/voice` | Upload Canonical WAV (16kHz 16-bit Mono PCM) | Header: `X-Device-Id`, `X-Device-Token`, `X-Request-Id: UUIDv4` |
| **ESP32 Audio Download** | `https://` | `GET https://api.personalbmo.web.id/audio/:audioId.mp3` | MP3 Audio Stream (Chunked / Direct Transfer Encoding) | Tokenless public ephemeral URL ($\text{TTL} = 300\text{s}$) |
| **Joy Mobile WSS** | `wss://` | `wss://api.personalbmo.web.id/api/v1/ws` | Event stream mobile, chat thinking, notifications, integrations | `{"event":"authenticate", "accessToken":"<JWT>"}` |
| **Joy Mobile REST** | `https://` | `https://api.personalbmo.web.id/api/v1/*` | Auth, chat, robot pairing, memory, schedules, plugins, support | Header: `Authorization: Bearer <JWT>`, `X-Request-Id: UUIDv4` |
| **Mobile TTS Synthesize** | `https://` | `POST https://api.personalbmo.web.id/api/v1/tts/synthesize` | Sintesis audio ucapan instan untuk aplikasi mobile | Header: `Authorization: Bearer <JWT>`, Body: `{"text":"..."}` |

---

## 3. Alur Voice Interaction & Audio Pipeline

```mermaid
sequenceDiagram
    autonumber
    participant U as User
    participant ESP as ESP32-S3 (Joy-1-2)
    participant WSS as Backend Device WSS (/ws)
    participant Pipe as Voice Pipeline (Hermes + SentenceSplitter)
    participant Audio as Audio Service (STT + TTS)
    participant Stream as Temp Audio / LiveAudioStream

    Note over U,ESP: 1. Wake-up Detection & Earcon
    U->>ESP: Ucapkan "Hi Joy" / Sentuh GPIO 14
    ESP->>ESP: WakeNet Detect "Hi Joy"
    ESP->>U: Play Wake-up Ack Cue ("wake_ack.wav" / 659->880Hz chime) via Core 0 worker
    ESP->>ESP: JoyState::RECORDING (Display: LISTENING)
    Note over ESP: Rolling circular pre-roll buffer (~512ms) mengalirkan audio tanpa jeda

    Note over U,ESP: 2. Voice Capture & VAD
    U->>ESP: Bicara: "Halo Joy, apa rencana hari ini?"
    ESP->>ESP: VAD hening terdeteksi -> Validasi Canonical WAV 16kHz Mono

    Note over ESP,Pipe: 3. Audio Upload & Dynamic Thinking Filler
    ESP->>WSS: POST /api/v1/voice (Content-Type: audio/wav, X-Request-Id: UUID)
    WSS-->>ESP: HTTP 202 {"request_id":"...", "status":"processing"}
    ESP->>ESP: JoyState::THINKING (Display: THINKING)
    ESP->>U: Putar Dynamic Thinking Filler Clip ("bentar aku pikir dulu", dll.)

    Note over Pipe,Audio: 4. Hermes Streaming & Pipelined TTS
    WSS->>Audio: Faster-Whisper Transcribe WAV (~350ms)
    WSS-->>ESP: WS {"event":"display_status", "status":"thinking", "transcript":"..."}
    Pipe->>Pipe: Hermes SSE Stream (stream: true) -> SentenceSplitter
    Pipe->>Audio: Pipelined TTS Synthesis (Sentence 1 -> Sentence 2)
    Audio-->>Stream: Write MP3 chunk to LiveAudioStream
    WSS-->>ESP: WS {"event":"audio_ready", "request_id":"...", "audio_url":"...", "format":"mp3"} (TTFA ~1.7s)

    Note over ESP,U: 5. Playback & Playback Completion
    ESP->>Stream: HTTPS GET audio_url (Chunked MP3 Streaming)
    ESP->>ESP: Helix MP3 Decoder -> I2S MAX98357A (Display: SPEAKING)
    ESP->>U: Suara Joy keluar dari speaker
    ESP->>WSS: WS {"event":"audio_playback_done", "request_id":"..."}
    ESP->>ESP: JoyState::IDLE (Display: Face Expression)
```

---

## 4. Alur Device Pairing 6-Digit (Mobile <-> ESP32 <-> Backend)

```mermaid
sequenceDiagram
    autonumber
    participant ESP as ESP32-S3 Client
    participant WSS as Backend Gateway (/ws)
    participant DB as PostgreSQL Database
    participant Mob as Joy Mobile App

    Note over ESP,WSS: 1. Unbound Device Connection
    ESP->>WSS: WSS Connect & Authenticate (device_id: joy-001)
    WSS->>DB: Check Device Binding status
    DB-->>WSS: Device is UNBOUND
    WSS-->>ESP: WS {"event":"pairing_code", "code":"123564", "expires_at":"..."}
    ESP->>ESP: Render 6-digit PIN pada LCD (atau suppress jika JOY_DEV_SUPPRESS_PAIRING_UI=ON)

    Note over Mob,WSS: 2. Mobile User Claims Device
    Mob->>Mob: User input PIN "123564" pada RobotPairSheet
    Mob->>WSS: POST /api/v1/pairing/claim {"code":"123564"} (with Bearer Token)
    WSS->>DB: Bind Device `joy-001` to User Account
    DB-->>WSS: Binding SUCCESS
    WSS-->>Mob: HTTP 200 {"device": {"id":"...", "name":"Joy", "pairedAt":"..."}}

    Note over WSS,ESP: 3. Pairing Completion & Re-Auth
    WSS-->>ESP: WS {"event":"pairing_completed", "status":"ok"}
    ESP->>ESP: Clear Pairing UI & Reconnect WSS with bound state
    ESP->>WSS: WSS Authenticate
    WSS-->>ESP: WS {"event":"authenticated", "status":"ok", "backend_state":"idle"}
```

---

## 5. Fitur Integrasi Superpowers (Spotify, WhatsApp, Memory, Schedules)

### A. Spotify Integration
- **OAuth Connect**: `GET /api/v1/integrations/spotify/auth?returnTo=...` menghasilkan authorization URL Spotify.
- **Status Polling**: `GET /api/v1/integrations/spotify/status` mengembalikan status `CONNECTED`, `PENDING`, atau `DISCONNECTED`.
- **Playback & Controls**: `GET /api/v1/integrations/spotify/playback` dan `POST /api/v1/integrations/spotify/actions` (`PLAY`, `PAUSE`, `NEXT`, `PREVIOUS`, `SEEK`, `VOLUME`). Token dienkripsi dengan AES-GCM di backend.

### B. WhatsApp Hermes Integration
- **Pairing & QR**: `GET /api/v1/integrations/whatsapp/qr` mengembalikan QR string untuk di-scan via WhatsApp Linked Devices.
- **Konfirmasi**: `POST /api/v1/integrations/whatsapp/confirm` mengaktifkan status bridge WhatsApp.
- **Notification Rules**: `GET` / `PUT /api/v1/integrations/whatsapp/rules` mengatur forwarding pesan WhatsApp penting ke Joy.

### C. Long-Term Memory & Summaries
- **Memory Settings**: `GET` / `PATCH /api/v1/settings/memory` (mengatur preferensi penyimpanan memori).
- **Summary**: `GET /api/v1/memory/summary`, `POST /api/v1/memory/summary/regenerate`, `POST /api/v1/memory/summary/feedback`.

### D. Schedules & Proactive Reminders
- **Schedule Management**: `POST /api/v1/schedules` (membuat reminder harian), `POST /api/v1/schedules/:id/pause`, `POST /api/v1/schedules/:id/resume`, `DELETE /api/v1/schedules/:id`.
- **Proactive Delivery**: Backend mengirimkan proactive speech event ke physical ESP32 (`PlaybackJob` origin `PROACTIVE`) atau push notification ke mobile app.

---

## 6. Matrix Error Code & Handling

| Error Code | Asal | Deskripsi | Mitigasi & Tindakan Klien |
|---|---|---|---|
| `NO_SPEECH` | Backend STT | Tidak ada suara manusia yang terdeteksi dalam WAV | Mainkan tone feedback hening; kembali ke IDLE |
| `INVALID_AUDIO` | Backend STT | Format WAV bukan canonical 16kHz 16-bit Mono | Validasi lokal canonical WAV sebelum upload (`validate_canonical_wav()`) |
| `STT_FAILED` | Backend Audio | Transkripsi Faster-Whisper mengalami kegagalan | Mainkan error tone; izinkan user berbicara ulang |
| `HERMES_FAILED` | Backend LLM | Gagal memanggil endpoint Hermes LLM | Retry atau fail request sesuai konfigurasi; production memakai Hermes tanpa auto-switch |
| `TTS_FAILED` | Backend Audio | Gagal sintesis suara Edge-TTS / Piper | Fallback otomatis ke Piper engine di backend |
| `AUDIO_EXPIRED` | Backend / HTTP 410 | File audio MP3 telah melewati TTL 300 detik | Terminal untuk request ID tersebut; jangan lakukan retry download |
| `WEBSOCKET_NOT_CONNECTED` | Backend HTTP 409 | Device belum terautentikasi di WebSocket | Reconnect WSS, lakukan auth, lalu retry upload |
| `DEVICE_BUSY` | Backend HTTP 409 | Request sebelumnya masih aktif diproses | Tunggu hingga transaksi aktif tuntas |
| `DOWNLOAD_FAILED` | ESP32 Playback | Gagal mengunduh stream MP3 dari `audio_url` | ESP mengirim WS `{"event":"audio_playback_failed", "reason":"DOWNLOAD_FAILED"}` |
| `DECODE_FAILED` | ESP32 Playback | Helix decoder corrupt / format audio tidak didukung | ESP mengirim WS `{"event":"audio_playback_failed", "reason":"DECODE_FAILED"}` |
| `PLAYBACK_FAILED` | ESP32 Playback | Gagal output data PCM ke I2S DAC MAX98357A | ESP mengirim WS `{"event":"audio_playback_failed", "reason":"PLAYBACK_FAILED"}` |

---

## 7. Panduan Verifikasi & Test Suite

### A. ESP32-S3 Firmware Contract Tests
Firmware dilengkapi dengan 105 contract test berbasis Python `unittest` di direktori `esp/tests/` (14 modul uji):
```bash
cd esp
python3 -m unittest discover -s esp/tests -v
```
Output:
```text
Ran 105 tests in 1.616s
OK (100% Passing across all 14 test suites)
```

### B. Mobile App Tests
Aplikasi Joy Mobile menggunakan Jest untuk unit testing hooks dan utilities:
```bash
cd /Users/ranggabiner/binerlabs/joy-mobile
npm test
```

### C. Backend Test Suite
Backend dilengkapi dengan unit & integration tests pada directory `backend/tests/`:
```bash
ssh joy-vps "sudo -iu joy-admin bash -c 'cd /opt/joy/app/backend && npm test'"
```
