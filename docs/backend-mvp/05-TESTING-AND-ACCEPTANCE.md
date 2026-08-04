# BMO Backend MVP — Testing, Acceptance, and Evidence

**Versi:** 1.0.1  
**Status:** CANONICAL VERIFICATION REFERENCE

> **Status:** Canonical backend MVP documentation package  
> **Derived from:** Backend Implementation v1.0.5, Hardware Contract v1.0.5, PRD v1.2.4  
> **Scope:** Backend voice MVP only. Firmware, mobile app, Spotify, WhatsApp, PostgreSQL, dan Prisma tidak diimplementasikan dalam package ini.

> **P8 status override:** P8 production acceptance is complete with Piper
> Prudence primary, Kokoro fallback, and RVC disabled/removed from production.
> Historical RVC test rows below are preserved as evidence boundaries and must
> not be read as current production requirements. P9 application tests are
> defined in [`../p9/23-test-acceptance-matrix.md`](../p9/23-test-acceptance-matrix.md).


## Cara menggunakan file ini

File ini menentukan minimum automated test, fake ESP32 behavior, fixtures, acceptance criteria, dan laporan evidence. Tidak ada phase yang boleh diberi status `VERIFIED` hanya karena build/start berhasil.

Acceptance criteria yang belum relevan untuk phase aktif tetap dipertahankan tetapi baru wajib diselesaikan pada phase pemiliknya. Test yang relevan dengan phase aktif tidak boleh ditunda ke phase lain tanpa alasan tertulis.

## Jenis verifikasi

`BACKEND VERIFIED` berarti phase backend terbukti melalui unit test, integration test, fake ESP32, typecheck, build, dependency audit, documentation verifier, contract consistency, PRD consistency, dan scope audit lokal.

`DEPLOYMENT VERIFIED` berarti service sudah berjalan di VPS dan public HTTPS/WSS endpoint telah lulus smoke/E2E verification.

`HARDWARE INTEGRATION VERIFIED` berarti tim backend dan tim hardware sudah membuktikan flow memakai physical ESP32 terhadap endpoint deployment yang telah diverifikasi.

Physical ESP32 test dan progressive hardware playback tetap requirement final dan sekarang dimiliki P10; hal itu bukan blocker untuk P6–P9 selama public contract tidak berubah. Perubahan ini hanya memperbaiki klasifikasi verification, bukan mengurangi requirement hardware final.

## Ownership verifikasi per implementation phase

| Phase | Fokus test yang dimiliki | Tidak boleh dikerjakan lebih awal |
|---|---|---|
| P1 | HTTP/WS contract, auth, upload WAV validation, request store dasar, dummy MP3, fake ESP32 basic | STT/TTS/RVC/Hermes production integration |
| P2 | Audio Service health, model cache, faster-whisper, language/no-speech, STT failure | Kokoro/RVC dan full public pipeline |
| P3 | Kokoro, waveform merge, FFmpeg, RVC + fallback, audio metadata | Hermes/full orchestration |
| P4 | Hermes adapter, output parsing/filtering, full STT→Hermes→TTS orchestration | Deployment publik dan final benchmark |
| P5 | Reconnect, duplicate/idempotency, lifecycle, TTL, cleanup, security, failure matrix, full regression | Domain/TLS tanpa approval |
| P6 | VPS foundation, secure operations, monitoring/alerts, backup baseline | Public BMO API claim before foundation verification |
| P7 | VPS backend/audio deployment, Hermes integration, public HTTPS/WSS fake-device E2E | Physical ESP32 sign-off |
| P8 | Real RVC inference, fallback regression, CPU/RAM/latency benchmark | Hardware protocol change |
| P9 | PostgreSQL/Prisma readiness, migration, backup/restore | Moving voice request state into DB |
| P10 | Hardware handoff activation + physical ESP32 acceptance matrix | New protocol invention/workaround |

Test lintas phase boleh dibuat sebagai fixture atau test skeleton, tetapi tidak boleh memaksa implementasi phase yang belum diotorisasi.

External hardware validation P1 dipindahkan ke milestone `HW-INTEGRATION-01`. Idle WebSocket soak satu jam menjadi bagian P5 reliability verification.

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

## 30. Acceptance Criteria

Implementasi dianggap selesai jika:

- [ ] Hermes host runtime sehat dan loopback-only.
- [ ] P6 branch `PRESENT` mempertahankan instalasi yang terbukti; branch `ABSENT` menyelesaikan bootstrap/install, ownership/path/service evidence, restart, dan recovery procedure sebelum P7.
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

## 31. Laporan Akhir Wajib dari Deployment Executor

Setelah phase deployment yang relevan, executor (Codex untuk rencana VPS saat ini) membuat laporan yang berisi:

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
