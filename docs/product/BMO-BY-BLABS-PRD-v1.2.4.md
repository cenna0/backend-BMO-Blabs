# BMO BY B-LABS — Product Requirements Document (PRD)

**Versi:** 1.3.1
**Tanggal:** 2026-08-04
**Status:** P9.1 architecture locked and approved; P9 implementation not started

> Dokumen ini menjadi konteks produk utama BMO by B-Labs. Isinya menjelaskan visi, arsitektur, tech stack, scope, keputusan desain, roadmap, dan status project.
>
> Untuk detail voice MVP, gunakan hierarchy dokumentasi current di `docs/README.md`. Public firmware ↔ backend protocol dikunci oleh `docs/hardware-contract/BMO-MVP-HW-INTERFACE-CONTRACT-v1.0.5.md`; detail implementasi backend/audio berada pada active `docs/backend-mvp/` references. Snapshot `BMO-MVP-BACKEND-IMPLEMENTATION-FOR-HERMES-v1.0.5.md` berada di archive dan bukan current execution authority.
>
> Jika terdapat perbedaan pada endpoint, event, payload, timeout, retry, lifecycle file, runtime config, atau deployment status, gunakan hierarchy pada Bab 18 dan jangan menyelesaikan konflik dengan membuat behavior baru.
>
> P9 architecture and application-platform ownership are defined in
> [`docs/p9/README.md`](../p9/README.md). P9.1 decisions are locked as design;
> P9.1–P9.6 runtime implementation still requires separate authorization and
> verification.

---

## 1. Project Overview

**Project Name:** BMO by B-Labs  
**Type:** Physical AI Personal Assistant — IoT + backend + mobile app  
**Inspirasi:** BMO dari *Adventure Time*

### 1.1 Vision

BMO by B-Labs adalah replika fisik BMO yang berfungsi sebagai:

- personal AI assistant berbasis suara;
- Spotify controller;
- WhatsApp notification hub;
- perangkat fisik dengan ekspresi dan personality BMO.

User berinteraksi melalui voice command. BMO memahami Bahasa Indonesia, English, dan campuran keduanya. Jawaban suara BMO selalu menggunakan English, dibacakan melalui TTS lokal dengan karakter suara yang diarahkan mendekati BMO.

### 1.2 Core Goals

- BMO mendengar perintah suara, memprosesnya melalui Hermes, lalu menjawab melalui speaker.
- BMO memiliki ekspresi visual yang mengikuti state interaksi.
- BMO mengontrol Spotify pada perangkat aktif user.
- BMO menerima dan memfilter notifikasi WhatsApp sesuai preferensi user.
- User mengatur sistem melalui aplikasi React Native.
- Sistem modular, dapat diuji per komponen, dan dikembangkan bertahap melalui sprint.

### 1.3 Current MVP Goal

Target voice MVP saat ini:

```text
ESP32 merekam satu WAV utuh
→ upload WAV melalui HTTP
→ faster-whisper melakukan STT lokal
→ Hermes menghasilkan jawaban English
→ Piper Prudence menghasilkan suara utama
→ Kokoro `af_heart` speed `0.80` menjadi fallback otomatis
→ FFmpeg menghasilkan MP3
→ backend mengirim URL MP3 melalui WebSocket
→ ESP32 download dan memutar MP3
```

Spotify, WhatsApp, mobile app lengkap, dan database aplikasi tetap bagian dari visi produk, tetapi tidak termasuk scope implementasi voice MVP pertama.

---

## 2. Struktur Tim dan Kepemilikan

| Peran | Jumlah | Tanggung jawab utama |
|---|---:|---|
| Hardware | 2 orang | ESP32-S3, wake word, microphone, speaker, display, touch sensor, PCB, enclosure, firmware komunikasi |
| Software | 2 orang | Hermes Agent, Express.js backend, Local Audio Service, PostgreSQL/Prisma, React Native, deployment, observability |

### 2.1 Koordinasi SW ↔ HW

- Kontrak teknis voice MVP berada di `docs/hardware-contract/BMO-MVP-HW-INTERFACE-CONTRACT-v1.0.5.md`.
- Tim hardware dan software harus memakai versi kontrak yang sama.
- Perubahan pada endpoint, event, format audio, atau ownership state wajib disepakati bersama.
- Bab 9 PRD hanya memberikan ringkasan. Bab tersebut tidak menggantikan kontrak teknis canonical.

---

## 3. Tech Stack

### 3.1 Software

| Layer | Teknologi | Keterangan |
|---|---|---|
| AI Agent | Hermes Agent | Berjalan langsung di host VPS; menangani personality, reasoning context, dan kemampuan agent; Backend owns application memory |
| LLM | Diatur melalui konfigurasi Hermes | DeepSeek/MiMo menjadi kandidat cost-efficient untuk production; model dapat berubah tanpa mengubah kontrak backend |
| Backend | Express.js + TypeScript | REST API, WebSocket server, voice pipeline orchestration, Spotify, auth, dan integrasi aplikasi |
| Local Audio Service | Python + FastAPI | STT, Piper primary, Kokoro fallback, FFmpeg, audio validation, dan audio processing |
| Database aplikasi | PostgreSQL | User, device, chat, curated memory, schedules, settings, and integration metadata |
| ORM | Prisma ORM | Schema, migration, relational query, dan type-safe client |
| Voice request state MVP | In-memory | Request aktif dan tombstone idempotency; tidak menggunakan PostgreSQL pada voice MVP |
| Mobile App | React Native | Satu codebase untuk iOS dan Android |
| State Management | Zustand | State aplikasi mobile yang ringan dan modular |
| Mobile Auth | Invite-only email/password | Backend verifies Argon2id password, issues short-lived access token, and rotates opaque refresh tokens by hash |
| STT | faster-whisper lokal | Current selected runtime: `medium` multilingual, CPU INT8, auto-detect Indonesia/English/mixed, hotword `BMO` |
| TTS | Piper lokal | `en_GB-semaine-medium`, Prudence, speaker ID `0`; fixed P8 production primary |
| TTS fallback | Kokoro lokal | Voice `af_heart`, speed `0.80`; automatic fallback |
| Voice Conversion | Archived only | RVC runtime/Docker artifacts removed from production; compact evidence and Git history retained |
| Audio Processing | FFmpeg | Normalisasi, resampling, dan output MP3 untuk ESP32 |
| Spotify | Spotify Web API | BMO bertindak sebagai controller; playback berlangsung pada perangkat Spotify user |
| WhatsApp | Hermes WhatsApp gateway | Session dan gateway dikelola internal Hermes |
| Deployment MVP | Single VPS + Docker Compose | Hermes pada host; backend dan Audio Service dalam container |
| SW ↔ HW Communication | WebSocket + HTTP | WebSocket untuk auth/event, HTTP POST untuk WAV, HTTP GET untuk MP3 |

### 3.2 Hardware

| Komponen | Detail |
|---|---|
| MCU | ESP32-S3 |
| Audio input | Microphone onboard/external sesuai desain tim HW |
| Audio output | Speaker + amplifier sesuai desain tim HW |
| Display | Layar badan BMO untuk ekspresi dan informasi |
| Wake word | Berjalan lokal pada ESP32-S3 dan sudah menjadi tanggung jawab tim HW |
| Connectivity | Wi-Fi; ESP32 menjadi client ke backend VPS |

---

## 4. System Architecture

### 4.1 Diagram Overview

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│                                  VPS                                         │
│                                                                              │
│  Host                                                                        │
│  ┌──────────────────────────┐                                                │
│  │ Hermes Agent             │                                                │
│  │ 127.0.0.1:8642           │                                                │
│  │ - personality & memory   │                                                │
│  │ - agent capabilities     │                                                │
│  │ - WhatsApp gateway       │                                                │
│  └─────────────▲────────────┘                                                │
│                │ localhost HTTP                                              │
│                │                                                             │
│  Docker Compose                                                             │
│  ┌─────────────┴────────────┐      localhost HTTP      ┌──────────────────┐  │
│  │ Express.js Backend       │ ◄──────────────────────► │ Local Audio      │  │
│  │ network_mode: host       │                          │ Service/FastAPI   │  │
│  │ - REST API               │                          │ 127.0.0.1:8001    │  │
│  │ - WebSocket server       │                          │ - faster-whisper │  │
│  │ - request orchestration  │                          │ - Kokoro         │  │
│  │ - temp MP3 hosting       │                          │ - RVC            │  │
│  │ - future app features    │                          │ - FFmpeg         │  │
│  └─────────────┬────────────┘                          └──────────────────┘  │
│                │                                                             │
│                │ future application data                                     │
│                ▼                                                             │
│  ┌──────────────────────────┐                                                │
│  │ PostgreSQL + Prisma      │                                                │
│  │ localhost only          │                                                │
│  └──────────────────────────┘                                                │
└───────────────────────┬──────────────────────────────────────────────────────┘
                        │
                        │ WS auth/events + HTTP POST WAV + HTTP GET MP3
                        ▼
              ┌──────────────────────────────┐
              │ ESP32-S3 BMO Device          │
              │ - wake word lokal            │
              │ - rekam WAV                  │
              │ - display state              │
              │ - download/decode MP3        │
              │ - speaker playback           │
              └──────────────────────────────┘

              ┌──────────────────────────────┐
              │ React Native App             │
              │ - invite/email-password auth│
              │ - Spotify OAuth              │
              │ - WhatsApp setup             │
              │ - settings & status          │
              └──────────────┬───────────────┘
                             │ REST API
                             ▼
                     Express.js Backend
```

### 4.2 Tanggung Jawab Komponen

**P8 current-runtime note:** the diagram's historical RVC label is superseded
by Piper Prudence primary with Kokoro fallback. RVC is not a production
service or artifact. P9 adds Backend-owned application data and capability
boundaries described in [`../p9/README.md`](../p9/README.md), without changing
the existing voice transport.

#### ESP32-S3

- Mendeteksi wake word secara lokal.
- Menjaga display tetap `idle` selama wake word dan rekaman lokal.
- Merekam audio sampai diam 2,5 detik atau maksimal 60 detik.
- Menghasilkan WAV PCM signed 16-bit little-endian, 16 kHz, mono.
- Membuka dan mempertahankan WebSocket ke backend.
- Melakukan autentikasi WebSocket melalui message JSON.
- Membuat UUID v4 sebagai request ID.
- Mengunggah satu WAV utuh melalui HTTP raw body `audio/wav`.
- Menerima event `thinking`, `audio_ready`, dan `request_failed`.
- Mengunduh MP3 melalui HTTP dan memutarnya secara lokal.
- Mengaktifkan mode `speaking` ketika playback benar-benar dimulai.
- Mengirim `audio_playback_done` atau `audio_playback_failed`.
- Menampilkan ekspresi error dan memainkan audio error lokal jika pipeline gagal.
- Auto-reconnect WebSocket dengan exponential backoff.

#### Express.js Backend

- Menjadi WebSocket server bagi ESP32.
- Mengautentikasi device dan mengelola koneksi aktif.
- Menerima upload WAV utuh melalui HTTP.
- Memvalidasi credentials, request ID, ukuran, metadata WAV, dan idempotency.
- Menjamin satu request aktif per device.
- Menyimpan state request voice MVP secara in-memory.
- Mengorkestrasi STT → Hermes → Piper/Kokoro → MP3.
- Menyimpan MP3 sementara dengan URL acak dan TTL.
- Mengirim event real-time ke ESP32 melalui WebSocket.
- Menghapus file sementara berdasarkan playback result dan TTL.
- Pada P9, menjadi pemilik application API, chat, settings, memory gateway,
  scheduler, and provider action execution.

#### Hermes Agent

- Berjalan pada `127.0.0.1:8642` dan tidak diekspos ke internet.
- **Runtime role:** bertindak sebagai personal assistant BMO yang menerima transcript melalui endpoint `/v1/responses`.
- Deployment/development VPS dieksekusi oleh Codex/operator project; Hermes diperlakukan sebagai runtime dependency existing yang harus tetap sehat, bukan sebagai executor infrastructure.
- Memahami input Indonesia, English, dan campuran.
- Selalu menghasilkan jawaban suara dalam English.
- Menjaga personality BMO, reasoning context, skills, dan kemampuan agent.
- Tidak menjadi source of truth untuk chat history atau application memory;
  Backend menyediakan scoped context melalui application contracts.
- Mengembalikan teks jawaban yang akan diproses TTS.
- Mengelola WhatsApp gateway pada fase integrasi.
- Pada fase berikutnya, membantu intent/action seperti Spotify dan WhatsApp.

#### Local Audio Service

- Berjalan hanya pada localhost.
- Menjalankan faster-whisper `medium` multilingual, CPU INT8, auto-detect, dengan hotword `BMO`.
- Menjalankan Piper Prudence sebagai production primary.
- Menggunakan Kokoro `af_heart` speed `0.80` sebagai fallback otomatis.
- Tidak menjalankan RVC; archived evidence is not a runtime dependency.
- Menggabungkan waveform TTS menjadi satu audio utuh.
- Menghasilkan MP3 melalui FFmpeg.
- Memuat model saat startup dan menggunakan cache model persisten.

#### PostgreSQL + Prisma

- Menjadi database utama aplikasi BMO pada fase integrasi fitur.
- Menyimpan user, device, Spotify account, notification settings, dan konfigurasi aplikasi.
- Tidak menyimpan state request aktif voice MVP.
- Tidak menyimpan memory internal Hermes sebagai source of truth; P9
  `PostgresMemoryGateway` owns application memory records.
- Tidak menyimpan WhatsApp session Hermes.

P9.1 locks one pinned-major private PostgreSQL container with persistent data
outside Git, an initial 768 MiB memory target, Prisma pool target 5, and an
approximately 20-connection target pending isolated capacity testing. All
initial product times use server-enforced `Asia/Jakarta`; the timezone is not
user-editable and database timestamps are UTC-compatible `timestamptz`.

P9.1 persisted settings are fixed as follows: user settings contain language,
response-length preference, automatic-memory-candidate preference, and the
server-enforced timezone; device settings contain display name, default-device
flag, playback volume, quiet hours, notification behavior, Prudence voice
profile ID, and speech speed. Dynamic Audio Service settings application is
deferred beyond P9.1.

#### React Native Mobile App

- Menjadi entry point setup dan konfigurasi user.
- Menangani authentication/session dan device pairing melalui Backend.
- Menampilkan chat/history, curated memory controls, schedules, settings,
  voice preview, Spotify status, and WhatsApp connection/rules.
- Tidak memanggil Hermes, PostgreSQL, Spotify, atau WhatsApp directly.

---

## 5. Voice Interaction Pipeline — MVP

Voice pipeline berikut adalah alur canonical pada level produk. Detail teknis exact tetap mengikuti dua dokumen voice MVP canonical.

```text
Step 1   User mengucapkan wake word.
Step 2   ESP32 mendeteksi wake word secara lokal.
Step 3   Display tetap pada mode idle selama rekaman.
Step 4   ESP32 merekam WAV PCM 16-bit, 16 kHz, mono.
Step 5   Rekaman berhenti setelah diam 2,5 detik atau mencapai 60 detik.
Step 6   ESP32 membuat UUID v4 sebagai request_id.
Step 7   ESP32 upload raw WAV ke POST /api/v1/voice.
Step 8   Backend memvalidasi auth, WebSocket aktif, request_id, ukuran, dan WAV.
Step 9   Backend membuat request state in-memory dan membalas HTTP 202.
Step 10  Backend mengirim display_status: thinking melalui WebSocket.
Step 11  Backend mengirim WAV ke Local Audio Service /stt/transcribe.
Step 12  faster-whisper melakukan auto-detect Indonesia/English/mixed.
Step 13  Jika tidak ada speech yang berguna, backend mengirim request_failed: NO_SPEECH.
Step 14  Backend mengirim transcript ke Hermes POST /v1/responses.
Step 15  Hermes menghasilkan jawaban English plain text.
Step 16  Backend mengirim jawaban utuh ke Local Audio Service /tts/synthesize.
Step 17  Piper Prudence menghasilkan WAV utama.
Step 18  Jika Piper gagal, Audio Service memakai Kokoro `af_heart` speed `0.80`.
Step 19  FFmpeg menghasilkan MP3 utuh.
Step 20  Backend menghapus WAV input setelah MP3 berhasil dibuat.
Step 21  Backend menyimpan MP3 sementara dengan TTL 5 menit.
Step 22  Backend mengirim event audio_ready dengan URL MP3.
Step 23  ESP32 download MP3 melalui HTTP.
Step 24  Firmware mengaktifkan speaking saat playback benar-benar mulai.
Step 25  Setelah playback, ESP32 mengirim audio_playback_done atau audio_playback_failed.
Step 26  Backend menghapus MP3, melepas busy state, dan menyimpan tombstone sementara.
Step 27  Firmware kembali ke idle.
```

### 5.1 Voice Input

```text
Container    : WAV RIFF
Codec        : PCM signed 16-bit little-endian
Sample rate  : 16 kHz
Channel      : mono
Stop normal  : diam 2,5 detik
Hard limit   : 60 detik
Transport    : HTTP POST raw body audio/wav
```

Batas ukuran awal 3 MB adalah baseline teknis dan boleh disesuaikan setelah tes hardware, selama format dan kontrak utama tidak berubah.

### 5.2 STT Language Handling

- Input dapat menggunakan Bahasa Indonesia.
- Input dapat menggunakan English.
- Input dapat berupa code-switching Indonesia–English.
- faster-whisper menggunakan model `medium` multilingual, CPU INT8, dengan language auto-detection.
- Hotword `BMO` dikirim melalui parameter library-supported `hotwords`; ini konteks decoding, bukan hardcoded transcript replacement.
- Jangan memaksa bahasa ke `id` atau `en`.
- Transcript kosong/noise tidak dikirim ke Hermes.

### 5.3 BMO Output Language

- Jawaban BMO selalu English.
- Jawaban pendek, natural, plain text, umumnya 1–3 kalimat.
- Tidak menggunakan Markdown, bullet, URL, emoji, atau code formatting untuk output suara.

### 5.4 Audio Output

Baseline awal:

```text
Codec       : MP3
Channel     : mono
Sample rate : 24 kHz
Bitrate     : 96 kbps
TTL         : 300 detik
```

Sample rate dan bitrate tetap configurable sampai tes decoder ESP32 dinyatakan stabil.

### 5.5 File Lifecycle

- WAV input dihapus setelah MP3 final berhasil dibuat.
- WAV intermediate Kokoro/RVC dibersihkan setelah request internal selesai.
- MP3 dihapus setelah playback selesai atau gagal.
- Jika tidak ada event playback, MP3 otomatis dihapus ketika TTL 5 menit habis.
- Backend menjalankan cleanup periodik dan startup cleanup.

### 5.6 Retry dan Idempotency

- ESP32 membuat UUID v4 sebelum upload.
- Retry upload rekaman yang sama memakai request ID yang sama.
- Backend tidak boleh membuat pipeline kedua untuk duplicate request yang valid.
- Download MP3 yang gagal diulang satu kali dari awal.
- HTTP Range/resume belum digunakan pada MVP.

### 5.7 Technical Error Behavior

Jika STT mendeteksi tidak ada speech yang berguna atau noise terlalu tinggi, firmware menampilkan ekspresi error dan memainkan audio lokal:

```text
“Sorry, it is too noisy. BMO cannot hear you.”
```

Untuk error recoverable lain, gunakan audio lokal generik:

```text
“Oh no. BMO could not answer. Please try again.”
```

Audio error disimpan di device agar tetap tersedia ketika backend, Hermes, atau TTS gagal.

---

## 6. Spotify Integration — Phase 2

### 6.1 Requirement

- Spotify Premium diperlukan untuk playback control endpoint.
- BMO bertindak sebagai voice remote control.
- Audio Spotify keluar dari perangkat Spotify aktif user, bukan speaker BMO.
- Speaker BMO hanya dipakai untuk suara BMO dan audio error lokal.

### 6.2 OAuth Flow

```text
1. User memilih Connect Spotify di mobile app.
2. App meminta auth URL dari backend.
3. User login dan memberi izin di Spotify.
4. Spotify redirect ke backend callback.
5. Backend menukar authorization code menjadi access/refresh token.
6. Token dienkripsi sebelum disimpan di PostgreSQL.
7. Backend melakukan refresh token ketika diperlukan.
```

### 6.3 Voice Control Flow

```text
User memberi voice command
→ STT
→ Hermes mengidentifikasi intent Spotify
→ backend mengeksekusi Spotify Web API
→ BMO memberi jawaban English melalui TTS
→ mobile/device state diperbarui
```

### 6.4 Supported Commands

| Perintah | Spotify API |
|---|---|
| Play lagu/artist/playlist/album | Search + player play |
| Pause | Player pause |
| Resume | Player play |
| Next/previous | Player next/previous |
| Volume | Player volume |
| Shuffle | Player shuffle |
| Current playback | Get player |
| Add to queue | Player queue |
| Available devices | Player devices |

### 6.5 Known Limitation

Spotify memerlukan active device. Jika tidak ada perangkat Spotify aktif, BMO memberi jawaban English yang meminta user membuka Spotify pada HP atau laptop.

---

## 7. WhatsApp Integration — Phase 2

### 7.1 Stack

Hermes mengelola WhatsApp gateway dan session. Backend bertindak sebagai bridge ke mobile app dan BMO device.

### 7.2 Setup Flow

```text
Mobile app meminta QR
→ backend meminta QR dari Hermes
→ app menampilkan QR
→ user scan melalui Linked Devices
→ Hermes menyimpan session pada persistent volume
→ app memantau status koneksi
```

### 7.3 Notification Behavior

| Behavior | Aksi |
|---|---|
| `tts` | BMO membacakan notifikasi dan menampilkan informasi |
| `display` | Hanya menampilkan informasi |
| `silent` | Mengabaikan notifikasi |

Rules contact/group disimpan pada PostgreSQL. Notifikasi group didukung dan dapat dimatikan melalui toggle user. WhatsApp session tetap disimpan oleh Hermes, bukan database aplikasi. Session harus memakai persistent volume, tetapi re-login QR masih mungkin diperlukan jika session menjadi invalid setelah restart/crash.

---

## 8. Display System

### 8.1 Voice MVP Modes

| Mode | Trigger | Pengendali |
|---|---|---|
| `idle` | Default, wake word, dan rekaman lokal | Firmware |
| `thinking` | Backend telah menerima request dan pipeline berjalan | Backend melalui WebSocket |
| `speaking` | MP3 benar-benar mulai diputar | Firmware |
| `error` | Request atau playback gagal | Firmware |

Tidak ada mode display `listening` terpisah pada voice MVP.

### 8.2 Future Feature Modes

| Mode | Fase | Konten |
|---|---|---|
| `music` | Spotify integration | Judul lagu, artist, status playback |
| `notification` | WhatsApp integration | Pengirim dan cuplikan pesan |

Mode future tidak boleh dianggap sebagai bagian kontrak voice MVP sampai kontraknya didefinisikan pada sprint terkait.

### 8.3 Ownership State

Backend hanya mengirim perintah/state `thinking` untuk voice MVP. Firmware bertanggung jawab terhadap `idle`, `speaking`, `error`, dan transisi kembali ke `idle`.

---

## 9. Ringkasan SW ↔ HW Interface

Kontrak lengkap berada pada `docs/hardware-contract/BMO-MVP-HW-INTERFACE-CONTRACT-v1.0.5.md`.

### 9.1 Protokol

| Kebutuhan | Protokol |
|---|---|
| Koneksi device, auth, state, dan event | WebSocket |
| Upload WAV utuh | HTTP POST |
| Download MP3 | HTTP GET |

### 9.2 Endpoint Voice MVP

```text
WS   /ws
POST /api/v1/voice
GET  /audio/:audioId.mp3
```

### 9.3 Event Utama

ESP32 → Backend:

```text
authenticate
audio_playback_done
audio_playback_failed
```

Backend → ESP32:

```text
authenticated
authentication_failed
connection_replaced
display_status
audio_ready
request_failed
```

### 9.4 Aturan Utama

- ESP32 adalah WebSocket client.
- Backend adalah WebSocket server.
- Device token dikirim dalam message auth, bukan query URL.
- WebSocket harus terautentikasi sebelum upload WAV diterima.
- Satu request aktif per device.
- Request ID dibuat ESP32 dan dipakai sebagai idempotency key.
- Audio tidak dikirim melalui WebSocket.
- Tidak ada event `audio_chunk`, `wake_word_detected`, `ack`, atau `audio_ready_received` pada voice MVP canonical.

---

## 10. Backend ↔ Hermes Communication

### 10.1 Endpoint Aktif

```http
POST http://127.0.0.1:8642/v1/responses
Authorization: Bearer ${HERMES_API_KEY}
Content-Type: application/json
```

### 10.2 Payload Voice MVP

```json
{
  "model": "hermes-agent",
  "instructions": "<BMO_RUNTIME_INSTRUCTIONS>",
  "input": "<hasil STT>",
  "conversation": "bmo-001",
  "store": true,
  "stream": false,
  "truncation": "auto"
}
```

### 10.3 Rules

- `conversation` stabil untuk MVP satu device: `bmo-001`.
- Request pada conversation yang sama diserialisasi.
- `stream:false` karena TTS menunggu jawaban utuh.
- Runtime instructions dikirim pada setiap request.
- Backend mengambil teks assistant dari struktur response yang telah diuji.
- Output provider error tidak boleh dibacakan melalui TTS.
- Backend voice MVP hanya membutuhkan teks jawaban; action Spotify/WhatsApp diterapkan pada fase berikutnya.

### 10.4 Runtime Personality Summary

```text
- Always answer in natural English.
- Understand Indonesian, English, and mixed input.
- Speak as BMO: warm, playful, childlike, friendly, and helpful.
- Keep the answer to one to three short sentences.
- Plain text only.
- Do not expose internal system/provider errors.
```

---

## 11. PostgreSQL Data Model — Prisma ORM

Database aplikasi tetap PostgreSQL dengan Prisma. Voice request state MVP tidak disimpan di database. Schema di bagian ini adalah **baseline aplikasi**, bukan izin untuk P9 membekukan schema lama tanpa audit. Sebelum migration P9 dibuat, Codex wajib mencocokkannya dengan mobile/auth/device-pairing specification terbaru yang sudah disetujui pada saat itu; perubahan data-layer future tidak boleh mengubah public voice HW contract secara diam-diam.

### 11.1 Relasi Utama

```text
users 1 ─── N devices
users 1 ─── 1 spotify_accounts
users 1 ─── 1 user_settings
users 1 ─── 1 notification_settings
notification_settings 1 ─── N notification_rules
```

### 11.2 Prisma Schema Awal — historical baseline

The schema excerpt below is retained as product history. The approved P9.1
schema authority is [`docs/p9/06-preliminary-prisma-schema.md`](../p9/06-preliminary-prisma-schema.md),
which supersedes the old Google-specific identity and UTC-default assumptions.

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum NotificationTargetType {
  CONTACT
  GROUP
}

enum NotificationBehavior {
  TTS
  DISPLAY
  SILENT
}

model User {
  id                   String                @id @default(uuid()) @db.Uuid
  googleId             String                @unique @map("google_id")
  email                String                @unique
  name                 String
  pictureUrl           String?               @map("picture_url")
  createdAt            DateTime              @default(now()) @map("created_at")
  updatedAt            DateTime              @updatedAt @map("updated_at")
  devices              Device[]
  spotifyAccount       SpotifyAccount?
  settings             UserSettings?
  notificationSettings NotificationSettings?

  @@map("users")
}

model Device {
  id              String    @id @default(uuid()) @db.Uuid
  userId          String    @map("user_id") @db.Uuid
  deviceId        String    @unique @map("device_id")
  name            String    @default("BMO")
  isOnline        Boolean   @default(false) @map("is_online")
  lastSeen        DateTime? @map("last_seen")
  firmwareVersion String?   @map("firmware_version")
  createdAt       DateTime  @default(now()) @map("created_at")
  updatedAt       DateTime  @updatedAt @map("updated_at")
  user            User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@map("devices")
}

model SpotifyAccount {
  id                    String   @id @default(uuid()) @db.Uuid
  userId                String   @unique @map("user_id") @db.Uuid
  spotifyUserId         String?  @map("spotify_user_id")
  encryptedAccessToken  String   @map("encrypted_access_token")
  encryptedRefreshToken String   @map("encrypted_refresh_token")
  expiresAt             DateTime @map("expires_at")
  scope                 String
  preferredDeviceId     String?  @map("preferred_device_id")
  createdAt             DateTime @default(now()) @map("created_at")
  updatedAt             DateTime @updatedAt @map("updated_at")
  user                  User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("spotify_accounts")
}

model UserSettings {
  id                     String   @id @default(uuid()) @db.Uuid
  userId                 String   @unique @map("user_id") @db.Uuid
  bmoVolume              Int      @default(80) @map("bmo_volume")
  bmoLanguage            String   @default("en") @map("bmo_language")
  maxRecordingDurationMs Int      @default(60000) @map("max_recording_duration_ms")
  createdAt              DateTime @default(now()) @map("created_at")
  updatedAt              DateTime @updatedAt @map("updated_at")
  user                   User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("user_settings")
}

model NotificationSettings {
  id                        String             @id @default(uuid()) @db.Uuid
  userId                    String             @unique @map("user_id") @db.Uuid
  groupNotificationsEnabled Boolean            @default(false) @map("group_notifications_enabled")
  createdAt                 DateTime           @default(now()) @map("created_at")
  updatedAt                 DateTime           @updatedAt @map("updated_at")
  user                      User               @relation(fields: [userId], references: [id], onDelete: Cascade)
  rules                     NotificationRule[]

  @@map("notification_settings")
}

model NotificationRule {
  id                     String                 @id @default(uuid()) @db.Uuid
  notificationSettingsId String                 @map("notification_settings_id") @db.Uuid
  jid                    String
  displayName            String                 @map("display_name")
  targetType             NotificationTargetType @map("target_type")
  behavior               NotificationBehavior
  createdAt              DateTime               @default(now()) @map("created_at")
  updatedAt              DateTime               @updatedAt @map("updated_at")
  settings               NotificationSettings   @relation(fields: [notificationSettingsId], references: [id], onDelete: Cascade)

  @@unique([notificationSettingsId, jid])
  @@index([jid])
  @@map("notification_rules")
}
```

### 11.3 Database Rules

- Semua ID aplikasi menggunakan UUID.
- Spotify token dienkripsi pada application layer.
- Access token yang expired diperbarui melalui refresh token, bukan menghapus account record.
- `is_online` adalah cache; source of truth real-time tetap koneksi WebSocket aktif.
- `maxRecordingDurationMs=60000` adalah hard limit; rekaman normal berhenti lebih cepat melalui silence detection 2,5 detik.
- Memory Hermes dan WhatsApp session tidak disimpan di PostgreSQL.

---

## 12. React Native Mobile App

### 12.1 Auth dan Session — approved P9.1 boundary

- Registration invite-only; login email/password.
- Password hash Argon2id.
- Access token short-lived, targeted approximately 15 minutes.
- Refresh token opaque, cryptographically random, rotated, with only its hash
  stored in PostgreSQL.
- Per-device session revocation is supported; no social login or external
  identity provider is included in P9.1.

### 12.2 Zustand Stores

```text
authStore
bmoStore
spotifyStore
whatsappStore
settingsStore
```

### 12.3 Screen Structure

```text
App
├── AuthStack
│   └── LoginScreen
│
└── MainStack
    ├── HomeScreen
    │   - BMO online/offline
    │   - Voice state: idle/thinking/speaking/error
    │   - Future state: music/notification
    │   - Spotify status
    │   - WhatsApp status
    │
    ├── ControlScreen — proposed device/integration status and controls
    │
    └── SettingsStack
        ├── SpotifySettingsScreen
        ├── WhatsAppSettingsScreen
        ├── WhatsAppQRScreen
        └── BMOSettingsScreen
```

### 12.4 Planned Mobile API

| Method | Endpoint | Deskripsi |
|---|---|---|
| POST | `/api/v1/auth/register` | Invite + email/password → app session |
| POST | `/api/v1/auth/login` | Email/password → short-lived access + refresh session |
| POST | `/api/v1/auth/refresh` | Rotate refresh token and issue access token |
| POST | `/api/v1/auth/logout` | Revoke current session |
| POST | `/api/v1/auth/sessions/:sessionId/revoke` | Revoke one client/device session |
| GET | `/api/bmo/status` | Status BMO dan current mode |
| GET | `/api/spotify/auth-url` | Spotify authorization URL |
| GET | `/api/spotify/status` | Status koneksi Spotify |
| DELETE | `/api/spotify/disconnect` | Disconnect Spotify |
| GET | `/api/whatsapp/qr` | QR WhatsApp |
| GET | `/api/whatsapp/status` | Status WhatsApp |
| GET | `/api/whatsapp/contacts` | Notification rules |
| PUT | `/api/whatsapp/contacts` | Update notification rules |
| GET | `/api/settings` | Get settings |
| PUT | `/api/settings` | Update settings |

Endpoint mobile berada di luar scope voice MVP pertama.

---

## 13. BMO Personality and Voice

### 13.1 Character

BMO bersifat childlike, enthusiastic, friendly, loyal, caring, sedikit naif, tetapi tetap membantu dan jujur.

### 13.2 Language Rules

```text
Input yang dipahami:
- Bahasa Indonesia
- English
- campuran Indonesia–English

Jawaban suara BMO:
- selalu English
```

### 13.3 Response Rules

- Umumnya 1–3 kalimat pendek.
- Plain text.
- Tidak menggunakan Markdown, heading, bullet, emoji, URL, atau code formatting.
- Tidak membacakan provider error atau detail teknis internal.
- Tetap jujur saat tidak mengetahui jawaban.

### 13.4 Voice Pipeline

```text
Piper Prudence English TTS
→ Kokoro `af_heart` speed `0.80` fallback if Piper fails
→ FFmpeg MP3
```

Production voice is fixed to Piper Prudence, speaker ID `0`. RVC is removed
from production and retained only as archived evidence/history. Kokoro remains
the internal fallback and is not user-selectable.

---

## 14. VPS Infrastructure and Deployment

### 14.1 Current State and Deployment Boundary

Status per 2026-08-04:

- voice backend P1, P2, P4, dan P5 memiliki verification evidence sesuai
  scope; P8 production is verified with Piper Prudence primary and Kokoro
  fallback; RVC runtime artifacts are removed and archived;
- faster-whisper menggunakan `medium` multilingual + hotword `BMO` sebagai current runtime target;
- Kokoro menggunakan `af_heart` dengan speed `0.80` sebagai fallback;
- backend BMO public HTTPS/WSS dan Hermes integration are verified by P7/P8;
- PostgreSQL/Prisma, mobile, memory, scheduler, Spotify, WhatsApp, and
  editable voice settings remain unimplemented P9 scope.

Operational execution authority berada di `docs/NEXT-ACTION.md` dan roadmap P6–P10, bukan di sprint log historis PRD.

### 14.2 Target Production Filesystem

Source code, config/secrets, model, persistent data, temp file, dan backup dipisahkan:

```text
/opt/bmo/
├── app/                     # Git checkout; main = production source
│   ├── backend/
│   ├── audio-service/
│   ├── tests/
│   ├── scripts/
│   └── docker-compose.yml
│
├── config/                  # real runtime config/secrets; outside Git
│   ├── backend.env
│   ├── audio.env
│   ├── postgres.env         # reserved path; real credentials activated with P9
│   └── caddy/
│       └── Caddyfile
│
├── models/
│   ├── hf-cache/
│   ├── torch-cache/
│   ├── piper/
│   ├── kokoro/
│   └── MODEL_MANIFEST.md
│
├── data/
│   ├── postgres/            # P9
│   └── beszel/
│
├── temp/
│   └── audio/
│
├── backups/
│   ├── database/
│   ├── config/
│   └── manifests/
│
└── deploy/
    ├── infra-compose.yml      # P6 infra-only Compose source (Beszel)
    ├── current
    ├── previous
    └── history/
```

`/opt/bmo/app` bersifat replaceable dari Git/build. `config`, `models`, `data`, dan `backups` tidak boleh bergantung pada checkout Git dan tidak boleh hilang saat source di-update. Archived RVC evidence is outside the production model tree.

### 14.3 Target VPS Topology

```text
Internet
   │
   ├── https://api.personalbmo.web.id
   └── https://monitor.personalbmo.web.id
              │
              ▼
          Caddy :80/:443
              │
              ├── BMO Backend origin
              └── Beszel origin

VPS host
├── Hermes Agent (existing host runtime)
│   └── 127.0.0.1:8642
├── Tailscale (admin/private management path)
└── Docker Compose
    ├── bmo-backend
    ├── bmo-audio-service
    ├── beszel
    └── postgres             # added/activated in P9
```

Rules:

- Hermes existing tetap host service dan tidak dimigrasi ke Docker hanya demi kerapihan.
- Codex adalah executor infrastructure/deployment P6+; Hermes adalah runtime dependency BMO.
- Backend/audio source dibangun menjadi immutable Docker image. Source host tidak di-bind-mount live ke production runtime.
- Audio Service memakai pinned Piper assets plus Kokoro fallback; RVC is not a
  production model path. Express backend only calls Audio Service through the
  internal service interface.
- PostgreSQL tidak digunakan untuk voice request state MVP; request aktif tetap in-memory.

### 14.4 Public and Private Networking

Target public surface:

```text
TCP 80  → Caddy HTTP redirect / certificate handling
TCP 443 → Caddy HTTPS + WSS
```

Target non-public service ports:

```text
3000 → BMO backend origin
8001 → Audio Service
8642 → Hermes
5432 → PostgreSQL
Beszel origin port → reverse proxy/internal only
```

SSH admin saat ini berasal dari public IP. P6 harus menyiapkan dan membuktikan Tailscale/admin path terlebih dahulu sebelum public SSH dibatasi. Jangan menutup satu-satunya working SSH path sebelum jalur kedua teruji.

### 14.5 Production Hostnames

```text
BMO API / WSS : api.personalbmo.web.id
Monitoring    : monitor.personalbmo.web.id
```

Target firmware setelah P7 deployment verification:

```text
HTTPS base : https://api.personalbmo.web.id
WSS        : wss://api.personalbmo.web.id/ws
Upload     : https://api.personalbmo.web.id/api/v1/voice
Audio      : https://api.personalbmo.web.id/audio/<audio-uuid>.mp3
```

Hostname di atas adalah target production. Hardware tidak boleh menganggap endpoint live sampai `docs/hardware-handoff/DEPLOYMENT-CONFIG.md` berstatus `VERIFIED` setelah public-domain E2E P7.

### 14.6 Runtime Configuration Ownership

Real secret/config berada di `/opt/bmo/config` dan tidak masuk Git. Repository hanya menyimpan `.env.example` atau schema/template config.

Backend config mencakup antara lain:

```env
NODE_ENV=production
BACKEND_PORT=3000
PUBLIC_BASE_URL=https://api.personalbmo.web.id

DEVICE_ID=bmo-001
DEVICE_TOKEN=<secret-out-of-band>

HERMES_API_URL=http://127.0.0.1:8642
HERMES_API_KEY=<secret>
HERMES_MODEL=hermes-agent
HERMES_CONVERSATION=bmo-001

AUDIO_SERVICE_URL=http://127.0.0.1:8001
INTERNAL_SERVICE_TOKEN=<shared-internal-secret>

TEMP_AUDIO_DIR=/opt/bmo/temp/audio
TEMP_AUDIO_TTL_SECONDS=300
MAX_AUDIO_DURATION_SECONDS=60
MAX_AUDIO_BYTES=3145728
HARDWARE_TEST_MODE=false
```

Audio Service config mencakup:

```env
AUDIO_SERVICE_PORT=8001
INTERNAL_SERVICE_TOKEN=<shared-internal-secret>

HF_HOME=/opt/bmo/models/hf-cache
TORCH_HOME=/opt/bmo/models/torch-cache

WHISPER_MODEL=medium
WHISPER_HOTWORDS=BMO
WHISPER_DEVICE=cpu
WHISPER_COMPUTE_TYPE=int8
WHISPER_CPU_THREADS=4
WHISPER_WORKERS=1
WHISPER_BEAM_SIZE=5
WHISPER_VAD=true

KOKORO_LANG_CODE=a
KOKORO_VOICE=af_heart
KOKORO_SPEED=0.80

TTS_PRIMARY_ENGINE=piper
PIPER_MODEL=en_GB-semaine-medium
PIPER_SPEAKER=prudence
PIPER_SPEAKER_ID=0
RVC_ENABLED=false

OUTPUT_MP3_SAMPLE_RATE=24000
OUTPUT_MP3_BITRATE=96k
```

Piper assets are pinned and mounted read-only outside Git. RVC paths are not
part of the current production configuration; archived RVC evidence must not
be provisioned or enabled by P9.

### 14.7 Monitoring and Alerting

P6 target:

- Beszel melalui `https://monitor.personalbmo.web.id` dengan authentication;
- monitoring CPU, RAM, disk, swap, dan service/container state;
- Telegram sebagai alert destination menggunakan bot token yang diberikan out-of-band;
- token Telegram tidak masuk Git/docs;
- baseline alert: RAM >80% warning, >90% critical, CPU >90% selama 10 menit, free disk <20 GB, critical service/container down, dan sustained high swap.

Portainer tidak digunakan pada fase saat ini.

### 14.8 Backup and Recovery Baseline

Target policy:

```text
Scheduled `pg_dump`         → seven daily encrypted/checksummed backups
Weekly DB/config backup    → four weekly encrypted backups
Off-VPS recovery copy       → required before final production sign-off; destination OPEN
Pre-deploy                 → DB backup (jika DB aktif) + record current commit SHA
Restore test               → wajib dibuktikan; backup tanpa restore test tidak dianggap cukup
```

Model/cache yang dapat direproduksi tidak wajib dibackup bulanan apabila source/revision/hash tercatat. Secret tidak boleh disalin plaintext ke lokasi backup yang tidak aman.

### 14.9 Deployment Model

Production source of truth:

```text
Git branch : main
Checkout   : /opt/bmo/app
Runtime    : Docker image built from selected Git commit
```

Perubahan source host tidak otomatis mengubah production container. Flow deployment:

```text
fetch/checkout target main commit
→ pre-deploy backup + record previous commit
→ build image
→ tests
→ migration bila phase/database memerlukannya
→ docker compose recreate
→ healthcheck
→ public smoke/E2E sesuai phase
→ record deployment evidence
```

Downtime recreate sekitar 10–30 detik acceptable untuk MVP saat ini. Jika verification gagal, rollback ke previous known-good commit/image/config sesuai deployment record.

---

## 15. Current Implementation Roadmap

Roadmap operasional current tidak mengikuti lagi asumsi lama bahwa seluruh deployment selesai dalam satu P6. Detail authority berada di `docs/NEXT-ACTION.md` dan `docs/roadmap/P6-P10-ROADMAP.md`.

Execution order yang dikunci untuk coding agent adalah **P6 → P7 → P8 → P9 → P10**, satu phase per execution turn. Technical dependency yang lebih longgar tidak memberi izin untuk melompati urutan ini.

### 15.1 Completed Local Backend Phases

```text
P1 → VERIFIED — BACKEND
P2 → VERIFIED — LOCAL FUNCTIONAL
P3 → historical implemented boundary; RVC archived and disabled in production
P4 → VERIFIED — LOCAL FUNCTIONAL
P5 → VERIFIED — BACKEND
```

Mencakup backend HTTP/WebSocket contract, Audio Service/STT/TTS/FFmpeg local
integration, Hermes adapter/pipeline, reliability/security/lifecycle, and
current STT/Piper/Kokoro tuning. P8 production is verified; RVC is archived
and disabled. Evidence remains in `docs/backend-mvp/`.

### 15.2 P6 — VPS Foundation and Operations Baseline — READY

Goal: menyiapkan host foundation tanpa mengklaim public BMO voice API sudah live.

Scope inti:

- read-only VPS/Hermes/Codex audit;
- `bmo-admin`/permissions + Codex usable from the admin account;
- Docker + Compose foundation;
- `/opt/bmo` layout;
- Caddy + DNS/TLS foundation;
- Tailscale admin path + safe SSH transition;
- firewall exposure baseline;
- Beszel + Telegram alert;
- logging/resource guardrail;
- backup/recovery framework;
- maintenance/update/recovery runbook dan version-pinning baseline.

P6 selesai → stop; P7 baru dimulai setelah explicit next-phase authorization.

### 15.3 P7 — Backend/Audio VPS Deployment + Public E2E

Dependency: P6 `VERIFIED`.

Goal:

- deploy backend/audio images dari `main`;
- hubungkan backend dengan existing Hermes host runtime;
- expose API via Caddy HTTPS/WSS;
- jalankan health/smoke/fake ESP32 E2E dari luar VPS;
- record deployed commit and benchmark baseline.

`api.personalbmo.web.id` baru boleh disebut live setelah P7 evidence pass. Pada titik itu deployment config boleh berubah menjadi `VERIFIED` dan tim HW dapat mulai live endpoint integration; final physical acceptance tetap P10.

### 15.4 P8 — Piper Production TTS and Resource Closure — VERIFIED

Dependency: P7 `VERIFIED`.

Result:

- Piper `en_GB-semaine-medium`, Prudence, speaker ID `0` is the fixed primary;
- Kokoro `af_heart` at speed `0.80` is the automatic fallback;
- RVC runtime/container artifacts were removed; compact evidence and Git
  history remain archived;
- production canary, fallback/recovery, public regression, resource soak, and
  rollback evidence passed;
- Hardware Contract v1.0.5 and all public voice events remain unchanged.

### 15.5 P9 — PostgreSQL + Prisma Readiness

Technical dependency: P6 `VERIFIED`. **Locked execution order:** P9 is executed after P8 unless the user explicitly changes the roadmap.

Goal:

- PostgreSQL persistent deployment;
- Prisma schema/migration readiness;
- backup + restore verification;
- application data layer ready for device/user/settings/future feature data;
- isolated P9.1–P9.6 execution covering auth/pairing, chat/memory, scheduler,
  proactive speech, Spotify, WhatsApp, security, observability, and acceptance.

Voice request state remains in-memory for the MVP contract.

The detailed P9 product lock, preliminary schema, API mapping, memory policy,
scheduler boundary, additive hardware proposal, and decision register are in
[`../p9/README.md`](../p9/README.md). They are not implementation evidence.

### 15.6 P10 — Hardware Handoff Activation and Physical Verification

Technical dependency: P7 verified public endpoint + P8 status documented. **Locked execution order:** P10 follows P9 unless the user explicitly changes the roadmap.

Goal:

- confirm deployment config yang sudah diverifikasi P7 masih match dengan live deployment, lalu update physical ESP32 status/evidence;
- provide device credential out-of-band;
- execute physical ESP32 acceptance matrix;
- verify WSS auth, WAV upload, thinking, audio download/playback, retry/reconnect/error handling, and playback completion;
- finalize hardware handoff docs against actual deployed behavior.

### 15.7 Future Product Features

Spotify, WhatsApp, full mobile app integration, device provisioning, settings, and other product features continue after the core VPS/voice/hardware path is stable. Their product requirements remain in the relevant PRD sections and must not silently alter the voice MVP hardware contract.

---

## 16. Known Decisions and Limitations

| Item | Status | Keputusan |
|---|---|---|
| Audio input transport | Final voice MVP | Satu raw WAV utuh melalui HTTP POST |
| Audio event transport | Final voice MVP | WebSocket hanya untuk auth dan event kecil |
| Audio output transport | Final voice MVP | URL MP3 melalui WebSocket, file diambil lewat HTTP GET |
| Input format | Final voice MVP | WAV PCM 16-bit LE, 16 kHz, mono |
| Recording stop | Final voice MVP | Silence 2,5 detik atau hard limit 60 detik |
| Request ID | Final voice MVP | UUID v4 dibuat ESP32; retry memakai ID yang sama |
| Request state | Final voice MVP | In-memory, satu request aktif per device |
| Voice display modes | Final voice MVP | `idle`, `thinking`, `speaking`, `error` |
| BMO response language | Final | Selalu English |
| STT language | Final voice MVP | Auto-detect Indonesia, English, dan mixed |
| STT runtime | Final MVP | faster-whisper lokal |
| TTS runtime | Final MVP | Piper Prudence lokal |
| TTS fallback | Final MVP | Kokoro `af_heart`, speed `0.80` |
| Voice conversion | Archived only | RVC disabled; no production runtime |
| MP3 TTL | Final voice MVP | 5 menit |
| Download retry | Final voice MVP | Satu retry dari awal, tanpa HTTP Range |
| Database aplikasi | Final | PostgreSQL + Prisma |
| Voice request database | Final voice MVP | Tidak memakai PostgreSQL |
| Spotify audio output | Final | Perangkat Spotify user, bukan speaker BMO |
| Spotify active device | Accepted limitation | User harus memiliki perangkat Spotify aktif |
| WhatsApp session | Final | Dikelola Hermes pada persistent volume |
| Single user per BMO | Current decision | Satu BMO terhubung ke satu user/account utama pada fase awal |
| Single VPS | Current decision | Cost-efficient untuk MVP; dapat dipisah saat load meningkat |
| React Native | Final | Mobile app iOS/Android |
| Zustand | Final | State management mobile |

### 16.1 Baseline yang Masih Harus Dibuktikan

- Batas upload 3 MB.
- MP3 mono 24 kHz/96 kbps.
- faster-whisper `medium` multilingual, CPU INT8, 4 threads, beam size 5, VAD aktif, dan hotword `BMO`; konfigurasi ini sudah dipilih dari investigasi akurasi lokal tetapi latency/resource tetap wajib dibenchmark di VPS.
- Kokoro voice `af_heart` dengan speed `0.80` is the verified fallback value;
  decoder compatibility remains a P10 hardware gate.
- Timeout per tahap; total pipeline baseline maksimal 300 detik.
- RVC quality/model assumptions are archived and do not gate current
  production; no RVC runtime is part of P9.
- Latency end-to-end pada VPS uji.

Baseline boleh berubah berdasarkan hasil benchmark tanpa mengubah kontrak produk yang sudah dikunci.

---

## 17. Open Items

| Item | Priority | Owner | Status |
|---|---|---|---|
| P6 VPS foundation / Caddy / Tailscale / Beszel / firewall / backup baseline | High | SW / Codex | READY |
| P7 deploy backend + Audio Service + Hermes host integration + public HTTPS/WSS E2E | High | SW / Codex | Depends on P6 |
| P8 Piper production closure + fallback regression + VPS resource benchmark | High | SW / Codex | VERIFIED |
| P9.1 PostgreSQL + Prisma/auth/pairing/settings + migration + backup/restore | High | SW / Codex | Architecture locked; implementation requires explicit P9.1 authorization |
| P10 physical ESP32 integration + final hardware handoff activation | High | SW + HW | Technical dep P7+P8 status; execute after P9 |
| Uji MP3 24 kHz/96 kbps pada decoder ESP32 | High | SW + HW | P10 |
| Provisioning device token yang lebih aman / multi-device readiness | Medium | SW + HW | Future |
| Spotify no-active-device UX | Medium | SW | Future |
| WhatsApp persistent session reliability | Medium | SW | Future |
| P9 mobile screen/API traceability and ControlScreen scope | High | SW/mobile | Proposed in `docs/p9/` |
| Push notification mobile saat BMO offline/error | Low | SW | Future |
| OTA firmware update | Low | HW + SW | Future |

### 17.1 Closed / Locked Items

| Item | Keputusan |
|---|---|
| Database utama | PostgreSQL + Prisma; activation/readiness P9 |
| Voice request state | In-memory untuk voice MVP |
| Audio input transport | Raw WAV melalui HTTP POST |
| Audio output | MP3 URL + HTTP GET |
| Max recording | 60 detik, dengan silence stop 2,5 detik |
| Hermes endpoint | `127.0.0.1:8642/v1/responses` |
| Hermes deployment | Existing host runtime; bukan container migration target |
| Deployment executor P6+ | Codex/operator |
| Production Git source | `main` |
| Production root | `/opt/bmo` |
| Public API target | `api.personalbmo.web.id` setelah P7 verification |
| Monitoring target | Beszel at `monitor.personalbmo.web.id` |
| Reverse proxy | Caddy |
| Admin private network | Tailscale |
| Portainer | Tidak digunakan saat ini |
| Input language | Auto-detect Indonesia/English/mixed |
| STT current target | faster-whisper `medium`, CPU INT8, hotword `BMO` |
| Output language | English |
| Kokoro current target | `af_heart`, speed `0.80` |
| Voice display modes | `idle`, `thinking`, `speaking`, `error` |
| Temp MP3 TTL | 300 detik |
| RVC production status | Disabled and removed; archived evidence only |

| P9.1 timezone | `Asia/Jakarta`, server-enforced and not user-editable |
| P9.1 pairing | Six-digit numeric code, ten-minute TTL, single-use, rate-limited, audited |

---

## 18. Document Hierarchy

Urutan authority current:

1. `docs/hardware-contract/BMO-MVP-HW-INTERFACE-CONTRACT-v1.0.5.md` — public firmware/backend protocol.
2. `docs/backend-mvp/CURRENT-RUNTIME-CONFIG.md` — active STT/TTS runtime values.
3. `docs/backend-mvp/IMPLEMENTATION-STATUS.md` + latest evidence — what is actually implemented/verified.
4. Active `docs/backend-mvp/` references — backend/audio implementation details.
5. `docs/hardware-handoff/DEPLOYMENT-CONFIG.md` — deployment-specific public values after marked `VERIFIED`.
6. `docs/NEXT-ACTION.md` + `docs/roadmap/` — operational next phase/execution boundary.
7. `docs/p9/` — proposed final application-platform architecture; implementation status remains in the active status/evidence files.
8. PRD ini — product context, architecture, decisions, and roadmap summary.
9. `docs/archive/` — historical reference only.

Jika dokumen bertentangan, jangan mengubah firmware/backend contract secara diam-diam. Gunakan hierarchy di atas, catat konflik, dan update dokumen current yang stale.

---

## Changelog

| Tanggal | Versi | Perubahan |
|---|---|---|
| 2026-08-04 | 1.3.1 | P9.1 architecture approval: invite-only email/password + Argon2id, rotating hashed refresh tokens, server-enforced `Asia/Jakarta`, six-digit pairing, private PostgreSQL targets, persisted user/device settings, controlled Prisma migration, backup/restore baseline, audit/redaction controls; P9.2–P9.6 remain unimplemented and Hardware Contract v1.0.5 unchanged. |
| 2026-08-04 | 1.3.0 | P9 final architecture/product lock: current Piper Prudence production, removed/archived RVC boundary, Backend-owned PostgreSQL application source of truth, chat/history versus curated memory, scheduler/proactive speech proposal, additive future hardware events, auth/pairing, mobile API mapping, Spotify/WhatsApp boundaries, voice settings, security/recovery/resource/acceptance plan; Hardware Contract v1.0.5 unchanged. |
| 2026-07-26 | 1.2.4 | Authority/operations hardening: memperbaiki canonical document references, mengunci execution order P6→P10, menambah maintenance/update/recovery policy, source-audit gate sebelum P7 public verification, Beszel Hub+Agent/private-origin guidance, Caddy config permission model, dan coverage HW acceptance; public HW protocol tetap v1.0.5. |
| 2026-07-26 | 1.2.3 | Final execution-readiness sync: memperjelas Caddy host service, infra Compose Beszel, secret deploy permissions, P9-only database activation, deterministic image tagging/rollback, dan TLS prerequisite firmware; public HW protocol tidak berubah. |
| 2026-07-26 | 1.2.2 | Menyelaraskan product context dengan operational docs current: `/opt/bmo`, `main` production source, Caddy, `api.personalbmo.web.id`, Beszel/Telegram, Tailscale, backup/rollback, Codex executor, dan dependency-based P6–P10; public HW contract tidak berubah. |
| 2026-07-26 | 1.2.1 | Menyelaraskan current voice runtime setelah P5 (`medium` + hotword `BMO`, Kokoro `af_heart` speed `0.80`) serta memperjelas Codex sebagai executor P6+ dan Hermes sebagai runtime host service; public HW contract tidak berubah. |
| 2026-07-18 | 1.2.0 | Menyelaraskan voice MVP dengan kontrak HW/backend v1.0.5: raw WAV melalui HTTP, WebSocket untuk auth/event, request ID dan idempotency, silence 2,5 detik, hard limit 60 detik, empat mode display voice MVP, Hermes `/v1/responses` pada port 8642, input multilingual auto-detect, jawaban English, Kokoro + RVC dengan fallback, TTL MP3 5 menit, state request in-memory, deployment host/containers, serta hierarchy source of truth. |
| 2026-07-18 | 1.1.0 | Database dipindahkan ke PostgreSQL + Prisma; STT/TTS dibuat lokal menggunakan faster-whisper, Kokoro, dan RVC. |
| 2026-06 | 1.0.1 | Format audio output dikunci menjadi MP3. |
| 2026-06 | 1.0.0 | Initial PRD. |

---

*Dokumen ini di-maintain oleh SW Team — B-Labs.*  
*Update PRD pada awal atau akhir sprint dan update dokumen kontrak ketika perubahan teknis telah disepakati.*
