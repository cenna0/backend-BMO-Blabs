# BMO Backend MVP Documentation Package — Changelog

## 2026-07-19 — Verification classification split + P2 authorized

- Memisahkan verification menjadi `BACKEND VERIFIED`, `DEPLOYMENT VERIFIED`, dan `HARDWARE INTEGRATION VERIFIED`.
- Mengubah P1 menjadi `VERIFIED — BACKEND` berdasarkan bukti lokal: 50/50 tests, fake ESP32, typecheck, build, dependency audit, documentation verifier, contract consistency, PRD consistency, dan scope audit.
- Memindahkan physical ESP32/progressive playback ke milestone external `HW-INTEGRATION-01` dengan dependency P6 staging endpoint tersedia.
- Memindahkan idle WebSocket soak satu jam ke P5 reliability verification.
- Mengotorisasi hanya P2: Audio Service bootstrap + faster-whisper STT.
- Tidak mengubah public endpoint, WebSocket event, hardware contract, PRD locked decisions, atau scope P3–P6.

## 2026-07-19 — P1 IMPLEMENTED (not VERIFIED)

- Menambahkan Express.js + TypeScript core backend untuk health, WebSocket auth/state/heartbeat, raw WAV upload validation, in-memory request state, dan dummy MP3 hardware test mode.
- Menambahkan fake ESP32 basic, unit/integration/E2E tests, fixture MP3 24 kHz mono 96 kbps, dan phase-aware authorization verification.
- Verifikasi lokal: 10 test files / 50 tests pass; typecheck, build, dependency audit, fake ESP32 CLI, MP3 metadata, dan documentation verifier pass.
- Audit final P1: memperbaiki authorization wording menjadi `explicit user instruction in chat`, menetapkan `Started at: 2026-07-19`, dan mengonfirmasi verifier tetap menjaga SHA-256 canonical, migrasi semantik §§1–§33, locked decisions, internal path, scope, dan authorization gate.
- P1 tidak diberi status `VERIFIED` karena physical ESP32 decoder/progressive playback test dan one-hour idle soak belum dilakukan.
- Tidak mengubah keputusan locked, canonical endpoint/event/schema, atau scope P2–P6.

## 2026-07-18 — Package 1.0.1

- Menjalankan verification pass kedua secara independen.
- Memperbaiki referensi hardware contract pada file API menjadi path versioned yang benar.
- Memperkuat verification script dengan SHA-256 source copies, semantic section migration §1–§33, internal canonical path, dan control-state checks.
- Tidak mengubah keputusan locked, endpoint, event, schema, scope, atau acceptance criteria.

## 2026-07-18 — Package 1.0.0

- Memecah Backend Implementation v1.0.5 menjadi enam dokumen canonical bertopik.
- Menambahkan agent execution guide, implementation status, requirement traceability, dan verification report.
- Menetapkan nama file permanen; status tidak disimpan di nama file.
- Memisahkan status dokumentasi dari status implementasi.
- Menambahkan implementation phases P1–P6 dengan authorization gate.
- Menetapkan local-first + Git sebagai source code workflow.
- Menyalin PRD v1.2.0, Hardware Contract v1.0.5, dan backend source v1.0.5 ke lokasi referensi read-only.
- Memverifikasi seluruh source section §1–§33 termigrasi.
- Memverifikasi locked decisions terhadap PRD dan hardware contract.
- Tidak mengubah PRD, hardware contract, endpoint, event, state, baseline, atau keputusan locked.

## Source backend changelog

Berikut changelog source sebelum packaging:

## Changelog

| Versi | Perubahan |
|---|---|
| 1.0.0 | Instruksi implementasi awal |
| 1.0.1 | Seluruh instruksi diubah ke Bahasa Indonesia; runtime personality dan jawaban suara BMO tetap English |
| 1.0.2 | Memperketat isolasi Docker/secret, pin aset RVC, kompatibilitas Python, tombstone idempotency, race HTTP/WS, kontrak MP3, dan cleanup state |
| 1.0.3 | Menambah model cache persisten, idempotensi playback, deduplikasi `audio_ready`, `AUDIO_EXPIRED`, status duplicate upload yang exact, reconnect playback tests, sanitizer TTS, dan startup health grace period |
| 1.0.4 | Memisahkan keputusan locked dari baseline, mengunci empat mode display tanpa `listening`, menghapus asumsi `/v1/models`, menambah capability test/adapter Hermes, schema event/HTTP canonical agar dokumen self-contained, canonical `WEBSOCKET_NOT_CONNECTED`, state sync setelah backend restart, hash WAV untuk idempotency, public status mapping, HTTP 410 audio expired, privacy log, dan validasi sample rate RVC |
| 1.0.5 | Audit ulang terhadap seluruh percakapan dan audit API Hermes: mengunci raw WAV tanpa multipart serta rekaman 2,5/60 detik, memulihkan payload `/v1/responses` terverifikasi (`conversation`, `store`, `stream`, `truncation`), menambah close code WebSocket, menghapus larangan tools global yang tidak pernah disepakati, menegaskan tidak ada `audio_ready_received`, menghapus retry count milik backend, memperbaiki command FFmpeg agar sample rate benar-benar diterapkan, menegaskan internal token kedua service harus sama, dan menyelaraskan periodic/startup cleanup dengan TTL MP3 5 menit |
