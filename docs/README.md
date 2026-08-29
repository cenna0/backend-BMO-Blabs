# Joy Documentation — Central Knowledge Base & Entry Point

> **STATUS: CURRENT / PRODUCTION CANONICAL**  
> Halaman ini merupakan pusat navigasi dokumentasi teknis arsitektur, API/WebSocket contract, voice pipeline, dan integrasi ekosistem Joy.

**Last Updated:** 2026-08-29  
**Production Status:** Hybrid Microservice (Node.js 22 Backend Gateway + Python FastAPI Audio Service + PostgreSQL 16 + Caddy TLS Reverse Proxy)

---

## 🎯 Panduan Memulai Cepat (Audience Entrypoints)

### 1. 📱 Mobile App Developers & AI Agents
Silakan mulai dari dokumen handoff mobile:
1. [`integration/MOBILE-AGENT-HANDOFF.md`](integration/MOBILE-AGENT-HANDOFF.md) — Panduan integrasi mobile.
2. [`integration/00-START-HERE.md`](integration/00-START-HERE.md) — Konteks arsitektur mobile.
3. [`integration/01-MOBILE-BACKEND-API-CONTRACT.md`](integration/01-MOBILE-BACKEND-API-CONTRACT.md) — Kontrak REST API & Mobile WebSocket.
4. [`integration/09-ENDPOINT-EVENT-COVERAGE-MATRIX.md`](integration/09-ENDPOINT-EVENT-COVERAGE-MATRIX.md) — Matriks seluruh 98 registered HTTP route & WebSocket events.
5. [`p9/26-push-notifications.md`](p9/26-push-notifications.md) — Dokumentasi integrasi Expo Push Notifications.
6. [`p9/06-database-schema-prisma.md`](p9/06-database-schema-prisma.md) — Referensi skema lengkap 43 model database.
7. [`integration/11-FULL-ECOSYSTEM-ARCHITECTURE-AND-STATUS.md`](integration/11-FULL-ECOSYSTEM-ARCHITECTURE-AND-STATUS.md) — Status ekosistem terkini.

**Mobile Endpoints:**
- **REST Base URL**: `https://api.personalbmo.web.id/api/v1`
- **WebSocket WSS**: `wss://api.personalbmo.web.id/api/v1/ws`

---

### 2. ⚡ ESP32 / Firmware Developers & Hardware Agents
Silakan mulai dari dokumen handoff hardware:
1. [`integration/ESP-AGENT-HANDOFF.md`](integration/ESP-AGENT-HANDOFF.md) — Panduan integrasi firmware ESP32-S3.
2. [`backend-mvp/02-API-AND-WEBSOCKET-CONTRACT.md`](backend-mvp/02-API-AND-WEBSOCKET-CONTRACT.md) — Spesifikasi protokol voice upload, download & WebSocket.
3. [`integration/02-BACKEND-DEVICE-ADDITIVE-CONTRACT.md`](integration/02-BACKEND-DEVICE-ADDITIVE-CONTRACT.md) — Kontrak additive hardware (Voice Reservation, Proactive Speech, Wi-Fi, Logs, Telemetri).
4. [`p9/27-device-speech-arbiter.md`](p9/27-device-speech-arbiter.md) — Spesifikasi Device Speech Arbiter & sinkronisasi audio speaker hardware.
5. [`hardware-contract/BMO-MVP-HW-INTERFACE-CONTRACT-v1.0.5.md`](hardware-contract/BMO-MVP-HW-INTERFACE-CONTRACT-v1.0.5.md) — Kontrak baseline hardware.

**Hardware Endpoints:**
- **WebSocket WSS**: `wss://api.personalbmo.web.id/ws`
- **Voice Upload**: `POST https://api.personalbmo.web.id/api/v1/voice` (WAV PCM 16-bit 16kHz Mono)
- **Audio Download**: `GET https://api.personalbmo.web.id/audio/:audioId.mp3` (MP3 Chunked Transfer Encoding)

---

## 🏛️ Fakta & Arsitektur Production Terkini

- **Backend Gateway**: Node.js 22 LTS + Express 5.1 + WS 8.21 pada `127.0.0.1:3000` (Container: `joy-production-p9-backend-1`).
- **Audio Service**: Python 3.10/3.12 FastAPI + Uvicorn pada `127.0.0.1:8001` (Container: `joy-production-audio-1`).
- **Database**: PostgreSQL 16.14 Alpine pada `127.0.0.1:5432` dengan 10 Prisma migrations applied (Container: `joy-production-p9-postgres-1`).
- **Public Domain**: `api.personalbmo.web.id` dilayani melalui reverse proxy Caddy (Port 80/443, TLS otomatis Let's Encrypt).
- **STT Engine**: 
  - **Primary**: Cloud Groq Whisper API (`whisper-large-v3-turbo`; production language setting: `en`, latensi ~350-430ms).
  - **Fallback**: Local `faster-whisper` CPU (`Systran/faster-whisper-base`, `int8`, beam size 1, VAD filter enabled, hotwords `Joy, hey Joy, hi Joy`).
- **Voice LLM Engine**: 
  - **Current production provider**: Local Hermes Core (`127.0.0.1:8642`, model `hermes-agent`, endpoint `/v1/chat/completions`).
  - **Optional provider**: Fast Voice LLM via the configured OpenAI-compatible endpoint; it is not the active production provider while `VOICE_LLM_PROVIDER=hermes`.
- **TTS Engine**: 
  - **Primary**: Cloud Edge-TTS streaming (`en-US-AnaNeural`, pitch `+10%`, rate `+5%`, volume `+50%`, TTFA ~1.1-1.3s, streaming chunked & batch endpoints).
  - **Fallback**: Local Piper TTS (`en_GB-semaine-medium`, with FFmpeg MP3 encoding, speaker `prudence`).
- **Conversational Action Intents**:
  - **Two-Tier Schedule NLU**: Tier 1 Regex/Lexical parser (`detectScheduleIntent`) + Tier 2 Hermes LLM Fallback (`extractScheduleIntentWithHermes`) dengan toleransi typo/elongasi kata (`hasScheduleCue`) dan zona waktu Jakarta (`Asia/Jakarta`).
  - **Spotify Playback Control**: Deteksi otomatis aksi `PLAY`, `PAUSE`, `RESUME`, `NEXT`, `PREVIOUS` (`detectSpotifyIntent`) via Spotify Web API.
- **Push Notification & Speech Concurrency**:
  - **Mobile Push**: Expo Push Notification API via `PushNotificationService` dan model `MobilePushToken`.
  - **Speech Arbiter**: Sinkronisasi audio fisik ESP32 via `DeviceSpeechArbiterService` dan PostgreSQL advisory locks (`pg_advisory_xact_lock`).

---

## 📖 Indeks Lengkap Dokumentasi Teknis

| Kategori | Dokumen | Deskripsi |
|---|---|---|
| **Ecosystem Overview** | [`integration/11-FULL-ECOSYSTEM-ARCHITECTURE-AND-STATUS.md`](integration/11-FULL-ECOSYSTEM-ARCHITECTURE-AND-STATUS.md) | Arsitektur menyeluruh seluruh ekosistem Joy |
| **Spesifikasi Core API** | [`backend-mvp/02-API-AND-WEBSOCKET-CONTRACT.md`](backend-mvp/02-API-AND-WEBSOCKET-CONTRACT.md) | Spesifikasi lengkap REST API & WebSocket |
| **Mobile Integration** | [`integration/01-MOBILE-BACKEND-API-CONTRACT.md`](integration/01-MOBILE-BACKEND-API-CONTRACT.md) | Kontrak REST API & WebSocket Joy Mobile |
|| **Route Coverage Matrix** | [`integration/09-ENDPOINT-EVENT-COVERAGE-MATRIX.md`](integration/09-ENDPOINT-EVENT-COVERAGE-MATRIX.md) | Matriks 98 registered HTTP route & WebSocket events |
| **Hardware Contract** | [`integration/02-BACKEND-DEVICE-ADDITIVE-CONTRACT.md`](integration/02-BACKEND-DEVICE-ADDITIVE-CONTRACT.md) | Protokol lengkap komunikasi ESP32 |
| **Hardware Handoff** | [`integration/ESP-AGENT-HANDOFF.md`](integration/ESP-AGENT-HANDOFF.md) | Panduan integrasi hardware ESP32-S3 |
| **Arsitektur Backend** | [`backend-mvp/03-BACKEND-ARCHITECTURE.md`](backend-mvp/03-BACKEND-ARCHITECTURE.md) | Arsitektur backend Express & pipelines |
| **Layanan Audio** | [`backend-mvp/04-AUDIO-SERVICE.md`](backend-mvp/04-AUDIO-SERVICE.md) | Implementasi internal Audio Microservice |
| **Runtime Config** | [`backend-mvp/CURRENT-RUNTIME-CONFIG.md`](backend-mvp/CURRENT-RUNTIME-CONFIG.md) | Nilai konfigurasi production & environment |
| **Database Schema** | [`p9/06-database-schema-prisma.md`](p9/06-database-schema-prisma.md) | Skema relasional lengkap 43 model Prisma |
| **Scheduler & NLU** | [`p9/13-scheduler-proactive-speech.md`](p9/13-scheduler-proactive-speech.md) | Two-tier Schedule NLU & Proactive Delivery |
| **Action Intent** | [`p9/18-action-intent-schema.md`](p9/18-action-intent-schema.md) | Skema semantic intent jadwal & Spotify |
| **Push Notifications** | [`p9/26-push-notifications.md`](p9/26-push-notifications.md) | Integrasi Expo Push Notifications |
| **Speech Arbiter** | [`p9/27-device-speech-arbiter.md`](p9/27-device-speech-arbiter.md) | Sinkronisasi konkurensi audio hardware |
| **Operasional & Backup** | [`operations/MAINTENANCE-AND-RECOVERY.md`](operations/MAINTENANCE-AND-RECOVERY.md) | Prosedur maintenance, backup, dan recovery |
