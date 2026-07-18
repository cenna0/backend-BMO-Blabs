# BMO MVP — Instruksi Implementasi Full Backend untuk Hermes

**Versi:** 1.0.5
**Tanggal:** 2026-07-18
**Eksekutor:** Hermes Agent pada VPS BMO
**Tujuan:** Membangun, men-deploy, menguji, dan mendokumentasikan full backend voice MVP BMO.

> Seluruh instruksi operasional di dokumen ini menggunakan Bahasa Indonesia. Nama kode, endpoint, field JSON, command, dan environment variable tetap English. Respons suara BMO pada runtime harus selalu menggunakan English.

---

## 1. Peran Hermes

Hermes bertindak sebagai orkestrator implementasi. Hermes wajib:

1. Melakukan audit VPS tanpa merusak instalasi Hermes yang sudah berjalan.
2. Membangun backend Express.js + TypeScript.
3. Membangun Local Audio Service menggunakan Python + FastAPI.
4. Memasang dan mengonfigurasi faster-whisper, Kokoro, RVC, dan FFmpeg.
5. Mengintegrasikan backend dengan Hermes API yang sudah aktif.
6. Men-deploy backend dan audio service melalui Docker Compose.
7. Membuat automated tests dan fake ESP32 client.
8. Menjalankan smoke test dan end-to-end test.
9. Membuat laporan akhir dengan bukti hasil verifikasi.

Jangan hanya membuat scaffold. Hasil akhir harus benar-benar berjalan.

---

## 2. Scope Ketat MVP

Implementasikan hanya:

```text
ESP32 upload satu WAV utuh
→ faster-whisper STT
→ Hermes menghasilkan jawaban teks English
→ Kokoro TTS
→ RVC voice conversion BMO bila tersedia
→ FFmpeg menghasilkan MP3
→ backend membuat URL audio sementara
→ backend memberi tahu ESP32 melalui WebSocket
```

Jangan implementasikan:

- PostgreSQL atau Prisma;
- user account dan mobile authentication;
- Spotify;
- WhatsApp;
- API mobile app;
- audio chunk melalui WebSocket;
- streaming response dari LLM;
- streaming generation TTS;
- dashboard admin multi-user/multi-device.

State request pipeline suara MVP disimpan in-memory. Hilangnya request aktif saat backend restart dapat diterima untuk MVP. Keputusan project memakai PostgreSQL + Prisma untuk user, device, Spotify, settings, dan data aplikasi tetap berlaku; database hanya belum dipakai pada implementasi voice MVP ini.

### 2.1 Keputusan locked vs baseline implementasi

**Keputusan locked dari diskusi:**

- raw WAV utuh melalui HTTP body `audio/wav`, bukan `multipart/form-data`;
- rekaman berhenti setelah diam 2,5 detik atau maksimal 60 detik;
- input WAV wajib PCM signed 16-bit little-endian, 16 kHz, mono;
- WebSocket harus aktif dan terautentikasi sebelum upload;
- autentikasi WebSocket melalui message JSON;
- UUID v4 dari ESP32 sebagai request ID dan idempotency key;
- state request in-memory, tanpa PostgreSQL untuk voice MVP;
- faster-whisper multilingual dengan auto-detect Indonesia/English/mixed;
- BMO selalu menjawab dalam English;
- Kokoro + RVC BMO dengan fallback Kokoro-only;
- MP3 dikirim sebagai URL dan diambil melalui HTTP;
- mode display MVP hanya `idle`, `thinking`, `speaking`, dan `error`; backend hanya mengirim `thinking`;
- retry download MP3 satu kali dari awal;
- WAV dihapus setelah output MP3 selesai; MP3 dihapus setelah playback selesai/gagal atau TTL;
- error diekspresikan oleh hardware dengan audio error lokal.

**Baseline teknis yang harus dibenchmark, bukan dianggap keputusan permanen user:**

- faster-whisper `small`, CPU INT8, 4 thread, beam size 5;
- Kokoro voice `af_heart`;
- MP3 mono 24 kHz/96 kbps;
- timeout per tahap;
- retry upload maksimal dua kali setelah percobaan awal;
- batas upload 3 MB;
- tombstone 10 menit;
- parameter RVC `f0_up_key=0` dan `rmvpe`;
- Node.js 22, Python 3.10, Zod/Pino/Vitest sebagai pilihan implementasi awal.

Hermes boleh mengubah baseline hanya setelah test/benchmark dan wajib mencatat alasan serta dampaknya. Hermes tidak boleh mengubah keputusan locked atau kontrak event/endpoint tanpa approval user.

Guardrail seperti `backend_state`, body SHA-256, tombstone request, public status mapping, dan HTTP `410 AUDIO_EXPIRED` ditambahkan untuk menutup edge case implementasi. Guardrail ini bukan perubahan produk dan tetap wajib diimplementasikan selama tidak terbukti bermasalah pada test hardware.

---

## 3. Hermes Existing Service — Jangan Dirusak

Hermes sudah berjalan langsung di host VPS:

```text
Base URL : http://127.0.0.1:8642
Endpoint : POST /v1/responses
Model    : hermes-agent
Auth     : Bearer API key
```

Aturan wajib:

- Jangan memindahkan Hermes ke Docker.
- Jangan menghentikan atau mengganti service Hermes existing.
- Jangan expose port `8642` ke internet.
- Jangan mencetak API key aktif ke log atau laporan.
- Jangan mengubah global `SOUL.md` tanpa persetujuan user.
- Backend wajib mengirim personality/instructions BMO pada setiap request.

Audit Hermes yang diberikan user sudah memverifikasi `/v1/responses`, `/v1/chat/completions`, dan `/v1/models`. Namun model pada body saat ini hanya label/cosmetic; model LLM aktual tetap ditentukan konfigurasi Hermes. Karena itu `/v1/models` boleh dipakai untuk diagnosis, tetapi jangan dijadikan dependency runtime backend.

Jalankan smoke test ulang ke `/v1/responses` dengan `stream:false` untuk memastikan service belum berubah, simpan contoh struktur respons yang sudah disanitasi, lalu gunakan adapter Responses-style yang telah terbukti. `/v1/chat/completions` hanya menjadi fallback jika `/v1/responses` benar-benar gagal atau berubah tidak kompatibel.

---

## 4. Arsitektur Deployment

VPS sudah memiliki Docker.

```text
VPS host
├── Hermes Agent
│   └── 127.0.0.1:8642
│
└── Docker Compose
    ├── bmo-backend
    │   ├── network_mode: host
    │   └── 0.0.0.0:3000
    └── bmo-audio-service
        ├── bridge network biasa
        └── publish 127.0.0.1:8001 → container:8001
```

Gunakan `network_mode: host` **hanya untuk backend**, karena backend harus mengakses Hermes pada `127.0.0.1:8642` milik host. Audio service tidak membutuhkan host networking dan harus diisolasi pada bridge network dengan port yang hanya dipublish ke loopback host.

```yaml
bmo-backend:
  network_mode: host
  restart: unless-stopped

bmo-audio-service:
  ports:
    - "127.0.0.1:8001:8001"
  restart: unless-stopped
```

- Backend memanggil Audio Service melalui `http://127.0.0.1:8001`.
- Audio service tidak boleh menerima secret Hermes atau device token.
- Backend boleh bind ke `0.0.0.0:3000` untuk staging setelah aman.
- Setelah domain tersedia, gunakan reverse proxy dan TLS.

---

## 5. Struktur Filesystem

Gunakan:

```text
/opt/bmo-mvp/
├── backend/
├── audio-service/
├── tests/
├── scripts/
├── models/
│   ├── hf-cache/
│   ├── torch-cache/
│   └── rvc-bmo/
├── temp-audio/
├── docker-compose.yml
├── .env.backend
├── .env.audio
├── .env.backend.example
├── .env.audio.example
├── MODEL_MANIFEST.md
└── README.md
```

Aturan:

- Permission `.env.backend` dan `.env.audio`: `600`.
- Gunakan file environment terpisah agar Audio Service tidak menerima `HERMES_API_KEY`, `DEVICE_TOKEN`, atau secret backend lain.
- Jangan commit `.env`, model weights, generated audio, atau credentials.
- `temp-audio/` harus writable oleh backend container.
- Catat source, revision/commit, nama file, ukuran, dan SHA256 semua model di `MODEL_MANIFEST.md`.

---

## 6. Preflight Audit

Sebelum memasang apa pun, kumpulkan:

```bash
uname -a
cat /etc/os-release
nproc
free -h
df -h
docker --version
docker compose version
ss -lntp
```

Periksa juga:

- sisa disk;
- container/image/volume Docker existing;
- proses yang memakai port `3000`, `8001`, dan `8642`;
- kesehatan Hermes;
- load CPU dan RAM;
- jumlah proses FFmpeg existing.

Aturan keselamatan:

- Jangan hapus container, image, volume, cache, atau data user tanpa membuat daftar dan meminta persetujuan.
- Jangan menghapus atau memodifikasi `/home/rangga/.hermes`, virtual environment Hermes, atau executable Hermes.
- Jika free disk di bawah **20 GB**, hentikan download model/PyTorch/RVC dan laporkan blocker.
- Setelah user mengosongkan server, audit ulang sebelum instalasi.

---

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

## 9. Teknologi Audio Service

Gunakan:

```text
Python 3.10 sebagai baseline kompatibilitas RVC
FastAPI
Uvicorn
faster-whisper
Kokoro
soundfile
PyTorch CPU
FFmpeg
RVC inference
```

System dependency minimal:

```bash
apt-get update && apt-get install -y --no-install-recommends \
  ffmpeg \
  espeak-ng \
  libsndfile1 \
  git \
  curl \
  unzip \
  ca-certificates
```

Bersihkan apt lists setelah instalasi.

Referensi upstream yang harus diverifikasi sebelum pin versi:

```text
faster-whisper:
https://github.com/SYSTRAN/faster-whisper

Kokoro:
https://github.com/hexgrad/kokoro

RVC:
https://github.com/RVC-Project/Retrieval-based-Voice-Conversion-WebUI

Community BMO RVC model:
https://huggingface.co/Freaky98/CGO-adventure-time-BMO-rvc-v2-420e
```

Jangan memakai floating dependency tanpa mencatat versi final yang benar-benar lolos test.

### 9.1 Bootstrap dan cache model persisten

faster-whisper dan Kokoro dapat mengunduh model/voice saat pertama kali dipakai. Jangan membiarkan runtime container mengunduh ulang model setiap restart.

Gunakan prosedur berikut:

1. Buat script/container bootstrap satu kali yang memiliki akses tulis ke `/opt/bmo-mvp/models`.
2. Download model Whisper `small`, weight/voice Kokoro, dependency RVC, dan model BMO ke cache persisten.
3. Catat source, revision, ukuran, dan SHA256 di `MODEL_MANIFEST.md`.
4. Jalankan smoke inference saat cache masih writable.
5. Setelah lengkap, runtime `bmo-audio-service` mount directory model sebagai read-only.
6. Runtime production harus gagal dengan pesan jelas jika model wajib hilang; jangan diam-diam mengunduh model baru.

Gunakan cache persisten:

```text
HF_HOME=/opt/bmo-mvp/models/hf-cache
TORCH_HOME=/opt/bmo-mvp/models/torch-cache
```

Cache sementara library lain dapat diarahkan ke `/tmp/cache`.

Catatan kompatibilitas RVC:

- Upstream RVC menyediakan `requirements-py311.txt`, tetapi dokumentasinya juga mencatat konflik dependency tertentu di atas Python 3.10.
- Gunakan Python 3.10 sebagai baseline pertama.
- Jika Hermes memilih Python 3.11, wajib memakai dependency path khusus Python 3.11 dan membuktikan seluruh inference test lulus sebelum melanjutkan.

---

## 10. Konfigurasi faster-whisper

Konfigurasi awal:

```text
Model         : small multilingual, bukan small.en
Device        : cpu
Compute type  : int8
CPU threads   : 4
Workers       : 1
Language      : auto detect
Task          : transcribe
VAD           : aktif
Beam size     : 5
```

Target implementasi:

```python
from faster_whisper import WhisperModel

model = WhisperModel(
    "small",
    device="cpu",
    compute_type="int8",
    cpu_threads=4,
    num_workers=1,
)

segments, info = model.transcribe(
    audio_path,
    language=None,
    task="transcribe",
    beam_size=5,
    vad_filter=True,
)
```

Input user dapat berupa:

- Bahasa Indonesia;
- English;
- campuran Indonesia–English.

Jangan memaksa `language="id"` karena code-switching diperkirakan sering terjadi.

### 10.1 Validasi no-speech/noise

Anggap sebagai `NO_SPEECH` jika kombinasi indikator menunjukkan tidak ada ucapan yang berguna:

- tidak ada segment setelah VAD;
- transcript kosong/whitespace;
- durasi speech efektif nol;
- transcript hanya noise artifact yang jelas.

Jangan kirim transcript kosong/noise ke Hermes.

Respons internal no-speech:

```json
{
  "text": "",
  "speech_detected": false,
  "language": null,
  "language_probability": 0
}
```

Respons valid:

```json
{
  "text": "BMO, tolong remind aku about the meeting tomorrow.",
  "speech_detected": true,
  "language": "id",
  "language_probability": 0.82
}
```

Jangan menolak mixed language hanya karena bahasa dominannya Indonesia atau English.

---

## 11. Konfigurasi Kokoro

**BMO selalu menjawab dalam English.** Input user boleh Indonesia, English, atau campuran, tetapi Hermes wajib menghasilkan jawaban English sebelum TTS.

Konfigurasi awal:

```text
Language code : a (American English)
Voice         : af_heart
Output        : WAV 24 kHz
```

Environment variable:

```env
KOKORO_LANG_CODE=a
KOKORO_VOICE=af_heart
```

Aturan:

- Generate satu jawaban utuh sekaligus.
- Kokoro dapat menghasilkan beberapa waveform segment dari generator internal; gabungkan seluruh segment secara berurutan menjadi satu WAV sebelum RVC/FFmpeg.
- Jangan TTS per kata atau arbitrary chunk dari backend.
- Trim whitespace.
- Plain text saja.
- Maksimal 3 kalimat pendek.
- Batas aman sekitar 600 karakter.

---

## 12. RVC Voice BMO

Gunakan community model sebagai aset eksperimental MVP, bukan model resmi yang dijamin kualitasnya.

Repository model:

```text
Repo      : Freaky98/CGO-adventure-time-BMO-rvc-v2-420e
Revision  : 82a8bc529bd41b930589188ead30f073d4f99fc0
File      : CGO-adventure-time-BMO-rvc-v2-420e.zip
Size      : 63,780,149 bytes
SHA256    : dadb3507d3f836836b16c5605ace8d383e57eddcc92dc2a5fc4406e1c49d27f0
License   : openrail (model card sangat minim; perlakukan sebagai aset eksperimen)
```

Prosedur:

1. Download revision exact ke `/opt/bmo-mvp/models/rvc-bmo/`.
2. Verifikasi byte size dan SHA256 sebelum extract.
3. Inspeksi isi archive sebelum extract.
4. Jangan menjalankan script dari archive model.
5. Hanya terima asset yang masuk akal seperti `.pth` dan opsional `.index`.
6. Siapkan dependency inference RVC yang dibutuhkan, termasuk `hubert_base.pt` dan `rmvpe.pt` bila pipeline yang dipilih memerlukannya; catat source, revision, dan SHA256 di `MODEL_MANIFEST.md`.
7. Pin revision kode RVC yang lolos CPU inference.
8. Jalankan inference di audio-service container terisolasi, non-root, tanpa secret backend/Hermes.
9. Loading `.pth` berbasis PyTorch berpotensi mengeksekusi pickle. Gunakan loader aman seperti `weights_only=True` jika kompatibel; jika tidak kompatibel, tetap jalankan hanya di container terisolasi tanpa secret, dengan filesystem read-only sebisa mungkin.
10. Gunakan CPU kecuali GPU kompatibel ditambahkan kemudian.
11. Inspeksi metadata/checkpoint untuk mengetahui sample rate model RVC. Resample WAV Kokoro ke sample rate input yang dibutuhkan RVC, lalu resample hasil akhir ke format MP3 yang lolos tes ESP32.
12. Parameter awal RVC dibuat configurable; gunakan `f0_up_key=0` dan `f0_method=rmvpe` sebagai baseline test, lalu ubah hanya berdasarkan hasil dengar/benchmark.

### 12.1 Fallback wajib

```text
Normal:
Kokoro WAV → RVC BMO → FFmpeg → MP3

Fallback:
Kokoro WAV → FFmpeg → MP3
```

Jika RVC gagal:

- log error tanpa secret;
- lanjutkan dengan Kokoro-only;
- tandai `rvc_applied=false`;
- jangan gagalkan request jika Kokoro + FFmpeg masih berfungsi.

Jika Kokoro juga gagal, return `TTS_FAILED`.

### 12.2 Acceptance test RVC

Generate:

```text
“Hi! BMO is ready to help.”
“Do not worry. BMO is right here with you.”
“Yay! BMO found the answer.”
```

Untuk setiap kalimat buat:

- Kokoro-only;
- Kokoro + RVC.

Laporkan durasi proses, ukuran file, status RVC, dan path output untuk didengarkan user secara manual.

---

## 13. Output FFmpeg

Target:

```text
Container   : MP3
Channel     : mono
Bitrate     : 96 kbps
Sample rate : 24 kHz atau decoder-friendly rate yang lolos tes ESP32
```

Contoh:

```bash
ffmpeg -y -i input.wav -ac 1 -ar "${OUTPUT_MP3_SAMPLE_RATE}" -b:a "${OUTPUT_MP3_BITRATE}" output.mp3
```

Command harus deterministik dan non-zero exit wajib dianggap gagal.

Verifikasi dengan `ffprobe`:

- codec;
- duration;
- channels;
- sample rate;
- bitrate.

---

## 14. API Internal Audio Service

Audio service hanya boleh diakses dari localhost.

### 14.1 `GET /health`

```json
{
  "status": "ok",
  "stt_loaded": true,
  "kokoro_loaded": true,
  "rvc_available": true,
  "ffmpeg_available": true
}
```

Gunakan `loading` selama model wajib sedang dimuat, `degraded` jika Kokoro berfungsi tetapi RVC tidak tersedia, dan `error` jika STT/Kokoro/FFmpeg wajib tidak siap.

### 14.2 `POST /stt/transcribe`

Header:

```http
Content-Type: audio/wav
X-Internal-Service-Token: <secret>
```

Body: raw WAV bytes.

Sukses:

```json
{
  "text": "Hello BMO, how are you?",
  "speech_detected": true,
  "language": "en",
  "language_probability": 0.97,
  "duration_seconds": 3.4
}
```

No speech adalah hasil analisis valid, bukan server crash:

```json
{
  "text": "",
  "speech_detected": false,
  "language": null,
  "language_probability": 0,
  "duration_seconds": 3.0
}
```

### 14.3 `POST /tts/synthesize`

Header:

```http
Content-Type: application/json
X-Internal-Service-Token: <secret>
```

Body:

```json
{
  "request_id": "<uuid>",
  "text": "Hi! BMO is ready to help.",
  "use_rvc": true
}
```

Return body berupa byte `audio/mpeg`.

Header hasil:

```http
Content-Type: audio/mpeg
X-RVC-Applied: true
X-TTS-Engine: kokoro-rvc
```

Fallback:

```http
X-RVC-Applied: false
X-TTS-Engine: kokoro
```

---

## 15. Public Backend API

Implementasikan kontrak dari `BMO-MVP-HW-INTERFACE-CONTRACT.md`.

Route wajib:

```text
GET  /health
WS   /ws
POST /api/v1/voice
GET  /audio/:audioId.mp3
```

Untuk route audio, kirim minimal:

```http
Content-Type: audio/mpeg
Content-Length: <bytes>
Cache-Control: no-store, private, max-age=0
```

Jangan aktifkan directory listing. Hanya UUID audio valid yang boleh diakses.

### 15.1 `GET /health`

Jangan bocorkan secret:

```json
{
  "status": "ok",
  "backend": "ok",
  "hermes": "ok",
  "audio_service": "ok",
  "rvc": "available"
}
```

Gunakan `degraded` jika RVC unavailable tetapi Kokoro fallback bekerja.

---

## 16. Persyaratan WebSocket

Implementasikan:

- autentikasi message maksimal 5 detik setelah connect;
- close code canonical: `4001` auth required, `4003` invalid credentials, `4008` auth timeout;
- koneksi terautentikasi terbaru menang;
- device registry in-memory;
- native ping setiap 60 detik;
- tutup koneksi setelah 2 missed pong;
- tidak menerapkan idle timeout satu jam selama ping/pong sehat;
- respons `authenticated` menyertakan `backend_state` dan `active_request_id` untuk sinkronisasi setelah reconnect/restart;
- backend hanya mengirim mode display `thinking`; `idle`, `speaking`, dan `error` dikendalikan firmware;
- tidak membuat atau mengirim mode display `listening`;
- kirim ulang pending `audio_ready` setelah reconnect jika MP3 masih valid;
- jangan membuat event `audio_ready_received`; reliability memakai reconnect state sync + deduplikasi `request_id`;
- validasi schema JSON;
- batas ukuran message kecil karena audio tidak dikirim melalui WebSocket.

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

Jangan mengirim WAV atau MP3 melalui WebSocket.

### 16.1 Schema event canonical

ESP32 → Backend, autentikasi:

```json
{
  "event": "authenticate",
  "device_id": "bmo-001",
  "device_token": "<device-secret>"
}
```

Backend → ESP32, autentikasi sukses:

```json
{
  "event": "authenticated",
  "status": "ok",
  "device_id": "bmo-001",
  "backend_state": "idle | thinking | audio_ready",
  "active_request_id": null
}
```

Jika `backend_state` bukan `idle`, `active_request_id` wajib berisi UUID request aktif. Setelah respons auth, kirim ulang event state yang relevan.

Backend → ESP32, autentikasi gagal:

```json
{
  "event": "authentication_failed",
  "error": "INVALID_DEVICE_CREDENTIALS"
}
```

Setelah event tersebut, tutup socket dengan `4003`. Jika auth tidak dikirim dalam 5 detik gunakan `4008`; jika client mengirim event lain sebelum auth gunakan `4001`.

Backend → koneksi lama ketika koneksi baru mengambil alih:

```json
{
  "event": "connection_replaced",
  "reason": "NEW_CONNECTION_ESTABLISHED"
}
```

Backend → ESP32, mode thinking:

```json
{
  "event": "display_status",
  "request_id": "<uuid-v4>",
  "status": "thinking"
}
```

Backend → ESP32, audio siap:

```json
{
  "event": "audio_ready",
  "request_id": "<uuid-v4>",
  "audio_url": "http://<host>:3000/audio/<audio-uuid>.mp3",
  "format": "mp3",
  "expires_in_seconds": 300
}
```

Hitung `expires_in_seconds` dari `expires_at - now` setiap kali event dikirim. Pada resend setelah reconnect, jangan mereset TTL menjadi 300 detik.

ESP32 → Backend, playback selesai:

```json
{
  "event": "audio_playback_done",
  "request_id": "<uuid-v4>"
}
```

ESP32 → Backend, playback gagal:

```json
{
  "event": "audio_playback_failed",
  "request_id": "<uuid-v4>",
  "reason": "DOWNLOAD_FAILED | DECODE_FAILED | PLAYBACK_FAILED"
}
```

Saat menerima `audio_playback_failed`, backend **tidak** mengirim ulang `audio_ready` dan tidak membuat MP3 baru. ESP32 sudah melakukan satu retry download dari awal sebelum mengirim event tersebut. Backend menghapus MP3, menandai request gagal, melepas busy state, dan menerima duplicate event secara idempotent.

Backend → ESP32, pipeline gagal:

```json
{
  "event": "request_failed",
  "request_id": "<uuid-v4>",
  "code": "NO_SPEECH | INVALID_AUDIO | STT_FAILED | HERMES_FAILED | TTS_FAILED | AUDIO_EXPIRED | PIPELINE_TIMEOUT | INTERNAL_ERROR",
  "recoverable": true
}
```

Schema `authentication_failed` dan `connection_replaced` harus sama persis dengan HW contract. Tolak event unknown atau schema invalid tanpa menjatuhkan seluruh process backend.

---

## 17. Persyaratan Upload Voice

`POST /api/v1/voice` menerima raw WAV bytes.

Header wajib:

```text
X-Device-Id
X-Device-Token
X-Request-Id
Content-Type: audio/wav
Content-Length
```

Validasi:

```text
WAV RIFF
PCM signed 16-bit little-endian
16 kHz
mono
maksimal 3 MB
maksimal 60 detik
request ID harus UUID v4
WebSocket harus aktif dan terautentikasi
satu request aktif per device
```

Cek WebSocket dua kali: sebelum menerima body besar dan sekali lagi setelah WAV selesai divalidasi tepat sebelum request state dibuat/HTTP `202` dikirim. Jika koneksi hilang di tengah upload, hapus file sementara dan return `409 WEBSOCKET_NOT_CONNECTED`.

Return `202 Accepted` segera setelah upload aman diterima dan request state dibuat. Pipeline dijalankan asynchronous.

Karena HTTP dan WebSocket merupakan koneksi terpisah, firmware dapat menerima `display_status: thinking` sebelum atau sesudah HTTP `202`. Seluruh event wajib memakai `request_id`; backend dan fake ESP32 test harus menguji kedua kemungkinan urutan.

Idempotency:

- request pertama yang valid: `202 Accepted`;
- duplicate `device_id + request_id` yang valid: `200 OK` dengan `duplicate:true` dan status publik aktual;
- status internal `accepted`, `transcribing`, `thinking`, dan `generating_voice` dipetakan menjadi status publik `processing`;
- request ID sama + device sama tidak boleh membuat pipeline baru;
- backend menghitung SHA-256 body WAV dan menyimpannya sebagai `input_sha256`;
- request ID sama dengan body hash berbeda: `409 REQUEST_ID_CONFLICT`;
- jika status `audio_ready` dan file belum expired, kirim ulang `audio_ready`;
- request ID sama dari device lain: `409 REQUEST_ID_CONFLICT`;
- tombstone completed/failed/expired dipertahankan baseline minimal 10 menit.

Urutan validasi wajib:

1. validasi credentials dan header dasar;
2. cek duplicate `device_id + request_id`;
3. jika duplicate, return status existing tanpa terkena `DEVICE_BUSY`;
4. jika request ID baru, baru cek satu request aktif per device.

Untuk duplicate request, baca body dengan batas 3 MB dan bandingkan SHA-256 terhadap request awal. `Content-Length` berbeda boleh menjadi early rejection, tetapi hash body adalah pemeriksaan final. Jika berbeda, return `409 REQUEST_ID_CONFLICT` dan jangan memulai pipeline baru.

### 17.1 HTTP response canonical

| Kondisi | HTTP | Error/status |
|---|---:|---|
| Request baru valid | `202` | `{"request_id":"<uuid>","status":"processing"}` |
| Duplicate valid | `200` | `{"request_id":"<uuid>","status":"processing|audio_ready|completed|failed|expired","duplicate":true,"error_code":null}` |
| WebSocket belum aktif/auth | `409` | `WEBSOCKET_NOT_CONNECTED` |
| Device masih memproses request lain | `409` | `DEVICE_BUSY` |
| Device credential salah | `401` | `INVALID_DEVICE_CREDENTIALS` |
| Header wajib hilang | `400` | `MISSING_REQUIRED_HEADER` |
| Request ID bukan UUID v4 | `400` | `INVALID_REQUEST_ID` |
| Request ID sama tetapi device/body berbeda | `409` | `REQUEST_ID_CONFLICT` |
| Content-Type bukan `audio/wav` | `415` | `UNSUPPORTED_AUDIO_TYPE` |
| Body lebih dari 3 MB | `413` | `AUDIO_TOO_LARGE` |
| WAV/PCM metadata tidak valid | `422` | `INVALID_AUDIO_FORMAT` |
| Error backend tak terduga sebelum accept | `500` | `INTERNAL_ERROR` |

Untuk `WEBSOCKET_NOT_CONNECTED`, gunakan body exact:

```json
{
  "error": "WEBSOCKET_NOT_CONNECTED",
  "message": "Device must reconnect before uploading audio."
}
```

Gunakan hanya kode `WEBSOCKET_NOT_CONNECTED`; jangan membuat alias `WEBSOCKET_NOT_READY`.

Jangan return `202` sebelum seluruh raw body diterima, ukuran/hash selesai dihitung, file WAV tersimpan aman, dan request state berhasil dibuat.

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

## 22. Mapping Error

| Sumber | Kode ke ESP32 |
|---|---|
| WAV rusak atau tidak sesuai | `INVALID_AUDIO` |
| Tidak ada speech/noise | `NO_SPEECH` |
| STT crash/timeout | `STT_FAILED` |
| Hermes network/HTTP/invalid output/provider error | `HERMES_FAILED` |
| Kokoro dan fallback gagal | `TTS_FAILED` |
| MP3 expired sebelum playback | `AUDIO_EXPIRED` |
| Total timeout | `PIPELINE_TIMEOUT` |
| Error tak terduga | `INTERNAL_ERROR` |

Event:

```json
{
  "event": "request_failed",
  "request_id": "<uuid>",
  "code": "HERMES_FAILED",
  "recoverable": true
}
```

Firmware yang memainkan voice error lokal dan ekspresi error.

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

## 25. Docker Compose

Minimal:

```yaml
services:
  bmo-backend:
    build: ./backend
    network_mode: host
    restart: unless-stopped
    env_file: .env.backend
    volumes:
      - ./temp-audio:/opt/bmo-mvp/temp-audio
      - ./tests/fixtures:/opt/bmo-mvp/tests/fixtures:ro
    healthcheck:
      test: ["CMD", "curl", "-f", "http://127.0.0.1:3000/health"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 30s

  bmo-audio-service:
    build: ./audio-service
    restart: unless-stopped
    env_file: .env.audio
    ports:
      - "127.0.0.1:8001:8001"
    environment:
      HF_HOME: /opt/bmo-mvp/models/hf-cache
      TORCH_HOME: /opt/bmo-mvp/models/torch-cache
      XDG_CACHE_HOME: /tmp/cache
    volumes:
      - ./models:/opt/bmo-mvp/models:ro
    read_only: true
    tmpfs:
      - /tmp:size=1g
    cap_drop:
      - ALL
    security_opt:
      - no-new-privileges:true
    healthcheck:
      test: ["CMD", "curl", "-f", "http://127.0.0.1:8001/health"]
      interval: 30s
      timeout: 10s
      retries: 5
      start_period: 300s
```

Kedua image harus menjalankan process sebagai user non-root. Tambahkan log rotation pada masing-masing service:

```yaml
logging:
  driver: json-file
  options:
    max-size: "10m"
    max-file: "3"
```

Pastikan image menyediakan `curl` jika dipakai di healthcheck. Jika RVC membutuhkan writable cache tambahan, mount hanya directory cache khusus—jangan membuat seluruh root filesystem writable.

---

## 26. Environment Variables

`.env.backend.example`:

```env
NODE_ENV=production
BACKEND_HOST=0.0.0.0
BACKEND_PORT=3000
PUBLIC_BASE_URL=http://<IP_VPS>:3000

DEVICE_ID=bmo-001
DEVICE_TOKEN=replace-with-random-staging-secret

HERMES_API_URL=http://127.0.0.1:8642
HERMES_API_KEY=replace-me
HERMES_MODEL=hermes-agent
HERMES_CONVERSATION=bmo-001
HERMES_SOFT_TIMEOUT_MS=30000
HERMES_HARD_TIMEOUT_MS=180000

AUDIO_SERVICE_URL=http://127.0.0.1:8001
INTERNAL_SERVICE_TOKEN=replace-with-random-secret

TEMP_AUDIO_DIR=/opt/bmo-mvp/temp-audio
TEMP_AUDIO_TTL_SECONDS=300
TEMP_AUDIO_CLEANUP_INTERVAL_SECONDS=30
REQUEST_TOMBSTONE_TTL_SECONDS=600
MAX_REQUEST_STORE_ENTRIES=1000
MAX_AUDIO_BYTES=3145728
MAX_AUDIO_DURATION_SECONDS=60
TOTAL_PIPELINE_TIMEOUT_MS=300000

HARDWARE_TEST_MODE=false
HARDWARE_TEST_MP3_PATH=/opt/bmo-mvp/tests/fixtures/test-response.mp3
```

`.env.audio.example`:

> Nilai `INTERNAL_SERVICE_TOKEN` di `.env.backend` dan `.env.audio` harus **identik**, tetapi secret lain tidak boleh disalin ke Audio Service.

```env
AUDIO_SERVICE_HOST=0.0.0.0
AUDIO_SERVICE_PORT=8001
INTERNAL_SERVICE_TOKEN=replace-with-random-secret

HF_HOME=/opt/bmo-mvp/models/hf-cache
TORCH_HOME=/opt/bmo-mvp/models/torch-cache
XDG_CACHE_HOME=/tmp/cache
MODEL_DOWNLOAD_ALLOWED=false

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
RVC_MODEL_PATH=/opt/bmo-mvp/models/rvc-bmo/model.pth
RVC_INDEX_PATH=
RVC_F0_UP_KEY=0
RVC_F0_METHOD=rmvpe

OUTPUT_MP3_SAMPLE_RATE=24000
OUTPUT_MP3_BITRATE=96k
```

Jangan menebak nama file `.pth`/`.index`; update env setelah inspeksi archive sebenarnya. `RVC_INDEX_PATH` boleh kosong jika archive tidak memiliki index yang kompatibel.

---

## 27. Testing Wajib

### 27.1 Unit test

Backend:

- env validation;
- UUID validation;
- WAV header parser;
- device token auth;
- one-request-per-device;
- idempotency;
- Hermes output parser;
- provider-error filter;
- temp audio cleanup.

Audio service:

- no-speech detection;
- STT output schema;
- TTS text validation;
- RVC fallback;
- FFmpeg failure handling.

### 27.2 Integration test

- `/health` backend;
- `/health` audio service;
- upload WAV valid;
- invalid content type;
- WAV terlalu besar;
- WAV metadata salah;
- WebSocket belum terhubung;
- device busy;
- duplicate request ID;
- no-speech;
- Hermes unavailable;
- RVC unavailable fallback;
- MP3 TTL cleanup, periodic sweeper, startup cleanup, dan event `AUDIO_EXPIRED`;
- WAV intermediate selalu terhapus setelah success/failure;
- duplicate `audio_playback_done/failed` aman;
- restart Audio Service tidak mengunduh ulang model.

### 27.3 Fake ESP32 client

Buat script Node.js yang:

1. connect ke WebSocket;
2. authenticate;
3. upload sample WAV raw body;
4. menerima `thinking`;
5. menerima `audio_ready`;
6. download MP3;
7. validasi `Content-Type` dan ukuran file;
8. mengirim `audio_playback_done`;
9. test reconnect saat `thinking`, saat download/playback disimulasikan, dan setelah playback selesai;
10. test duplicate `audio_ready` tidak memulai download/playback kedua;
11. test resend `audio_playback_done` setelah reconnect;
12. test duplicate request ID;
13. test `REQUEST_ID_CONFLICT`.

### 27.4 Test WAV

Buat sample WAV valid:

```text
PCM 16-bit
16 kHz
mono
```

Sediakan:

- English sample;
- Indonesian sample;
- mixed Indonesian-English sample;
- silence sample;
- noise sample.

---

## 28. Mode Early Test untuk Tim Hardware

Tim hardware sudah memiliki ESP32 dengan wake word dan membutuhkan backend secepatnya.

Sediakan test mode yang dapat diaktifkan melalui env:

```env
HARDWARE_TEST_MODE=true
HARDWARE_TEST_MP3_PATH=/opt/bmo-mvp/tests/fixtures/test-response.mp3
```

Saat aktif:

```text
ESP32 upload WAV valid
→ backend tidak menjalankan STT/Hermes/TTS
→ backend langsung copy/serve MP3 dummy
→ backend kirim audio_ready
```

Tujuan:

- tim hardware bisa menguji WebSocket;
- upload WAV;
- event thinking;
- audio URL;
- download progressive;
- MP3 decoder;
- speaking/idle state;
- playback_done/failed.

Test mode harus disabled by default dan tidak boleh aktif bersamaan dengan production mode.

---

## 29. Tahapan Deployment

### Stage 1 — Verifikasi lokal VPS

- backend bind lokal sementara;
- audio service lokal;
- Hermes localhost;
- test menggunakan curl dan fake ESP32.

### Stage 2 — Staging melalui IP VPS

```text
HTTP upload : http://<IP_VPS>:3000/api/v1/voice
WebSocket   : ws://<IP_VPS>:3000/ws
Audio       : http://<IP_VPS>:3000/audio/<uuid>.mp3
```

Aturan:

- gunakan staging token;
- firewall hanya membuka port yang diperlukan;
- jangan expose 8001 atau 8642;
- dokumentasikan risiko HTTP plaintext;
- rotasi token setelah TLS aktif.

### Stage 3 — Domain + TLS

Setelah domain tersedia:

```text
HTTPS : https://api.<domain>/api/v1/voice
WSS   : wss://api.<domain>/ws
Audio : https://api.<domain>/audio/<uuid>.mp3
```

Gunakan Caddy atau Nginx:

- terminate TLS;
- proxy WebSocket upgrade;
- proxy HTTP upload dan audio;
- hanya expose 80/443;
- redirect HTTP ke HTTPS;
- pertahankan timeout upload yang sesuai.

---

## 30. Acceptance Criteria

Implementasi dianggap selesai jika:

- [ ] Hermes existing tetap sehat.
- [ ] Docker Compose berhasil build dan start.
- [ ] Backend health `ok` atau `degraded` hanya karena RVC.
- [ ] Audio service health valid setelah model load dan model tidak di-download ulang setiap restart.
- [ ] WebSocket auth bekerja dengan close code `4001/4003/4008` sesuai kondisi.
- [ ] Duplicate connection menggantikan koneksi lama.
- [ ] Heartbeat 60 detik bekerja dan koneksi sehat tidak diputus hanya karena idle satu jam.
- [ ] `authenticated` menyinkronkan `backend_state` setelah reconnect dan backend restart.
- [ ] Upload raw WAV valid menghasilkan HTTP 202.
- [ ] Invalid WAV ditolak.
- [ ] Device tanpa WebSocket ditolak.
- [ ] Request duplicate tidak membuat pipeline kedua dan body berbeda dengan request ID sama menghasilkan `REQUEST_ID_CONFLICT`.
- [ ] Tombstone request mencegah duplicate terlambat dan garbage collection bekerja.
- [ ] Race HTTP 202 vs WebSocket thinking tidak merusak state firmware.
- [ ] Display hanya memakai `idle`, `thinking`, `speaking`, dan `error`; tidak ada mode `listening`.
- [ ] STT memahami English, Indonesian, dan mixed input.
- [ ] No-speech tidak dikirim ke Hermes.
- [ ] Hermes memakai `conversation:bmo-001`, `store:true`, `stream:false`, dan `truncation:auto`; continuity named conversation terbukti.
- [ ] Hermes menjawab selalu dalam English.
- [ ] Output Hermes plain text tanpa Markdown.
- [ ] Provider error tidak diteruskan ke TTS.
- [ ] Kokoro menghasilkan WAV valid.
- [ ] RVC diterapkan jika tersedia.
- [ ] Kokoro fallback bekerja jika RVC gagal.
- [ ] FFmpeg menghasilkan MP3 valid.
- [ ] `audio_ready` dikirim ke ESP32 dan duplicate event tidak menyebabkan playback kedua; tidak ada event `audio_ready_received` pada MVP.
- [ ] MP3 dapat di-download progresif dan URL expired menghasilkan HTTP 410/AUDIO_EXPIRED.
- [ ] MP3 awal 24 kHz mono 96 kbps lulus uji decoder ESP32, atau format alternatif dicatat.
- [ ] Audio response memakai `Cache-Control: no-store`.
- [ ] `audio_playback_done` menghapus MP3 dan duplicate completion diproses idempotent.
- [ ] `audio_playback_failed` menghapus MP3/melepas busy tanpa backend mengulang `audio_ready`.
- [ ] Periodic/startup TTL cleanup bekerja dan WAV intermediate tidak tertinggal.
- [ ] Fake ESP32 end-to-end test lulus.
- [ ] Hardware test mode bekerja.

---

## 31. Laporan Akhir Wajib dari Hermes

Setelah implementasi, buat laporan yang berisi:

1. Ringkasan arsitektur final.
2. Daftar file yang dibuat/diubah.
3. Versi dependency yang dipin.
4. Hasil preflight dan penggunaan resource.
5. Hasil build Docker.
6. Status setiap service.
7. Output health check.
8. Hasil test per kategori.
9. Benchmark:
   - durasi STT;
   - durasi Hermes;
   - durasi Kokoro;
   - durasi RVC;
   - total pipeline;
   - peak RAM/CPU.
10. Contoh request/response tanpa secret.
11. Path sample audio Kokoro-only dan Kokoro+RVC.
12. Known limitation.
13. Command start/stop/restart/log.
14. Endpoint staging yang diberikan ke tim hardware.
15. Rollback procedure.
16. Hal yang belum terverifikasi.

Jangan menyatakan sesuatu berhasil tanpa bukti command/test.

---

## 32. Urutan Eksekusi

Hermes wajib menjalankan tahap secara berurutan:

```text
1. Preflight audit
2. Laporkan blocker/risk
3. Buat filesystem + secret template
4. Build backend skeleton + hardware test mode
5. Test WebSocket + raw WAV + dummy MP3
6. Berikan endpoint awal ke tim hardware
7. Build audio service dan model bootstrap script
8. Download/pin cache faster-whisper dan test
9. Download/pin cache Kokoro dan test
10. Download/inspect/test RVC model
11. Restart audio service untuk memastikan model tidak di-download ulang
12. Integrasi FFmpeg
13. Integrasi Hermes API
14. Integrasi full pipeline
15. Unit + integration + fake ESP32 tests
16. Resource benchmark
17. Staging deployment
18. Final report
```

Prioritaskan kontrak hardware lebih dulu agar tim HW tidak menunggu seluruh AI stack selesai.

---

## 33. Hal yang Harus Ditanyakan Sebelum Tindakan Berisiko

Minta approval user sebelum:

- menghapus data/container/image/volume;
- mengubah firewall;
- membuka port publik;
- mengubah global Hermes config atau `SOUL.md`;
- mengganti service existing;
- menginstal package langsung ke host di luar Docker;
- menggunakan model/license yang belum jelas;
- men-deploy domain/TLS;
- merotasi secret production.

Untuk tindakan aman di dalam `/opt/bmo-mvp/`, lanjutkan tanpa menunggu approval tambahan selama tidak merusak service existing.

---

## Changelog

| Versi | Perubahan |
|---|---|
| 1.0.0 | Instruksi implementasi awal |
| 1.0.1 | Seluruh instruksi diubah ke Bahasa Indonesia; runtime personality dan jawaban suara BMO tetap English |
| 1.0.2 | Memperketat isolasi Docker/secret, pin aset RVC, kompatibilitas Python, tombstone idempotency, race HTTP/WS, kontrak MP3, dan cleanup state |
| 1.0.3 | Menambah model cache persisten, idempotensi playback, deduplikasi `audio_ready`, `AUDIO_EXPIRED`, status duplicate upload yang exact, reconnect playback tests, sanitizer TTS, dan startup health grace period |
| 1.0.4 | Memisahkan keputusan locked dari baseline, mengunci empat mode display tanpa `listening`, menghapus asumsi `/v1/models`, menambah capability test/adapter Hermes, schema event/HTTP canonical agar dokumen self-contained, canonical `WEBSOCKET_NOT_CONNECTED`, state sync setelah backend restart, hash WAV untuk idempotency, public status mapping, HTTP 410 audio expired, privacy log, dan validasi sample rate RVC |
| 1.0.5 | Audit ulang terhadap seluruh percakapan dan audit API Hermes: mengunci raw WAV tanpa multipart serta rekaman 2,5/60 detik, memulihkan payload `/v1/responses` terverifikasi (`conversation`, `store`, `stream`, `truncation`), menambah close code WebSocket, menghapus larangan tools global yang tidak pernah disepakati, menegaskan tidak ada `audio_ready_received`, menghapus retry count milik backend, memperbaiki command FFmpeg agar sample rate benar-benar diterapkan, menegaskan internal token kedua service harus sama, dan menyelaraskan periodic/startup cleanup dengan TTL MP3 5 menit |
