# BMO Backend MVP — Scope and Locked Decisions

**Versi:** 1.0.1  
**Status:** LOCKED REFERENCE  
**Implementasi:** Belum otomatis diotorisasi

> **Status:** Canonical backend MVP documentation package  
> **Derived from:** Backend Implementation v1.0.5, Hardware Contract v1.0.5, PRD v1.2.0  
> **Scope:** Backend voice MVP only. Firmware, mobile app, Spotify, WhatsApp, PostgreSQL, dan Prisma tidak diimplementasikan dalam package ini.


## Cara menggunakan file ini

File ini menentukan batas backend MVP, keputusan yang tidak boleh diubah, baseline yang wajib dibenchmark, dan guardrail terhadap service Hermes existing. Coding agent wajib membaca file ini pada setiap phase.

Dokumen di bawah mempertahankan seluruh requirement dari Backend Implementation v1.0.5 §1–§3. Istilah “Hermes” pada bagian peran berarti agent/orchestrator yang menjalankan pekerjaan di environment VPS; source code tetap dikelola local-first sesuai execution guide.

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
