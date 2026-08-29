# Current Production Runtime Configuration Reference

**Status:** `PRODUCTION_CANONICAL`  
**Host:** `joy-vps` (100.107.88.120)  
**Configuration Paths:** `/opt/joy/config/backend.env`, `/opt/joy/config/audio.env`, and `/opt/joy/config/p9.1/backend.env` (secrets remain outside Git).

Dokumen ini memuat nilai production yang diaudit dari konfigurasi runtime; source defaults dapat berbeda. Secret ditampilkan sebagai [secret] dan tidak disalin ke dokumentasi.

---

## 1. Joy Backend Gateway Variables (`backend.env`)

| Variable Name | Type | Production value | Description |
|---|---|---|---|
| `NODE_ENV` | enum | `production` | Environment mode (`development`, `test`, `production`) |
| `BACKEND_HOST` | string | `127.0.0.1` | Binding address internal (wajib `127.0.0.1` di production) |
| `BACKEND_PORT` | number | `3000` | Port listen HTTP/WebSocket backend |
| `PUBLIC_BASE_URL` | url | `https://api.personalbmo.web.id` | URL publik backend untuk mobile & media |
| `TRUST_PROXY_HOPS` | number | `1` | Jumlah hop reverse proxy Caddy (0..1) |
| `DEVICE_ID` | string | `joy-001` | Hardware default device binding |
| `DEVICE_TOKEN` | string | `[secret]` | Opaque physical device token (min 24 char) |
| `TEMP_AUDIO_DIR` | path | `/opt/joy/temp/audio` | Direktori file MP3 sementara hasil sintesis TTS |
| `TEMP_AUDIO_TTL_SECONDS` | number | `300` | Masa berlaku file audio MP3 (5 menit) |
| `TEMP_AUDIO_CLEANUP_INTERVAL_SECONDS` | number | `30` | Interval garbadge collection audio MP3 |
| `MAX_AUDIO_BYTES` | number | `3145728` | Batas maksimum upload WAV (3 MB) |
| `MAX_AUDIO_DURATION_SECONDS` | number | `60` | Batas maksimum durasi audio input |
| `AUDIO_SERVICE_URL` | url | `http://127.0.0.1:8001` | URL audio microservice internal |
| `INTERNAL_SERVICE_TOKEN` | string | `[secret]` | Token autentikasi internal audio-service |
| `AUDIO_SERVICE_STT_TIMEOUT_MS` | number | `90000` | Timeout STT transcription (90 detik) |
| `AUDIO_SERVICE_TTS_TIMEOUT_MS` | number | `180000` | Timeout TTS synthesis (180 detik) |
| `HERMES_API_URL` | url | `http://127.0.0.1:8642` | Endpoint local Hermes Core |
| `HERMES_API_KEY` | string | `[secret]` | API key Hermes Core |
| `HERMES_MODEL` | string | `hermes-agent` | Nama model Hermes Core |
| `HERMES_CONVERSATION` | string | `joy-001` | Identifier percakapan default |
| `HERMES_SOFT_TIMEOUT_MS` | number | `30000` | Batas soft timeout LLM (30 detik) |
| `HERMES_HARD_TIMEOUT_MS` | number | `180000` | Batas hard timeout LLM (180 detik) |
| `VOICE_LLM_PROVIDER` | enum | `hermes` | Provider aktif (`groq`, `openai`, `hermes`, `auto`) |
| `VOICE_LLM_BASE_URL` | url | `https://api.groq.com/openai/v1` | Base URL Fast Voice LLM |
| `VOICE_LLM_MODEL` | string | `openai/gpt-oss-120b` | Model voice LLM kecepatan tinggi |
| `VOICE_LLM_API_KEY` | string | `[secret]` | API key voice LLM (dapat mewarisi `GROQ_API_KEY`) |
| `VOICE_LLM_REASONING_EFFORT` | enum | `low` | Tingkat reasoning voice LLM (`low`, `medium`, `high`, `none`) |
| `VOICE_LLM_MAX_TOKENS` | number | `150` | Maksimum output token kalimat percakapan |
| `P9_ENABLED` | boolean | `true` | Mengaktifkan arsitektur P9 Platform |
| `DATABASE_URL` | url | `[secret]` | Connection string PostgreSQL Prisma |
| `P9_JWT_SECRET` | string | `[secret]` | Secret key penandatanganan JWT Mobile Auth |
| `P9_PAIRING_PEPPER` | string | `[secret]` | Pepper hashing 6-digit pairing code |
| `P9_WIFI_ENCRYPTION_KEY` | string | `[secret]` | Kunci enkripsi AES-GCM credential Wi-Fi |
| `P9_PROVIDER_ENCRYPTION_KEY`| string | `[secret]` | Kunci enkripsi token integrasi |
| `SPOTIFY_CLIENT_ID` | string | `[secret]` | Spotify App Client ID |
| `SPOTIFY_CLIENT_SECRET` | string | `[secret]` | Spotify App Client Secret |
| `SPOTIFY_CALLBACK_URL` | url | `https://api.personalbmo.web.id/api/v1/integrations/spotify/callback` | Spotify OAuth Callback URL |
| `SPOTIFY_TOKEN_ENCRYPTION_KEY` | string | `[secret]` | Enkripsi token Spotify user |
| `WHATSAPP_BRIDGE_URL` | url | `http://127.0.0.1:3001` | Endpoint Baileys WhatsApp Bridge |
| `WHATSAPP_IDENTITY_RESOLVER_URL` | url | `http://127.0.0.1:3002` | Endpoint WhatsApp Contact Resolver |
| `WHATSAPP_IDENTITY_RESOLVER_TOKEN` | string | `[secret]` | Token akses Identity Resolver |
| `AVATAR_STORAGE_DIR` | path | `/opt/joy/data/avatars` | Direktori file avatar pengguna |
| `BUG_REPORT_STORAGE_DIR` | path | `/opt/joy/data/bug-reports` | Direktori lampiran laporan bug |
| `RESEND_API_KEY` | string | `[secret]` | API key Resend untuk email notification |
| `SUPPORT_NOTIFICATION_EMAIL` | string | [configured outside documentation] | Email penerima laporan masalah |
| `SUPPORT_FROM_EMAIL` | string | [configured outside documentation] | Pengirim email resmi Joy |

---

## 2. Audio Microservice Variables (`audio.env`)

| Variable Name | Type | Production value | Description |
|---|---|---|---|
| `AUDIO_SERVICE_HOST` | string | `0.0.0.0` | Binding host container; host publication remains loopback-only |
| `AUDIO_SERVICE_PORT` | number | `8001` | Binding port internal |
| `INTERNAL_SERVICE_TOKEN` | string | `[secret]` | Token autentikasi internal (min 16 char) |
| `GROQ_API_KEY` | string | `[secret]` | API Key Groq untuk STT Whisper Large v3 Turbo |
| `WHISPER_MODEL` | string | `base` | Ukuran model faster-whisper lokal |
| `WHISPER_MODEL_REPO` | string | `Systran/faster-whisper-base` | Repository model lokal |
| `WHISPER_MODEL_REVISION` | string | `ebe41f70d5b6dfa9166e2c581c45c9c0cfc57b66` | Revision model yang dipin |
| `WHISPER_DEVICE` | string | `cpu` | Device inferensi lokal (`cpu`) |
| `WHISPER_COMPUTE_TYPE` | string | `int8` | Presisi komputasi CPU |
| `WHISPER_CPU_THREADS` | number | `4` | Jumlah thread CPU untuk STT lokal |
| `WHISPER_VAD` | boolean | `true` | Mengaktifkan Voice Activity Detection filter |
| `WHISPER_BEAM_SIZE` | number | `1` | Beam size faster-whisper |
| `WHISPER_HOTWORDS` | string | `Joy, hey Joy, hi Joy` | Kata kunci pembobotan transkrip STT |
| `WHISPER_LANGUAGE` | string | `en` | Bahasa transkripsi yang dikonfigurasi |
| `TTS_PRIMARY_ENGINE` | enum | `edge-tts` | Engine TTS utama (`edge-tts` atau `piper`) |
| `EDGE_TTS_VOICE` | string | `en-US-AnaNeural` | Model suara Edge-TTS |
| `EDGE_TTS_PITCH` | string | `+10%` | Modifikasi pitch nada suara |
| `EDGE_TTS_RATE` | string | `+5%` | Modifikasi kecepatan ucapan |
| `EDGE_TTS_VOLUME` | string | `+50%` | Modifikasi volume suara |
| `PIPER_MODEL` | string | `en_GB-semaine-medium` | Model Piper TTS lokal offline |
| `PIPER_SPEAKER` | string | `prudence` | Profil pembicara Piper TTS |
| `PIPER_SPEAKER_ID` | number | `0` | Speaker ID Piper |
