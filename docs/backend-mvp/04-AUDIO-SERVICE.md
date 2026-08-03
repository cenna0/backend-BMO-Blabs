# BMO Backend MVP — Local Audio Service

**Versi:** 1.0.1  
**Status:** CANONICAL AUDIO IMPLEMENTATION REFERENCE

> **2026-08-03 production note:** P8 deployed the fixed Piper Prudence voice as
> primary TTS after explicit operator listening approval and a controlled
> production canary. Kokoro `af_heart` at speed `0.80` remains the automatic
> fallback. Real RVC inference remains unverified and RVC stays disabled.
> Production-only values are authoritative; historical RVC sections below are
> archived design constraints, not an enabled runtime.

> **Status:** Canonical backend MVP documentation package  
> **Derived from:** Backend Implementation v1.0.5, Hardware Contract v1.0.5, PRD v1.2.4  
> **Scope:** Backend voice MVP only. Firmware, mobile app, Spotify, WhatsApp, PostgreSQL, dan Prisma tidak diimplementasikan dalam package ini.


## Cara menggunakan file ini

File ini khusus Python/FastAPI Audio Service, model bootstrap/cache,
faster-whisper, fixed Piper primary, Kokoro fallback, RVC archive boundary,
FFmpeg, dan internal API. Audio Service adalah bagian backend MVP tetapi
merupakan runtime terpisah dari Express backend.

RVC is not a production dependency. STT, Piper, Kokoro, and FFmpeg are the
verified production audio path. Baseline performance/format may change only
after benchmark and must be recorded in P8 rollout evidence.

### 9.2 Fixed production TTS routing

```text
Hermes text
  → persistent Piper worker
  → en_GB-semaine-medium / prudence / speaker 0
  → WAV validation
  → FFmpeg
  → mono 24 kHz target 96 kbps MP3
  → existing audio lifecycle and audio_ready
```

If Piper fails in a bounded way (worker crash/unavailable, timeout, malformed,
zero-byte, non-finite, unreasonable-duration, or output-path-invalid output),
the same request automatically uses Kokoro `af_heart` at speed `0.80`. If
Kokoro succeeds, the request remains a normal success and no hardware-visible
payload changes. If both engines fail, existing TTS failure semantics remain.

The worker is integrated and persistent, so warm requests do not reload the
model. It is private, non-root, offline-only, and constrained by the
production Compose resource/security controls. No public schema or firmware
event exposes engine internals, model paths, speaker IDs, stack traces, or
host paths.

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
integrated Piper persistent worker with Kokoro fallback
RVC inference (archived experimental boundary; disabled)
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

Referensi upstream dan status pin:

```text
faster-whisper:
https://github.com/SYSTRAN/faster-whisper
Production model: Systran/faster-whisper-medium
Revision: 08e178d48790749d25932bbc082711ddcfdfbc4f

Kokoro:
https://github.com/hexgrad/kokoro
Production model: hexgrad/Kokoro-82M
Revision: f3ff3571791e39611d31c381e3a41a3af07b4987

RVC:
https://github.com/RVC-Project/Retrieval-based-Voice-Conversion-WebUI

Community BMO RVC model:
https://huggingface.co/Freaky98/CGO-adventure-time-BMO-rvc-v2-420e
```

Jangan memakai floating dependency tanpa mencatat versi final yang benar-benar lolos test.

### 9.1 Provisioning, curated models, dan runtime cache

P7 memisahkan provisioning upstream dari production runtime. Production
Whisper/Kokoro tidak diunduh secara lazy pada first use.

```text
Provisioning root       /opt/bmo/models
Upstream provisioning   /opt/bmo/models/hf-cache
Curated runtime root    /opt/bmo/models/runtime
Curated manifest        /opt/bmo/models/runtime/MODEL_MANIFEST.json

Runtime library cache   /opt/bmo/cache/audio
HF runtime cache        /opt/bmo/cache/audio/huggingface
Torch runtime cache     /opt/bmo/cache/audio/torch
XDG runtime cache       /opt/bmo/cache/audio/xdg
TTS temp                /opt/bmo/temp/tts
```

Current production rules:

1. Only an explicitly authorized provisioning step may access the network and
   download exact immutable Whisper/Kokoro upstream revisions.
2. Provisioning verifies the approved source/revision and materializes only
   the seven approved runtime artifacts into `/opt/bmo/models/runtime`.
3. `MODEL_MANIFEST.json` records curated artifact names, byte sizes, and
   SHA-256 values. The approved aggregate fingerprint is
   `d2761b191eed48e85128e774aa7057153d8e8994e2e4f40c07ffb05731ae7e9f`.
4. Production mounts `/opt/bmo/models/runtime` read-only and runs with:

   ```env
   MODEL_DOWNLOAD_ALLOWED=false
   HF_HUB_OFFLINE=1
   TRANSFORMERS_OFFLINE=1
   ```

5. Writable library state is limited to the runtime cache paths above;
   generated TTS intermediates use `/opt/bmo/temp/tts`.
6. Production fails clearly if a mandatory curated artifact is missing or
   invalid. It must never download a replacement during startup.

The seven P7 artifacts cover Whisper and Kokoro only. RVC, HuBERT, RMVPE, and
an RVC inference engine are not part of this curated production set. Their
separate immutable provisioning and runtime layout belong to P8.

Catatan kompatibilitas RVC:

- Upstream RVC menyediakan `requirements-py311.txt`, tetapi dokumentasinya juga mencatat konflik dependency tertentu di atas Python 3.10.
- Gunakan Python 3.10 sebagai baseline pertama.
- P8 must resolve the RVC engine against the existing Python 3.10 Audio Service
  runtime; Hermes is a separate host service and does not select the Audio
  Service Python version.

---

## 10. Konfigurasi faster-whisper

Baseline implementasi aktif setelah investigasi akurasi P5:

```text
Model         : medium multilingual
Device        : cpu
Compute type  : int8
CPU threads   : 4
Workers       : 1
Language      : auto detect (`None`)
Task          : transcribe
VAD           : aktif
Beam size     : 5
Hotwords      : BMO
```

`small` adalah baseline historis awal. Investigasi real pada 2026-07-25 memilih
`medium` + hotword `BMO` karena lebih akurat pada utterance pendek/aksen yang
diuji. P7 kemudian memverifikasi konfigurasi ini, pinned model revision, real
offline inference, dan resource soak di production. P8 revalidated the full
Piper production path and retained RVC as disabled archived work.

Target implementasi:

```python
from faster_whisper import WhisperModel

model = WhisperModel(
    "medium",
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
    hotwords="BMO",
)
```

Source evidence: [`P5-STT-ACCURACY-INVESTIGATION.md`](P5-STT-ACCURACY-INVESTIGATION.md).

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
Speed         : 0.80
Output        : WAV 24 kHz
```

Environment variable:

```env
KOKORO_LANG_CODE=a
KOKORO_VOICE=af_heart
KOKORO_SPEED=0.80
```

`KOKORO_SPEED=0.80` dipilih pada manual listening UAT dari kandidat `0.90`,
`0.85`, `0.80`, dan `0.75`, lalu diverifikasi sebagai nilai P7 production.
P8 revalidation also covers Piper fallback and recovery; RVC remains disabled.

Aturan:

- Generate satu jawaban utuh sekaligus.
- Kokoro dapat menghasilkan beberapa waveform segment dari generator internal; gabungkan seluruh segment secara berurutan menjadi satu WAV sebelum RVC/FFmpeg.
- Jangan TTS per kata atau arbitrary chunk dari backend.
- Trim whitespace.
- Plain text saja.
- Maksimal 3 kalimat pendek.
- Batas aman sekitar 600 karakter.

---

## 12. RVC Voice BMO — Archived P8 experimental boundary

RVC belum diinstal atau diverifikasi di production P8. P8 archived the community
model berikut sebagai aset eksperimental MVP, bukan model resmi yang dijamin
kualitasnya. Metadata ini tidak membuktikan real inference.

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

1. Hanya setelah explicit P8 authorization, provision revision exact ke lokasi
   RVC yang dipilih dan didokumentasikan; jangan menganggap direktori sudah ada.
2. Verifikasi byte size dan SHA256 sebelum extract.
3. Inspeksi isi archive sebelum extract.
4. Jangan menjalankan script dari archive model.
5. Hanya terima asset yang masuk akal seperti `.pth` dan opsional `.index`.
6. Siapkan dependency inference RVC yang dibutuhkan, termasuk `hubert_base.pt`
   dan `rmvpe.pt` bila pipeline yang dipilih memerlukannya; catat source,
   revision, size, dan SHA256 di manifest P8 terverifikasi.
7. Pin revision kode RVC yang lolos CPU inference.
8. Jalankan inference di audio-service container terisolasi, non-root, tanpa secret backend/Hermes.
9. Loading `.pth` berbasis PyTorch berpotensi mengeksekusi pickle. Gunakan loader aman seperti `weights_only=True` yang kompatibel; jika loader aman tidak tersedia, klasifikasikan P8 `BLOCKED`. Eksperimen compatibility yang pickle-capable memerlukan otorisasi terpisah dan sandbox disposable tanpa jaringan, host socket/device, writable host mount, atau secret; drop seluruh capability, aktifkan `no-new-privileges`/seccomp dan resource limit ketat, lalu ekspor hanya artifact non-executable yang tervalidasi secara sempit.
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

Current P8 production state with RVC disabled:

```json
{
  "status": "degraded",
  "stt_loaded": true,
  "kokoro_loaded": true,
  "rvc_available": false,
  "ffmpeg_available": true
}
```

`degraded` is readiness-healthy while mandatory STT/Kokoro/FFmpeg are ready and
optional RVC is unavailable. Gunakan `loading` selama model wajib sedang
dimuat, `ok` only when RVC is also available, dan `error` jika
STT/Kokoro/FFmpeg wajib tidak siap.

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
X-RVC-Applied: false
X-TTS-Engine: piper
```

Fallback:

```http
X-RVC-Applied: false
X-TTS-Engine: kokoro
```

---
