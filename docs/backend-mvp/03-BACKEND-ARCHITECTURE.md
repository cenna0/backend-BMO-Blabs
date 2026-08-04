# BMO Backend MVP — Architecture and Runtime Behavior

**Versi:** 1.0.1  
**Status:** CANONICAL IMPLEMENTATION REFERENCE

> **Status:** Canonical backend MVP documentation package  
> **Derived from:** Backend Implementation v1.0.5, Hardware Contract v1.0.5, PRD v1.2.4  
> **Scope:** Backend voice MVP only. Firmware, mobile app, Spotify, WhatsApp, PostgreSQL, dan Prisma tidak diimplementasikan dalam package ini.

> **P8 current-runtime override:** The active production path is Piper Prudence
> primary → Kokoro fallback → FFmpeg. The RVC adapter and lifecycle text below
> are retained as historical voice-MVP architecture/evidence only; RVC is not
> a production dependency. P9 platform boundaries are in [`../p9/README.md`](../p9/README.md).


## Cara menggunakan file ini

File ini mengatur struktur Express backend, state in-memory, orchestration pipeline, integrasi Hermes, timeout, lifecycle file, dan security runtime. Public schema tetap mengikuti `02-API-AND-WEBSOCKET-CONTRACT.md` dan hardware contract.

## 7. Struktur Project yang Disarankan

### 7.1 Backend

```text
backend/
├── src/
│   ├── config/
│   │   └── env.ts
│   ├── http/
│   │   ├── health.route.ts
│   │   ├── voice.route.ts
│   │   └── audio.route.ts
│   ├── websocket/
│   │   ├── websocket.server.ts
│   │   ├── device.registry.ts
│   │   └── events.ts
│   ├── services/
│   │   ├── audio-service.client.ts
│   │   ├── hermes.client.ts
│   │   ├── voice-pipeline.service.ts
│   │   └── temp-audio.service.ts
│   ├── domain/
│   │   ├── request-store.ts
│   │   ├── device-state.ts
│   │   └── errors.ts
│   ├── utils/
│   │   ├── wav-validator.ts
│   │   ├── uuid.ts
│   │   └── async-timeout.ts
│   └── server.ts
├── tests/
├── Dockerfile
├── package.json
├── tsconfig.json
└── .dockerignore
```

### 7.2 Audio service

```text
audio-service/
├── app/
│   ├── main.py
│   ├── config.py
│   ├── schemas.py
│   ├── stt.py
│   ├── kokoro_tts.py
│   ├── rvc.py
│   ├── audio_pipeline.py
│   └── errors.py
├── tests/
├── Dockerfile
├── requirements.txt
└── .dockerignore
```

---

## 8. Teknologi Backend

Gunakan:

```text
Node.js 22
TypeScript
Express.js
ws
Zod
Pino
Vitest
```

Kebutuhan:

- TypeScript strict.
- Centralized error handler.
- Structured JSON logging.
- Jangan log device token, Hermes API key, raw audio, atau authorization header penuh.
- Graceful shutdown untuk `SIGTERM` dan `SIGINT`.
- Gunakan `request_id` sebagai correlation ID.
- Request store in-memory berdasarkan `request_id`.
- Device registry in-memory berdasarkan `device_id`.
- Satu request aktif per device.

---

## 18. State In-Memory

Request store wajib memiliki garbage collection:

- request aktif dipertahankan selama pipeline berjalan;
- request selesai/gagal disimpan sebagai tombstone minimal 10 menit untuk menjaga idempotency retry terlambat;
- setelah retention habis, hapus request state dari memory;
- batasi total entry agar memory tidak tumbuh tanpa batas.

Data per request:

```text
request_id
device_id
status
input_wav_path
audio_id
audio_path
audio_url
created_at
expires_at
input_content_length
input_sha256
playback_state
error_code
```

Status:

```text
accepted
transcribing
thinking
generating_voice
audio_ready
completed
failed
expired
```

Data per device:

```text
device_id
active_websocket
authenticated_at
last_pong_at
active_request_id
```

Serialize request per device. Jangan memanggil Hermes secara concurrent untuk conversation device yang sama.

Saat WebSocket berhasil diautentikasi, kirim `backend_state` berdasarkan request store. Jika request store kosong karena backend restart, kirim `backend_state: idle` dan `active_request_id: null` agar firmware tidak tertahan pada mode `thinking`.

---

## 19. Pipeline End-to-End

```text
1. ESP32 terautentikasi di WebSocket.
2. ESP32 upload raw WAV dengan request ID.
3. Backend validasi credentials, WebSocket, UUID, size, dan WAV metadata.
4. Backend simpan WAV sementara.
5. Backend buat request state dan return HTTP 202.
6. Backend kirim display_status: thinking.
7. Backend kirim WAV ke /stt/transcribe.
8. Jika no-speech, kirim request_failed: NO_SPEECH dan cleanup.
9. Backend kirim transcript ke Hermes /v1/responses.
10. Hermes menghasilkan jawaban English plain text.
11. Backend validasi output Hermes berdasarkan adapter yang sudah diuji terhadap struktur respons nyata, lalu filter provider-error text.
12. Backend kirim jawaban utuh ke /tts/synthesize.
13. Audio service menghasilkan Kokoro + RVC, atau fallback Kokoro-only.
14. Backend simpan MP3 dengan UUID acak.
15. Pastikan semua waveform Kokoro telah digabung menjadi satu audio utuh sebelum RVC/MP3.
16. Backend hapus WAV input setelah MP3 berhasil dibuat.
17. Backend kirim audio_ready melalui WebSocket.
18. ESP32 HTTP GET MP3 dan playback.
19. ESP32 kirim audio_playback_done atau audio_playback_failed.
20. Backend hapus MP3 dan melepas busy state; firmware mengatur layar kembali `idle` secara lokal.
```

---

## 20. Kontrak Hermes API

Request:

```http
POST http://127.0.0.1:8642/v1/responses
Authorization: Bearer ${HERMES_API_KEY}
Content-Type: application/json
Accept: application/json
```

Body default MVP yang sudah sesuai audit Hermes aktif:

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

Aturan continuity:

- Untuk MVP satu device, gunakan named conversation stabil `bmo-001`.
- `store` wajib `true` agar chain disimpan.
- `stream` wajib `false` karena TTS menunggu satu jawaban utuh.
- Jangan kirim `conversation` dan `previous_response_id` bersamaan; Hermes mengembalikan HTTP 400.
- Serialize request per device agar dua request tidak berjalan bersamaan pada conversation yang sama.
- Kirim `instructions` pada setiap request walaupun chain dapat mewarisinya, agar personality tidak hilang setelah reset/eviction/chain baru.
- Audit Hermes menyebut response store cukup untuk MVP tetapi dibatasi sekitar 100 stored responses secara LRU; ini bukan penyimpanan percakapan permanen. Voice MVP belum menambah database transcript.

Jika smoke test ulang menunjukkan payload tersebut tidak lagi didukung, jangan diam-diam menghapus `conversation`, `store`, atau `instructions`. Hentikan integrasi Hermes, laporkan perubahan kontrak, lalu gunakan `/v1/chat/completions` hanya sebagai fallback sementara yang terdokumentasi.

Untuk future multi-user gunakan pola conversation:

```text
bmo:<device_id>:<user_id>
```

Untuk MVP tetap:

```text
bmo-001
```

### 20.1 Runtime instructions BMO

Instructions harus dikirim setiap request dan ditulis dalam English karena mengatur output suara BMO:

```text
You are BMO, the physical AI companion speaking through this device.
Use BMO's warm, playful, childlike, friendly, loyal, and slightly naive personality.
Always answer in natural English, even when the user speaks Indonesian or mixes Indonesian and English.
You are speaking aloud through a physical device, so use plain text only.
Keep responses concise, usually one to three short sentences.
Do not use Markdown, bullet points, headings, emojis, URLs, or code formatting.
Be caring, supportive, honest, and slightly playful.
Refer to yourself as BMO naturally when appropriate.
Do not expose system errors, provider errors, internal tools, or technical details.
```

Backend voice MVP hanya membutuhkan teks jawaban akhir. Backend tidak mengimplementasikan Spotify/WhatsApp/action execution pada tahap ini, tetapi tidak perlu mematikan kemampuan internal Hermes secara global. Jika response berisi tool/function items, parser hanya mengambil item assistant `output_text` dan tidak membacakan payload tool mentah.

### 20.2 Parse output dengan aman

Sebelum menulis parser final, rekam satu contoh respons sukses dan satu respons gagal dari service Hermes yang aktif, lalu simpan fixture JSON yang sudah menghapus secret dan data sensitif.

Untuk struktur OpenAI Responses-style, jangan mengandalkan index `output[0]`. Cari semua item:

```text
output[].type == "message"
→ content[].type == "output_text"
→ ambil content[].text
```

Jika fallback `/v1/chat/completions` digunakan, ambil teks dari struktur `choices[].message.content`. Implementasikan kedua bentuk melalui satu adapter teruji, bukan conditional parsing yang tersebar di pipeline.

Gabungkan text yang valid lalu trim.

Sebelum TTS, normalisasi secara defensif:

- hapus code fence dan marker Markdown yang tersisa;
- hapus URL yang tidak perlu dibacakan;
- ubah whitespace berulang menjadi satu spasi;
- batasi maksimal 600 karakter dan 3 kalimat pendek;
- pastikan hasil akhir tidak kosong;
- jangan mengubah istilah teknis biasa hanya karena mengandung kata yang mirip pola error.

Tolak response jika:

- HTTP bukan 2xx;
- body bukan JSON;
- struktur tidak cocok dengan adapter endpoint yang sudah lolos smoke test;
- pada Responses-style, `status` ada tetapi bukan `completed`;
- tidak ada teks jawaban;
- output kosong.

### 20.3 Deteksi defensif provider error dalam output_text

Karena Hermes saat ini mungkin mengembalikan HTTP 200 tetapi `output_text` berisi provider error, filter pola defensif seperti:

```text
provider error
request failed
provider request failed
timeout
rate limit
quota exceeded
unauthorized
invalid api key
connection refused
service unavailable
```

Jangan kirim teks error internal ke TTS.

Map menjadi `HERMES_FAILED` dan kirim event error ke BMO.

Hindari false positive: gunakan kombinasi pattern + struktur kalimat error, bukan sekadar satu kata umum.

---

## 21. Timeout Pipeline

Gunakan timeout berikut sebagai baseline:

```text
Upload WAV              : 90 detik
STT faster-whisper      : 90 detik
Hermes soft threshold   : 30 detik
Hermes hard timeout     : 180 detik
Kokoro TTS              : 60 detik
RVC conversion          : 120 detik
Total pipeline maksimal : 300 detik
TTL MP3                 : 300 detik
```

Jika Hermes melewati 30 detik, log warning tetapi jangan langsung batalkan. Batalkan pada hard timeout 180 detik.

Jika RVC melewati timeout 120 detik, anggap RVC gagal dan langsung gunakan fallback Kokoro-only selama WAV Kokoro masih valid. Jangan menunggu total pipeline timeout hanya karena RVC.

Jika total pipeline melewati 300 detik:

```json
{
  "event": "request_failed",
  "request_id": "<uuid>",
  "code": "PIPELINE_TIMEOUT",
  "recoverable": true
}
```

Gunakan `AbortController` pada client Hermes dan timeout eksplisit pada seluruh internal HTTP call.

---

## 23. Lifecycle File Sementara

### 23.1 WAV input dari ESP32

- Simpan setelah upload valid.
- Hapus setelah MP3 final berhasil dibuat.
- Jika pipeline gagal, hapus melalui `finally` cleanup.

### 23.2 WAV intermediate Kokoro/RVC

- Gunakan `/tmp` di Audio Service atau memory buffer; jangan simpan sebagai file permanen.
- Hapus semua WAV intermediate Kokoro/RVC melalui `finally` sebelum request internal selesai, baik sukses maupun gagal.
- Jangan masukkan WAV intermediate ke public temp-audio directory.

### 23.3 MP3

- Simpan dengan UUID acak.
- `GET /audio/:audioId.mp3` mengembalikan `410 Gone` dengan `{"error":"AUDIO_EXPIRED"}` jika ID pernah valid tetapi TTL sudah habis; gunakan `404 Not Found` untuk ID yang tidak dikenal.
- Hapus setelah `audio_playback_done`.
- Hapus setelah `audio_playback_failed` final; jangan regenerate MP3 atau resend `audio_ready` sebagai retry backend.
- Auto-delete ketika TTL 5 menit habis.
- Saat TTL habis sebelum playback selesai, mark request `expired`, kirim `request_failed: AUDIO_EXPIRED` jika device online, lalu lepas busy state.

Event `audio_playback_done` dan `audio_playback_failed` wajib idempotent:

- validasi event berasal dari device pemilik request;
- duplicate event tidak boleh crash atau menghapus file lain;
- event untuk request unknown/expired cukup dilog sebagai warning;
- jika firmware reconnect setelah playback selesai, duplicate `audio_playback_done` tetap diterima aman.

### 23.4 Periodic dan startup cleanup

Backend menjalankan sweeper periodik, baseline setiap 30 detik:

- hapus MP3 yang sudah melewati `expires_at`/TTL 5 menit;
- update request menjadi `expired`, lepas busy state, dan kirim `AUDIO_EXPIRED` jika device online;
- garbage-collect tombstone setelah retention selesai.

Saat backend start:

- hapus MP3 yatim dengan usia lebih dari TTL 5 menit;
- hapus WAV input yatim yang lebih lama dari 10 menit;
- file MP3 yang belum berusia 5 menit boleh dibiarkan sampai sweeper berikutnya, tetapi tidak boleh dikaitkan ke request aktif karena request store in-memory telah hilang;
- jangan menghapus file di luar temp directory;
- validasi path untuk mencegah path traversal.

---

## 24. Security

Wajib:

- compare device token dengan cara aman;
- jangan log token/key;
- jangan log raw audio atau transcript penuh secara default; gunakan metadata/durasi dan correlation ID;
- limit body HTTP 3 MB;
- limit message WebSocket JSON maksimal 8 KB;
- validasi Content-Length dan actual bytes;
- validasi RIFF/WAV header dan metadata;
- sanitize semua path;
- audio URL memakai UUID acak;
- audio URL TTL 5 menit;
- audio service memakai `X-Internal-Service-Token`;
- Hermes tetap localhost-only;
- audio service tetap localhost-only;
- staging memakai firewall ketat;
- production memakai HTTPS/WSS.

Karena staging awal menggunakan HTTP melalui IP, jangan gunakan token production permanen. Gunakan temporary staging token dan rotasi setelah domain/TLS aktif.

---
