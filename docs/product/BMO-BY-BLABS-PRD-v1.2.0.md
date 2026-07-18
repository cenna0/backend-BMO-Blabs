# BMO BY B-LABS — Product Requirements Document (PRD)

**Versi:** 1.2.0  
**Tanggal:** 2026-07-18  
**Status:** Active Development — sprint 2 minggu, tanpa hard deadline

> Dokumen ini menjadi konteks produk utama BMO by B-Labs. Isinya menjelaskan visi, arsitektur, tech stack, scope, keputusan desain, roadmap, dan status project.
>
> Untuk detail implementasi voice MVP, gunakan dua dokumen canonical berikut:
>
> - `BMO-MVP-HW-INTERFACE-CONTRACT.md` — kontrak hardware/firmware ↔ backend.
> - `BMO-MVP-BACKEND-IMPLEMENTATION-FOR-HERMES.md` — instruksi implementasi backend dan audio service.
>
> Jika terdapat perbedaan pada detail endpoint, event, timeout, retry, atau lifecycle file, dokumen canonical dengan versi terbaru menjadi source of truth untuk voice MVP.

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
→ Kokoro menghasilkan suara dasar
→ RVC mengubah karakter suara jika tersedia
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

- Kontrak teknis voice MVP berada di `BMO-MVP-HW-INTERFACE-CONTRACT.md`.
- Tim hardware dan software harus memakai versi kontrak yang sama.
- Perubahan pada endpoint, event, format audio, atau ownership state wajib disepakati bersama.
- Bab 9 PRD hanya memberikan ringkasan. Bab tersebut tidak menggantikan kontrak teknis canonical.

---

## 3. Tech Stack

### 3.1 Software

| Layer | Teknologi | Keterangan |
|---|---|---|
| AI Agent | Hermes Agent | Berjalan langsung di host VPS; menangani personality, context, memory, dan kemampuan agent |
| LLM | Diatur melalui konfigurasi Hermes | DeepSeek/MiMo menjadi kandidat cost-efficient untuk production; model dapat berubah tanpa mengubah kontrak backend |
| Backend | Express.js + TypeScript | REST API, WebSocket server, voice pipeline orchestration, Spotify, auth, dan integrasi aplikasi |
| Local Audio Service | Python + FastAPI | STT, TTS, RVC, FFmpeg, audio validation, dan audio processing |
| Database aplikasi | PostgreSQL | User, device, Spotify account, settings, dan notification rules |
| ORM | Prisma ORM | Schema, migration, relational query, dan type-safe client |
| Voice request state MVP | In-memory | Request aktif dan tombstone idempotency; tidak menggunakan PostgreSQL pada voice MVP |
| Mobile App | React Native | Satu codebase untuk iOS dan Android |
| State Management | Zustand | State aplikasi mobile yang ringan dan modular |
| Mobile Auth | Google SSO | Backend memvalidasi Google ID token dan menerbitkan session aplikasi |
| STT | faster-whisper lokal | Model awal `small` multilingual, CPU INT8, auto-detect Indonesia/English/mixed |
| TTS | Kokoro lokal | Menghasilkan suara dasar English |
| Voice Conversion | RVC lokal | Mengubah karakter suara agar mendekati BMO; fallback Kokoro-only wajib tersedia |
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
              │ - Google SSO                 │
              │ - Spotify OAuth              │
              │ - WhatsApp setup             │
              │ - settings & status          │
              └──────────────┬───────────────┘
                             │ REST API
                             ▼
                     Express.js Backend
```

### 4.2 Tanggung Jawab Komponen

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
- Mengorkestrasi STT → Hermes → TTS/RVC → MP3.
- Menyimpan MP3 sementara dengan URL acak dan TTL.
- Mengirim event real-time ke ESP32 melalui WebSocket.
- Menghapus file sementara berdasarkan playback result dan TTL.
- Pada fase berikutnya: menangani Google auth, Spotify, mobile API, dan bridge WhatsApp.

#### Hermes Agent

- Berjalan pada `127.0.0.1:8642` dan tidak diekspos ke internet.
- **Development role:** bertindak sebagai orkestrator/VPS manager untuk membangun, men-deploy, menguji, dan mendokumentasikan backend BMO tanpa merusak service existing.
- **Runtime role:** bertindak sebagai personal assistant BMO yang menerima transcript melalui endpoint `/v1/responses`.
- Memahami input Indonesia, English, dan campuran.
- Selalu menghasilkan jawaban suara dalam English.
- Menjaga personality BMO, context, memory, skills, dan kemampuan agent.
- Mengembalikan teks jawaban yang akan diproses TTS.
- Mengelola WhatsApp gateway pada fase integrasi.
- Pada fase berikutnya, membantu intent/action seperti Spotify dan WhatsApp.

#### Local Audio Service

- Berjalan hanya pada localhost.
- Menjalankan faster-whisper multilingual dengan auto-detect.
- Menjalankan Kokoro untuk English TTS.
- Menjalankan RVC bila model tersedia dan stabil.
- Menggunakan Kokoro-only sebagai fallback jika RVC gagal.
- Menggabungkan waveform TTS menjadi satu audio utuh.
- Menghasilkan MP3 melalui FFmpeg.
- Memuat model saat startup dan menggunakan cache model persisten.

#### PostgreSQL + Prisma

- Menjadi database utama aplikasi BMO pada fase integrasi fitur.
- Menyimpan user, device, Spotify account, notification settings, dan konfigurasi aplikasi.
- Tidak menyimpan state request aktif voice MVP.
- Tidak menyimpan memory internal Hermes.
- Tidak menyimpan WhatsApp session Hermes.

#### React Native Mobile App

- Menjadi entry point setup dan konfigurasi user.
- Menangani Google SSO.
- Menangani Spotify OAuth.
- Menampilkan WhatsApp QR setup.
- Menampilkan status device dan integrasi.
- Menyediakan settings BMO.
- Fitur manual control masih TBD.

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
Step 17  Kokoro menghasilkan WAV dasar.
Step 18  RVC diterapkan jika tersedia; jika gagal, pipeline memakai Kokoro-only.
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
- faster-whisper menggunakan language auto-detection.
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

Kontrak lengkap berada pada `BMO-MVP-HW-INTERFACE-CONTRACT.md`.

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

Database aplikasi tetap PostgreSQL dengan Prisma. Voice request state MVP tidak disimpan di database.

### 11.1 Relasi Utama

```text
users 1 ─── N devices
users 1 ─── 1 spotify_accounts
users 1 ─── 1 user_settings
users 1 ─── 1 notification_settings
notification_settings 1 ─── N notification_rules
```

### 11.2 Prisma Schema Awal

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

### 12.1 Auth dan Session

- Google SSO sebagai metode login.
- Backend memvalidasi Google ID token.
- Backend menerbitkan JWT aplikasi.
- JWT disimpan melalui secure storage.

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
    ├── ControlScreen — TBD
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
| POST | `/api/auth/google` | Google ID token → app session |
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
Kokoro English TTS
→ RVC BMO jika tersedia
→ FFmpeg MP3
```

Jika RVC gagal, BMO tetap berbicara memakai Kokoro-only. RVC adalah enhancement, bukan single point of failure.

---

## 14. VPS Infrastructure and Deployment

### 14.1 Current Voice MVP Layout

```text
/opt/bmo-mvp/
├── backend/
├── audio-service/
├── tests/
├── scripts/
├── models/
├── temp-audio/
├── docker-compose.yml
├── .env.backend
└── .env.audio
```

```text
VPS host
├── Hermes Agent
│   └── 127.0.0.1:8642
│
└── Docker Compose
    ├── bmo-backend
    │   ├── network_mode: host
    │   └── 0.0.0.0:3000 untuk staging
    │
    └── bmo-audio-service
        └── 127.0.0.1:8001 → container:8001
```

PostgreSQL ditambahkan pada fase aplikasi/database. Hermes, Audio Service, dan PostgreSQL tidak boleh diekspos langsung ke internet.

### 14.2 Environment Variables — Voice MVP Backend

```env
NODE_ENV=production
BACKEND_HOST=0.0.0.0
BACKEND_PORT=3000
PUBLIC_BASE_URL=http://<IP_VPS>:3000

DEVICE_ID=bmo-001
DEVICE_TOKEN=<temporary-staging-secret>

HERMES_API_URL=http://127.0.0.1:8642
HERMES_API_KEY=<secret>
HERMES_MODEL=hermes-agent
HERMES_CONVERSATION=bmo-001

AUDIO_SERVICE_URL=http://127.0.0.1:8001
INTERNAL_SERVICE_TOKEN=<shared-internal-secret>

TEMP_AUDIO_DIR=/opt/bmo-mvp/temp-audio
TEMP_AUDIO_TTL_SECONDS=300
MAX_AUDIO_DURATION_SECONDS=60
MAX_AUDIO_BYTES=3145728
HARDWARE_TEST_MODE=false
```

### 14.3 Environment Variables — Audio Service

```env
AUDIO_SERVICE_HOST=0.0.0.0
AUDIO_SERVICE_PORT=8001
INTERNAL_SERVICE_TOKEN=<shared-internal-secret>

WHISPER_MODEL=small
WHISPER_DEVICE=cpu
WHISPER_COMPUTE_TYPE=int8
WHISPER_CPU_THREADS=4
WHISPER_WORKERS=1
WHISPER_BEAM_SIZE=5
WHISPER_VAD=true

KOKORO_LANG_CODE=a
KOKORO_VOICE=af_heart

RVC_ENABLED=true
RVC_MODEL_PATH=/opt/bmo-mvp/models/rvc-bmo/<actual-model-file>.pth
RVC_INDEX_PATH=

OUTPUT_MP3_SAMPLE_RATE=24000
OUTPUT_MP3_BITRATE=96k
```

Nama file RVC harus mengikuti hasil inspeksi archive sebenarnya, bukan ditebak.

### 14.4 Deployment Stages

#### Stage 1 — Local VPS Test

- Hermes localhost.
- Backend dan Audio Service diuji melalui curl/fake ESP32.
- Port public belum dibuka.

#### Stage 2 — Staging IP

```text
HTTP upload : http://<IP_VPS>:3000/api/v1/voice
WebSocket   : ws://<IP_VPS>:3000/ws
Audio       : http://<IP_VPS>:3000/audio/<uuid>.mp3
```

Gunakan temporary staging token karena HTTP belum terenkripsi. Terapkan firewall ketat dan hanya buka port yang benar-benar diperlukan untuk pengujian tim hardware.

#### Stage 3 — Domain + TLS

```text
HTTPS : https://api.<domain>/api/v1/voice
WSS   : wss://api.<domain>/ws
Audio : https://api.<domain>/audio/<uuid>.mp3
```

Hanya port 80/443 yang diekspos melalui reverse proxy. Token staging harus dirotasi setelah TLS aktif.

---

## 15. Development Phases and Sprint Log

### 15.1 Milestone Overview

**Phase 1 — Infrastructure and Core Voice Pipeline**  
Goal: BMO dapat mendengar, berpikir, dan berbicara.

**Phase 2 — Spotify and WhatsApp Integration**  
Goal: BMO mengontrol Spotify dan menerima notifikasi WhatsApp.

**Phase 3 — Mobile App, Polish, and Stability**  
Goal: setup user lengkap, monitoring, ekspresi matang, dan stabil untuk daily use.

### 15.2 Sprint 1 — Protocol Definition ✅

**SW:**

- Penetapan arsitektur awal.
- Pemilihan WebSocket untuk event real-time.
- Penetapan Express.js, Hermes, Local Audio Service, PostgreSQL, Prisma, dan React Native.

### 15.3 Sprint 2 — Voice MVP and Hardware Integration 🔄

**HW:**

- [ ] Menyiapkan hardware environment.
- [ ] Menstabilkan wake word.
- [ ] Implementasi rekaman WAV 16 kHz/16-bit/mono.
- [ ] Implementasi silence detection 2,5 detik dan hard limit 60 detik.
- [ ] Implementasi WebSocket auth/reconnect.
- [ ] Implementasi HTTP upload WAV.
- [ ] Implementasi download dan decoder MP3.
- [ ] Implementasi mode `idle`, `thinking`, `speaking`, dan `error`.
- [ ] Uji komunikasi device ↔ backend.

**SW:**

- [ ] Audit VPS dan Hermes existing.
- [ ] Bangun Express.js backend + TypeScript.
- [ ] Bangun hardware test mode dengan dummy MP3.
- [ ] Berikan endpoint staging awal ke tim HW.
- [ ] Bangun Local Audio Service.
- [ ] Integrasikan faster-whisper.
- [ ] Integrasikan Kokoro.
- [ ] Integrasikan RVC dengan fallback Kokoro-only.
- [ ] Integrasikan FFmpeg dan temp audio lifecycle.
- [ ] Integrasikan Hermes `/v1/responses`.
- [ ] Buat fake ESP32, unit test, integration test, dan benchmark.

### 15.4 Sprint 3 — Spotify Integration 🔜

- Spotify OAuth.
- Encrypted token storage.
- Active device detection.
- Voice control playback.
- Future display mode `music`.

### 15.5 Sprint 4 — WhatsApp and Mobile Setup 🔜

- WhatsApp QR flow.
- Notification rules.
- Future display mode `notification`.
- React Native settings and status screens.

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
| TTS runtime | Final MVP | Kokoro lokal |
| Voice conversion | Final MVP | RVC lokal dengan fallback Kokoro-only |
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
- faster-whisper `small` CPU INT8 dan 4 threads.
- Kokoro voice `af_heart`.
- Parameter pitch/index RVC.
- Timeout per tahap; total pipeline baseline maksimal 300 detik.
- Kualitas community model RVC BMO.
- Latency end-to-end pada VPS uji.

Baseline boleh berubah berdasarkan hasil benchmark tanpa mengubah kontrak produk yang sudah dikunci.

---

## 17. Open Items

| Item | Priority | Owner | Status |
|---|---|---|---|
| Backend hardware test mode dan endpoint staging | High | SW | Open |
| Benchmark faster-whisper pada VPS uji | High | SW | Open |
| Benchmark Kokoro + RVC latency dan kualitas | High | SW | Open |
| Uji MP3 24 kHz/96 kbps pada decoder ESP32 | High | SW + HW | Open |
| Tentukan parameter RVC final | High | SW | Open |
| Domain, HTTPS, dan WSS | Medium | SW | Open |
| Provisioning device token yang lebih aman | Medium | SW + HW | Future |
| PostgreSQL + Prisma implementation | Medium | SW | Future phase |
| Spotify no-active-device UX | Medium | SW | Future phase |
| WhatsApp persistent session reliability | Medium | SW | Future phase |
| Mobile ControlScreen feature list | Medium | SW | TBD |
| Push notification mobile saat BMO offline/error | Low | SW | Future |
| OTA firmware update | Low | HW + SW | Future |

### 17.1 Closed Items

| Item | Keputusan |
|---|---|
| Database utama | PostgreSQL + Prisma |
| Audio input transport | Raw WAV melalui HTTP POST |
| Audio output | MP3 URL + HTTP GET |
| Max recording | 60 detik, dengan silence stop 2,5 detik |
| Hermes endpoint | `127.0.0.1:8642/v1/responses` |
| Input language | Auto-detect Indonesia/English/mixed |
| Output language | English |
| Voice display modes | `idle`, `thinking`, `speaking`, `error` |
| Temp MP3 TTL | 300 detik |
| RVC failure handling | Fallback Kokoro-only |

---

## 18. Document Hierarchy

Urutan authority untuk voice MVP:

1. `BMO-MVP-HW-INTERFACE-CONTRACT.md` versi terbaru — kontrak firmware/backend.
2. `BMO-MVP-BACKEND-IMPLEMENTATION-FOR-HERMES.md` versi terbaru — implementasi backend/audio service.
3. PRD ini — konteks produk, arsitektur, scope, roadmap, dan ringkasan kontrak.

PRD tidak boleh kembali menduplikasi detail teknis yang berpotensi membuat dua source of truth berbeda.

---

## Changelog

| Tanggal | Versi | Perubahan |
|---|---|---|
| 2026-07-18 | 1.2.0 | Menyelaraskan voice MVP dengan kontrak HW/backend v1.0.5: raw WAV melalui HTTP, WebSocket untuk auth/event, request ID dan idempotency, silence 2,5 detik, hard limit 60 detik, empat mode display voice MVP, Hermes `/v1/responses` pada port 8642, input multilingual auto-detect, jawaban English, Kokoro + RVC dengan fallback, TTL MP3 5 menit, state request in-memory, deployment host/containers, serta hierarchy source of truth. |
| 2026-07-18 | 1.1.0 | Database dipindahkan ke PostgreSQL + Prisma; STT/TTS dibuat lokal menggunakan faster-whisper, Kokoro, dan RVC. |
| 2026-06 | 1.0.1 | Format audio output dikunci menjadi MP3. |
| 2026-06 | 1.0.0 | Initial PRD. |

---

*Dokumen ini di-maintain oleh SW Team — B-Labs.*  
*Update PRD pada awal atau akhir sprint dan update dokumen kontrak ketika perubahan teknis telah disepakati.*
