# BMO Backend MVP — Scope and Locked Decisions

**Versi:** 1.0.1  
**Status:** LOCKED REFERENCE  
**Implementasi:** Belum otomatis diotorisasi

> **Status:** Canonical backend MVP documentation package  
> **Derived from:** Backend Implementation v1.0.5, Hardware Contract v1.0.5, PRD v1.2.4  
> **Scope:** Backend voice MVP only. Firmware, mobile app, Spotify, WhatsApp, PostgreSQL, dan Prisma tidak diimplementasikan dalam package ini.

> **P8 current-runtime override:** Production TTS is Piper `en_GB-semaine-medium`
> Prudence speaker `0`, with Kokoro `af_heart` at `0.80` as fallback. RVC is
> disabled and removed from production; RVC references below are historical
> voice-MVP design/evidence, not a current production claim. P9 architecture
> and future application ownership are defined in [`../p9/README.md`](../p9/README.md).


## Cara menggunakan file ini

File ini menentukan batas backend MVP, keputusan yang tidak boleh diubah, baseline yang wajib dibenchmark, dan guardrail terhadap Hermes host runtime. Coding agent wajib membaca file ini pada setiap phase.

Dokumen awal v1.0.5 menggunakan istilah Hermes sebagai agent/orchestrator implementasi. **Model operasional project saat ini telah diklarifikasi:** Codex adalah coding/infrastructure executor untuk P6 dan phase implementasi berikutnya, sedangkan Hermes adalah host runtime service/dependency BMO. P6 mempertahankan instalasi yang ada atau melakukan initial bootstrap jika preflight membuktikan Hermes tidak ada. Referensi historical P1–P5 yang menyebut Hermes sebagai executor tidak mengubah ownership saat ini.

## 1. Peran Codex dan Hermes

### Codex — implementation/infrastructure executor

Saat phase telah diotorisasi, Codex bertugas:

1. Melakukan audit environment tanpa merusak service existing.
2. Membuat/mengubah backend, Audio Service, test, deployment, dan dokumentasi sesuai scope phase aktif.
3. Menjalankan test, smoke test, benchmark, deployment, dan verification loop yang diwajibkan phase.
4. Menjaga Git sebagai source of truth dan mencegah drift VPS.
5. Menghasilkan evidence sebelum menyatakan phase selesai.
6. Berhenti pada boundary phase dan tidak mengerjakan phase berikutnya tanpa authorization.

Codex adalah tooling/operator. BMO tidak boleh bergantung pada Codex untuk runtime normal.

### Hermes — runtime service BMO

Hermes:

- tetap berjalan langsung sebagai host runtime, bukan container;
- diaudit dan dipertahankan jika ditemukan pada preflight P6;
- di-bootstrap oleh P6 jika preflight membuktikan belum terpasang;
- menerima transcript dari backend melalui API lokal;
- menghasilkan jawaban BMO;
- menjaga personality/context/memory/capability runtime;
- merupakan dependency yang harus tetap sehat selama perubahan infrastructure/backend.

Hermes **bukan executor P6**, tidak dipindahkan ke Docker, dan instalasi yang sudah bekerja tidak dimigrasikan ke user/path baru hanya untuk merapikan arsitektur.

Jangan hanya membuat scaffold. Hasil implementasi phase yang diotorisasi harus benar-benar berjalan dan memiliki evidence.

---

## 2. Scope Ketat MVP

Implementasikan hanya:

```text
ESP32 upload satu WAV utuh
→ faster-whisper STT
→ Hermes menghasilkan jawaban teks English
→ Piper Prudence primary TTS
→ Kokoro fallback bila Piper gagal
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
- Piper Prudence primary dengan fallback Kokoro-only; RVC production disabled;
- MP3 dikirim sebagai URL dan diambil melalui HTTP;
- mode display MVP hanya `idle`, `thinking`, `speaking`, dan `error`; backend hanya mengirim `thinking`;
- retry download MP3 satu kali dari awal;
- WAV dihapus setelah output MP3 selesai; MP3 dihapus setelah playback selesai/gagal atau TTL;
- error diekspresikan oleh hardware dengan audio error lokal.

**Verified P7 production runtime baseline:**

- faster-whisper `medium` multilingual, CPU INT8, 4 threads, 1 worker, beam size 5, VAD aktif, language auto-detect, hotword `BMO`;
- Kokoro `af_heart` dengan `KOKORO_SPEED=0.80`.

**Baseline teknis lain yang masih boleh disesuaikan setelah benchmark:**

- MP3 mono 24 kHz/96 kbps;
- timeout per tahap;
- retry upload maksimal dua kali setelah percobaan awal;
- batas upload 3 MB;
- tombstone 10 menit;
- historical RVC parameters are retained only in archived evidence;
- Node.js 22, Python 3.10, Zod/Pino/Vitest sebagai pilihan implementasi awal.

Implementation executor boleh menyesuaikan baseline teknis hanya setelah test/benchmark dan wajib mencatat alasan serta dampaknya. Keputusan locked atau kontrak event/endpoint tidak boleh diubah tanpa approval user.

Guardrail seperti `backend_state`, body SHA-256, tombstone request, public status mapping, dan HTTP `410 AUDIO_EXPIRED` ditambahkan untuk menutup edge case implementasi. Guardrail ini bukan perubahan produk dan tetap wajib diimplementasikan selama tidak terbukti bermasalah pada test hardware.

---

## 3. Hermes Host Service — Preserve If Present, Bootstrap If Absent

Target host API Hermes:

```text
Base URL : http://127.0.0.1:8642
Endpoint : POST /v1/responses
Model    : hermes-agent
Auth     : Bearer API key
```

Aturan wajib:

- Jangan memindahkan Hermes ke Docker.
- **Hermes present:** audit dan pertahankan actual user, install/config/data path, startup/service mechanism, serta runtime yang sudah terbukti; jangan reinstall/migrate untuk kebersihan.
- **Hermes absent:** P6 melakukan initial host-runtime bootstrap, menentukan ownership sesuai installation/runtime model aktual, dan mencatat path/startup/recovery evidence.
- Jangan membuat dedicated Linux user Hermes hanya karena nama service; buat hanya jika model instalasi atau kebutuhan security/operational yang terbukti memang memerlukannya.
- Jangan expose port `8642` ke internet.
- Jangan mencetak API key aktif ke log atau laporan.
- Jangan mengubah global `SOUL.md` tanpa persetujuan user.
- Backend wajib mengirim personality/instructions BMO pada setiap request.

Evidence local historical yang diberikan user sudah memverifikasi `/v1/responses`, `/v1/chat/completions`, dan `/v1/models`. Evidence tersebut tidak membuktikan instalasi production VPS. Model pada body saat ini hanya label/cosmetic; model LLM aktual tetap ditentukan konfigurasi Hermes. Karena itu `/v1/models` boleh dipakai untuk diagnosis, tetapi jangan dijadikan dependency runtime backend.

P6 membuktikan health, listener `127.0.0.1:8642`, startup/restart, dan recovery
procedure untuk branch present maupun absent. P7 kemudian menyelesaikan
smoke/integration test production backend ke `/v1/responses` dengan
`stream:false` dan adapter Responses-style yang telah terbukti, dengan evidence
yang disanitasi. `/v1/chat/completions` tetap hanya menjadi fallback jika
`/v1/responses` benar-benar gagal atau berubah tidak kompatibel.

---
