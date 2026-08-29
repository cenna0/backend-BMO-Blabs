# Joy Audio Microservice — Architecture & Specifications

**Service Name:** `joy-audio`  
**Runtime:** `Python 3.10 / 3.12 + FastAPI + Uvicorn + Tini`  
**Host/Port:** `127.0.0.1:8001` (host publication; service binds `0.0.0.0` in container)  
**Status:** `PRODUCTION_VERIFIED`  
**Container:** `joy-production-audio-1`

Layanan Audio Microservice bertanggung jawab atas inferensi Speech-to-Text (STT), sintesis vokal Text-to-Speech (TTS), streaming chunking audio, dan transcoding format audio (WAV ke MP3).

---

## 1. Arsitektur Komponen

```text
                     ┌───────────────────────────────────────────────┐
                     │   Joy Backend Gateway (127.0.0.1:3000)        │
                     └───────────────────────┬───────────────────────┘
                                             │ HTTP Internal (Port 8001)
                                             ▼ Header: X-Internal-Token
┌────────────────────────────────────────────────────────────────────────────────────┐
│                             Joy Audio Service (FastAPI)                            │
├─────────────────────────────────────────┬──────────────────────────────────────────┤
│           STT Transcriber               │             TTS Synthesizer              │
├─────────────────────────────────────────┼──────────────────────────────────────────┤
│ 1. Primary: Cloud Groq Whisper API      │ 1. Primary: Cloud Edge-TTS Streaming     │
│    Model: whisper-large-v3-turbo        │    Voice: en-US-AnaNeural              │
│    Latensi: ~350 - 430 ms               │    Pitch: +10%, Rate: +5%, Volume: +50%  │
│                                         │    Latensi TTFA: ~1.1 - 1.3 s            │
│ 2. Fallback: Local faster-whisper (CPU) │ 2. Fallback: Local Piper TTS             │
│    Model: Systran/faster-whisper-base            │    Model: en_GB-semaine-medium           │
│    Compute: int8, VAD filter enabled    │    Speaker: prudence (ID: 0)             │
│    Hotwords: "Joy, hey Joy, hi Joy"              │                                          │
├─────────────────────────────────────────┴──────────────────────────────────────────┤
│                        FFmpeg Audio Transcoder & Normalizer                        │
│                   Format: MPEG-1 Audio Layer III (MP3), 24 kHz Mono                │
└────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Speech-to-Text (STT) Subsystem

### 2.1 Engine Transkripsi
1. **Primary: Groq Whisper API**:
   - Endpoint: `https://api.groq.com/openai/v1/audio/transcriptions`
   - Model: `whisper-large-v3-turbo`
   - Language: configured production `en`
   - Latensi rata-rata: **~350 ms – 430 ms**
2. **Fallback: Local faster-whisper (CPU)**:
   - Model: `Systran/faster-whisper-base`
   - Compute Type: `int8` (dioptimalkan untuk multi-core CPU)
   - VAD Filter: Aktif (memotong silence / background noise)
   - Beam Size: `1`
   - Hotwords: "Joy, hey Joy, hi Joy"

### 2.2 Endpoint Transkripsi (`POST /stt/transcribe`)
- **Headers**:
  ```http
  X-Internal-Token: <INTERNAL_SERVICE_TOKEN>
  Content-Type: audio/wav
  ```
- **Body**: Binary WAV PCM (16 kHz, 16-bit Mono).
- **Response 200**:
  ```json
  {
    "text": "Halo Joy apa kabar kamu hari ini",
    "speech_detected": true,
    "language": "en",
    "language_probability": 0.99,
    "duration_seconds": 2.45
  }
  ```
- **Error Codes**:
  - `415`: `UNSUPPORTED_AUDIO_TYPE` jika header bukan `audio/wav`.
  - `422`: `INVALID_AUDIO_FORMAT` jika payload WAV rusak/tidak valid.

---

## 3. Text-to-Speech (TTS) Subsystem

### 3.1 Engine Sintesis Suara
1. **Primary: Microsoft Edge-TTS Streaming**:
   - Voice: `en-US-AnaNeural` (Suara ceria, ramah, dan khas karakter Joy)
   - Pitch: `+10%` (disesuaikan ke format Hz secara internal)
   - Rate (Kecepatan): `+5%`
   - Volume: `+50%`
   - Dukungan: Batch MP3 & Chunked HTTP Streaming (`/tts/synthesize-stream`)
2. **Fallback: Piper TTS (Local Offline)**:
   - Model: `en_GB-semaine-medium`
   - Speaker: `prudence` (ID: 0)
   - Eksekusi: Inferensi ONNX runtime lokal + normalisasi FFmpeg.

### 3.2 Endpoint Sintesis Batch (`POST /tts/synthesize`)
- **Headers**:
  ```http
  X-Internal-Token: <INTERNAL_SERVICE_TOKEN>
  Content-Type: application/json
  ```
- **Body**:
  ```json
  {
    "text": "Halo! Senang sekali bisa ngobrol sama kamu lagi."
  }
  ```
- **Response 200**: Binary Audio MP3 (`audio/mpeg`), dengan header `X-TTS-Engine: edge-tts` atau `X-TTS-Engine: piper`.
- **Validasi Teks**:
  - Maksimal 600 karakter.
  - Maksimal 3 kalimat per giliran.
  - Karakter Markdown/HTML/kontrol ditolak (`422 INVALID_TTS_TEXT`).

### 3.3 Endpoint Sintesis Streaming (`POST /tts/synthesize-stream`)
- **Headers**: Same as batch synthesis.
- **Response 200**: Streaming Chunked Response (`Transfer-Encoding: chunked`, `Content-Type: audio/mpeg`).

---

## 4. Keamanan & Health Checks

- **Autentikasi Internal**: Semua endpoint STT dan TTS dilindungi oleh header `X-Internal-Token`. Token wajib memiliki panjang minimal 16 karakter.
- **Liveness Probe (`GET /livez`)**: Mengembalikan `{"status": "ok"}` jika service running.
- **Readiness Probe (`GET /readyz` / `GET /health`)**:
  - Memverifikasi kesiapan model Piper / Edge-TTS engine, FFmpeg binary, dan transcriber.
  - Mengembalikan `200 OK` jika siap atau `503 Service Unavailable` jika ada dependensi gagal.
