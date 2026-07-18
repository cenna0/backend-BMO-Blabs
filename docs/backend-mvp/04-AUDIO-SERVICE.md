# BMO Backend MVP — Local Audio Service

**Versi:** 1.0.1  
**Status:** CANONICAL AUDIO IMPLEMENTATION REFERENCE

> **Status:** Canonical backend MVP documentation package  
> **Derived from:** Backend Implementation v1.0.5, Hardware Contract v1.0.5, PRD v1.2.0  
> **Scope:** Backend voice MVP only. Firmware, mobile app, Spotify, WhatsApp, PostgreSQL, dan Prisma tidak diimplementasikan dalam package ini.


## Cara menggunakan file ini

File ini khusus Python/FastAPI Audio Service, model bootstrap/cache, faster-whisper, Kokoro, RVC, FFmpeg, dan internal API. Audio Service adalah bagian backend MVP tetapi merupakan runtime terpisah dari Express backend.

RVC adalah enhancement dengan fallback Kokoro-only. STT, Kokoro, dan FFmpeg adalah dependency wajib. Baseline performa/format boleh berubah hanya setelah benchmark dan harus dicatat.

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
