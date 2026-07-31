# BMO Backend MVP — Changelog

> Entries under **Historical package changelog** preserve the phase ownership/runtime facts as they were recorded at that time. They are evidence, not current next-step authority. Use `../NEXT-ACTION.md` and `IMPLEMENTATION-STATUS.md` for current ownership.

## 2026-07-31 — P7 VERIFIED — PRODUCTION / P8 handoff

- Closed P7 as `VERIFIED — PRODUCTION` from deployment source
  `4d7b472adc4c2243d8f7364032a491ad70efb6d3`.
- Recorded immutable running images
  `bmo-backend@sha256:e981751498fca13bf1f1c1c046a6874a490b3e681aeef9787a53181059506fd7`
  and
  `bmo-audio@sha256:62d8b48feb978e303831e20dc558cb95d3240af9a3cf09e8dcd0c82142986e7e`.
- Public fake-ESP32 acceptance passed `23/23`; the final 3,665-second / 61m 5s
  production soak passed `13/13` samples with zero new OOM and zero
  backend/audio restarts.
- Marked the hardware deployment handoff `VERIFIED`, making the live public
  HTTPS/WSS endpoint available for firmware integration without claiming
  physical ESP32 acceptance.
- Preserved Kokoro-only production behavior with `RVC_ENABLED=false`; real RVC
  remains unverified and P8 becomes the next phase, still awaiting explicit
  user authorization.
- Kept physical ESP32 verification in P10 and PostgreSQL/Prisma in P9 after
  P8; neither was implemented or verified by P7 closure.

## 2026-07-26 — Final execution-readiness audit

- Reconciled P6 authorization semantics so one explicit `execute P6` instruction covers the planned non-destructive P6 installs/configuration while destructive/unexpected actions still require separate approval.
- Locked Caddy as a host system service and Beszel infrastructure Compose path as `/opt/bmo/deploy/infra-compose.yml`.
- Clarified secret env ownership/readability for `bmo-admin`, postponed `DATABASE_URL`/real `postgres.env` activation to P9, and required commit-SHA image tags for deterministic rollback.
- Added ESP32 production TLS prerequisite: trusted device time plus certificate-chain validation.

## 2026-07-26 — Next-action/P6 execution handoff

- Added root `NEXT-ACTION.md` as the operational entry point for Codex.
- Added `roadmap/P6-EXECUTION-SPEC.md` with exact P6 tasks, acceptance criteria, authorization boundary, evidence, and stop condition.
- Marked P6 as `READY` and the explicit current next phase; P7–P10 remain dependency-gated.
- Locked phase-by-phase execution so the agent stops after each verified phase instead of collapsing P6–P10 into one context.
- Clarified that P6 authorization covers the already-selected non-destructive infrastructure setup but never authorizes destructive changes or Hermes migration.

## 2026-07-26 — Documentation audit + hardware handoff pack

- Added `docs/README.md` as the documentation entry point and authority map.
- Added complete `docs/hardware-handoff/` pack for humans and firmware coding agents.
- Added explicit `DEPLOYMENT_STATUS: NOT_VERIFIED` gate so the agreed production domain is not misrepresented as already live.
- Added current backend capability/status matrix and 34 physical ESP32 acceptance tests.
- Updated active STT implementation reference from historical `small` baseline to selected `medium` + hotword `BMO` based on P5 accuracy evidence.
- Reworked deployment target around `/opt/bmo`, Git `main` production source, Docker image runtime, external config/secrets, Caddy, Tailscale admin access, Beszel + Telegram alerts, backup/restore, rollback, RVC ownership, PostgreSQL readiness, and hardware handoff gate.
- Split future deployment work into dependency-based P6–P10 roadmap.
- Marked old static P1/P5 phase markers and the 2026-07-18 verification report as historical where appropriate.
- Removed non-authoritative `docs/superpowers/` planning material from final handoff package because it referenced uncreated handoff files/scripts and was not intended as protocol authority.
- Canonical Hardware Contract v1.0.5, PRD v1.2.0, and archived Backend Implementation v1.0.5 were preserved byte-for-byte.

## Historical package changelog

## 2026-07-19 — P5 VERIFIED — BACKEND

- Mengotorisasi hanya P5, mengubah active phase menjadi `P5`, dan menjaga P6 tetap `NOT AUTHORIZED`.
- Mempertahankan P1 sebagai `VERIFIED — BACKEND`, P2 sebagai `VERIFIED — LOCAL FUNCTIONAL`, P3 sebagai `IMPLEMENTED — not VERIFIED`, `P3-RVC-VERIFICATION` sebagai `DEFERRED`, dan P4 sebagai `VERIFIED — LOCAL FUNCTIONAL`.
- Menambahkan idempotency berbasis request ID/body SHA-256, duplicate conflict handling, public duplicate status mapping, tombstone retention, bounded request GC, MP3 TTL expiry, `410 AUDIO_EXPIRED`, startup cleanup, playback done/failed idempotency, stage-specific timeout mapping, total-timeout cancellation, production secret guard, heartbeat instrumentation, fake ESP32 self-host mode, dan one-hour idle WebSocket soak script.
- Menambahkan P5 targeted tests untuk idempotency, request store GC, TTL/temp cleanup, playback lifecycle, timeout/failure matrix, dan security; backend full suite kini 21 files / 99 tests passed, P5 targeted 7 files / 29 tests passed, audio-service 48 tests passed.
- Menjalankan one-hour idle WebSocket soak 3,600,004 ms dengan ping/pong 59/59, memory RSS 89,092,096 → 56,586,240 bytes, tanpa disconnect/reconnect/crash/unhandled rejection.
- Membuktikan post-soak full local pipeline dengan real faster-whisper, Hermes-compatible fixture, real Kokoro/FFmpeg, fake ESP32, dan MP3 ffprobe.
- Tidak mengubah PRD, hardware contract, public endpoint, WebSocket event set, firmware, deployment VPS, Spotify, WhatsApp, database, mobile app, atau P6.

## 2026-07-19 — P4 VERIFIED — LOCAL FUNCTIONAL

- Mengotorisasi hanya P4 dan menjaga P5–P6 tetap `NOT AUTHORIZED`.
- Mempertahankan P3 sebagai `IMPLEMENTED — not VERIFIED` dan menambahkan milestone `P3-RVC-VERIFICATION` untuk real RVC inference terpisah.
- Menambahkan backend Audio Service client, Hermes `/v1/responses` adapter, parser aman Responses-style, sanitizer output, provider-error detection, chat-completions fallback adapter terdokumentasi, dan serialization per conversation.
- Mengaktifkan orchestration lokal setelah HTTP 202: raw WAV → STT → Hermes → TTS → temp MP3 → `audio_ready` → playback completion.
- Membuktikan full pipeline lokal dengan Hermes-compatible fixture, real faster-whisper, real Kokoro, real FFmpeg, fake ESP32, dan MP3 ffprobe.
- Membuktikan full pipeline lokal tambahan memakai Hermes Agent lokal v0.16.0 (`hermes-agent` via `/v1/responses`), tanpa mengubah global Hermes config atau `SOUL.md`.
- P4 dinaikkan menjadi `VERIFIED — LOCAL FUNCTIONAL`; real Hermes VPS integration dan benchmark tetap scope P6.
- Real RVC inference tetap deferred ke `P3-RVC-VERIFICATION`; Kokoro-only fallback tetap digunakan saat RVC runtime unavailable.
- Tidak mengubah PRD, hardware contract, public endpoint, WebSocket event set, firmware, deployment, Spotify, WhatsApp, database, mobile app, atau P5–P6.

## 2026-07-19 — P3 IMPLEMENTED (not VERIFIED)

- Mengotorisasi hanya P3 dan mengubah active phase menjadi `P3`; P4–P6 tetap `NOT AUTHORIZED`.
- Menambahkan Kokoro English TTS `af_heart`, validasi teks, merge seluruh waveform segment ke satu WAV, FFmpeg MP3 mono 24 kHz 96 kbps, dan internal `POST /tts/synthesize`.
- Menambahkan header hasil `Content-Type: audio/mpeg`, `X-RVC-Applied`, dan `X-TTS-Engine`.
- Menambahkan safe RVC bootstrap untuk model `Freaky98/CGO-adventure-time-BMO-rvc-v2-420e` revision `82a8bc529bd41b930589188ead30f073d4f99fc0`, termasuk verifikasi size/SHA-256 sebelum extract dan extract hanya `.pth`/`.index`.
- Menambahkan fallback Kokoro-only ketika RVC unavailable/gagal, plus cleanup intermediate files melalui `finally`.
- Real Kokoro + real FFmpeg + forced RVC fallback terbukti lokal; real RVC inference belum terbukti karena runtime/CLI `rvc infer` belum tersedia.
- P3 tetap `IMPLEMENTED — not VERIFIED`; tidak mengerjakan Express backend integration, Hermes integration, deployment VPS, firmware/hardware, public backend interface change, atau P4–P6.

## 2026-07-19 — P2 VERIFIED — LOCAL FUNCTIONAL

- Membuktikan real faster-whisper inference memakai `small` multilingual, CPU, `int8`, language auto-detect, task `transcribe`, VAD enabled, dan beam size 5.
- Menggunakan model `Systran/faster-whisper-small` revision `536b0662742c02347bc0e980a01041f333bce120`; `small.en` tidak digunakan.
- Menambahkan evidence fixtures English, Indonesian, mixed Indonesian-English, silence, dan noise melalui endpoint `/stt/transcribe` dengan real `FasterWhisperTranscriber`.
- Membuktikan run kedua memakai cache lokal `audio-service/models/` tanpa download ulang; model/cache/audio/result artifacts tetap ignored dan tidak masuk Git.
- Menambahkan verification-only real inference runner dan model manifest metadata.
- P2 dinaikkan menjadi `VERIFIED — LOCAL FUNCTIONAL`; benchmark latency/resource pada VPS belum dilakukan dan tetap scope P6.
- Tidak mengotorisasi atau mengerjakan Kokoro, RVC, Hermes integration, deployment VPS, firmware/hardware, public backend interface change, atau P3–P6.

## 2026-07-19 — P2 IMPLEMENTED (not VERIFIED)

- Menambahkan FastAPI Audio Service bootstrap untuk `/health` dan `/stt/transcribe`.
- Menambahkan environment validation, internal service-token authentication, WAV validation, STT response schema, no-speech normalization, dan model cache/bootstrap dry-run.
- Menambahkan `FasterWhisperTranscriber` adapter untuk faster-whisper `small` multilingual CPU INT8 dengan language auto-detect, VAD, dan beam size 5.
- Menambahkan P2 unit/integration tests dengan deterministic fake transcriber untuk English, Indonesian, mixed-language, dan no-speech cases.
- P2 tidak diberi status `VERIFIED` karena real faster-whisper model inference belum dijalankan.
- Tidak mengerjakan Kokoro, RVC, FFmpeg TTS pipeline, Hermes integration, VPS deployment, firmware/hardware, atau P3–P6.

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
