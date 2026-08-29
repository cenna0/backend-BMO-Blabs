# Joy Backend — Architecture and Runtime Behavior

**Version:** 3.1.0  
**Status:** CANONICAL ARCHITECTURE SPECIFICATION  

Dokumen ini menjelaskan arsitektur internal, struktur modul, state machine request, dan mekanisme streaming voice pipeline berlatensi rendah pada Joy Backend Gateway.

---

## 1. Struktur Modul Backend (`backend/src/`)

```text
backend/src/
├── config/
│   └── env.ts                      # Validasi environment variables dengan Zod
├── domain/
│   ├── request-store.ts            # State machine & deduplikasi in-memory request suara
│   └── device-state.ts             # Status perangkat & active request tracker
├── http/
│   ├── voice.route.ts              # Endpoint upload WAV (/api/v1/voice)
│   ├── audio.route.ts              # Streaming download MP3 (/audio/:id.mp3)
│   └── health.route.ts             # Health check (/livez, /readyz, /health)
├── websocket/
│   ├── websocket.server.ts         # Server WebSocket hardware ESP32 (/ws)
│   ├── device-registry.ts          # Registry koneksi socket aktif perangkat
│   └── events.ts                   # Skema Zod inbound & outbound events
├── services/
│   ├── voice-pipeline.service.ts   # Orkestrasi streaming pipeline STT -> LLM -> TTS
│   ├── hermes.client.ts            # FastVoiceLlmClient (Groq) & HermesResponsesClient
│   ├── audio-service.client.ts     # Client HTTP/Streaming ke Audio Microservice
│   ├── temp-audio.service.ts       # Manajemen MP3 sementara & LiveAudioStream
│   ├── readiness.service.ts        # Probe kesiapan sub-sistem
│   └── conversation-queue.ts       # Serialisasi antrean chat per percakapan
├── p9/                             # Modul Platform P9 (Mobile App, Auth, Memory, DB)
│   ├── db/                         # Prisma client & PostgreSQL repositories
│   ├── http/                       # P9 HTTP router (93 registered /api/v1 routes)
│   ├── services/                   # Auth, Device, Memory, Schedule, Spotify, WhatsApp
│   └── websocket/                  # Server WebSocket Mobile (/api/v1/ws)
├── utils/
│   ├── wav-validator.ts            # Validasi format byte WAV 16kHz PCM
│   └── uuid.ts                     # Generator & validator UUID v4
└── server.ts                       # Entrypoint runtime HTTP & WebSocket
```

---

## 2. Siklus Hidup Request Suara (Request Store State Machine)

RequestStore mengelola siklus hidup request suara in-memory dengan perlindungan idempotency:

```
[ Upload WAV Diterima ]
        │
        ▼ (UUID v4 dibuat & divalidasi)
  [ accepted ] ──> Mengirim WS: display_status "thinking"
        │
        ▼ (Mengirim audio ke Audio Service)
[ transcribing ] (STT: Groq Whisper / faster-whisper)
        │
        ▼ (Token LLM mulai dihasilkan)
   [ thinking ] (LLM: Hermes Core in current production)
        │
        ▼ (Sintesis kalimat pertama dimulai)
[ generating_voice ] (TTS: Edge-TTS streaming / Piper)
        │
        ▼ (MP3 siap di-stream)
  [ audio_ready ] ──> Mengirim WS: audio_ready + URL MP3
        │
        ├── ESP32 selesai memutar ──> [ completed ] (Tombstone TTL 600s)
        ├── Error di tengah jalan ───> [ failed ] (Kirim WS: request_failed)
        └── Tidak diputar > 300s ───> [ expired ] (Audio MP3 dihapus)
```

- **Idempotency**: Jika ESP32 mengunggah ulang request ID yang sama dengan payload hash identik, backend mengembalikan status yang sedang berjalan (`200 OK`) tanpa mengulang eksekusi pipeline.
- **Tombstone TTL**: Status request yang telah selesai disimpan selama 10 menit (600 detik) untuk mencegah eksekusi ganda.

---

## 3. Mekanisme Real-Time Streaming Pipeline

Untuk mencapai latensi roundtrip **~1.9s - 2.9s**, backend mengimplementasikan arsitektur streaming paralel:

```
[ Inbound WAV ]
       │
       ▼ (STT Transcribe: ~350ms)
   Text Prompt
       │
       ▼ (LLM Token Stream via FastVoiceLlmClient)
┌────────────────────────────────────────────────────────┐
│ SentenceSplitter                                       │
│  - Menerima token stream dari configured LLM provider   │
│  - Memfilter tag internal (seperti <think>...</think>) │
│  - Mendeteksi batas kalimat (. ! ? 
) atau klausa (, ;)│
└──────────────────────────┬─────────────────────────────┘
                           │ Kalimat 1 ("Halo Joy!")
                           ▼
              ┌───────────────────────────┐
              │ LiveAudioStream (Chunk 1) │ ──> Sintesis Edge-TTS Chunk 1
              └────────────┬──────────────┘
                           │ Kalimat 2 ("Ada yang bisa kubantu?")
                           ▼
              ┌───────────────────────────┐
              │ LiveAudioStream (Chunk 2) │ ──> Sintesis Edge-TTS Chunk 2
              └────────────┬──────────────┘
                           │
                           ▼
              ┌───────────────────────────┐
              │ Output MP3 Tergabung      │
              │ (Mono 24 kHz 96 kbps)     │
              └────────────┬──────────────┘
                           │
                           ▼
              [ WebSocket audio_ready ]
```

### Komponen Utama Streaming:
1. **`FastVoiceLlmClient` & Hermes Streaming**:
   Menggunakan endpoint SSE stream (`POST /v1/chat/completions` dengan `stream: true`) ke provider yang dikonfigurasi. Production saat ini menggunakan Hermes Core pada `127.0.0.1:8642`; Fast Voice provider tetap tersedia sebagai opsi.
2. **`SentenceSplitter`**:
   Mem-buffer token stream yang masuk, memfilter tag internal seperti `<think>...</think>`, dan membagi teks menjadi kalimat/klausa utuh berdasarkan batas tanda baca (`.`, `!`, `?`, `
`, `,`, `;`, `:`) secara real-time.
3. **Pipelined TTS Synthesis**:
   Setiap kalimat yang telah dipisahkan oleh `SentenceSplitter` langsung dikirim ke service TTS secara terpipanisasi tanpa menunggu LLM menyelesaikan seluruh kalimat respons.
4. **`LiveAudioStream` (`temp-audio.service.ts`) & Early `audio_ready`**:
   Menerima stream chunk audio MP3 pertama dari TTS dan seketika meng-emit event WebSocket `audio_ready` ke ESP32, memangkas Time-To-First-Audio (TTFA) menjadi **~1.7 detik**. Audio kemudian di-stream ke ESP32 menggunakan HTTP `Transfer-Encoding: chunked`.
5. **100% ESP32 Contract Compatibility**:
   Seluruh arsitektur streaming ini 100% kompatibel dengan kontrak hardware ESP32 eksisting (WSS `audio_ready`, HTTP GET `/audio/:id.mp3`, Helix MP3 decoder 32 KB buffer, `audio_playback_done`).

---

## 4. Manajemen Koneksi & Concurrency

- **Single Active Request per Device**: Setiap perangkat fisik ESP32 hanya diperbolehkan memiliki satu request suara aktif pada satu waktu. Upload baru saat request sebelumnya masih berjalan akan mengembalikan `409 DEVICE_BUSY`.
- **WebSocket Reconnect Resilience**: Jika koneksi WebSocket terputus dan tersambung kembali, payload `authenticated` akan mengembalikan `active_request_id` dan `backend_state` terakhir sehingga ESP32 dapat menyinkronkan status tanpa kehilangan respons audio.
