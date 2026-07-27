# BMO Backend MVP — Requirement Traceability (Historical Migration Baseline)

**Versi:** 1.0.1  
**Status:** HISTORICAL VERIFIED BASELINE

## 1. Tujuan

Matrix ini membuktikan bahwa seluruh top-level requirement Backend Implementation v1.0.5 §1–§33 memiliki target primary dalam package baru. Dokumen sumber disimpan sebagai arsip read-only di `../archive/BMO-MVP-BACKEND-IMPLEMENTATION-FOR-HERMES-v1.0.5.md`.

> **2026-07-26 note:** this matrix proves the original v1.0.5 documentation migration. Active deployment details in `06-DEPLOYMENT-AND-OPERATIONS.md` have since been intentionally updated for the current `/opt/bmo`, Caddy, domain, monitoring, backup, and P6–P10 plan. Public hardware protocol authority remains unchanged.

## 2. Backend source migration matrix

| Source | Judul sumber | Target primary | Status |
|---|---|---|---|
| §1 | Peran Hermes | `01-SCOPE-AND-DECISIONS.md` | MIGRATED |
| §2 | Scope Ketat MVP | `01-SCOPE-AND-DECISIONS.md` | MIGRATED |
| §3 | Hermes Existing Service — Jangan Dirusak | `01-SCOPE-AND-DECISIONS.md` | MIGRATED |
| §4 | Arsitektur Deployment | `06-DEPLOYMENT-AND-OPERATIONS.md` | MIGRATED |
| §5 | Struktur Filesystem | `06-DEPLOYMENT-AND-OPERATIONS.md` | MIGRATED |
| §6 | Preflight Audit | `06-DEPLOYMENT-AND-OPERATIONS.md` | MIGRATED |
| §7 | Struktur Project yang Disarankan | `03-BACKEND-ARCHITECTURE.md` | MIGRATED |
| §8 | Teknologi Backend | `03-BACKEND-ARCHITECTURE.md` | MIGRATED |
| §9 | Teknologi Audio Service | `04-AUDIO-SERVICE.md` | MIGRATED |
| §10 | Konfigurasi faster-whisper | `04-AUDIO-SERVICE.md` | MIGRATED |
| §11 | Konfigurasi Kokoro | `04-AUDIO-SERVICE.md` | MIGRATED |
| §12 | RVC Voice BMO | `04-AUDIO-SERVICE.md` | MIGRATED |
| §13 | Output FFmpeg | `04-AUDIO-SERVICE.md` | MIGRATED |
| §14 | API Internal Audio Service | `04-AUDIO-SERVICE.md` | MIGRATED |
| §15 | Public Backend API | `02-API-AND-WEBSOCKET-CONTRACT.md` | MIGRATED |
| §16 | Persyaratan WebSocket | `02-API-AND-WEBSOCKET-CONTRACT.md` | MIGRATED |
| §17 | Persyaratan Upload Voice | `02-API-AND-WEBSOCKET-CONTRACT.md` | MIGRATED |
| §18 | State In-Memory | `03-BACKEND-ARCHITECTURE.md` | MIGRATED |
| §19 | Pipeline End-to-End | `03-BACKEND-ARCHITECTURE.md` | MIGRATED |
| §20 | Kontrak Hermes API | `03-BACKEND-ARCHITECTURE.md` | MIGRATED |
| §21 | Timeout Pipeline | `03-BACKEND-ARCHITECTURE.md` | MIGRATED |
| §22 | Mapping Error | `02-API-AND-WEBSOCKET-CONTRACT.md` | MIGRATED |
| §23 | Lifecycle File Sementara | `03-BACKEND-ARCHITECTURE.md` | MIGRATED |
| §24 | Security | `03-BACKEND-ARCHITECTURE.md` | MIGRATED |
| §25 | Docker Compose | `06-DEPLOYMENT-AND-OPERATIONS.md` | MIGRATED |
| §26 | Environment Variables | `06-DEPLOYMENT-AND-OPERATIONS.md` | MIGRATED |
| §27 | Testing Wajib | `05-TESTING-AND-ACCEPTANCE.md` | MIGRATED |
| §28 | Mode Early Test untuk Tim Hardware | `06-DEPLOYMENT-AND-OPERATIONS.md` | MIGRATED |
| §29 | Tahapan Deployment | `06-DEPLOYMENT-AND-OPERATIONS.md` | MIGRATED |
| §30 | Acceptance Criteria | `05-TESTING-AND-ACCEPTANCE.md` | MIGRATED |
| §31 | Laporan Akhir Wajib dari Hermes | `05-TESTING-AND-ACCEPTANCE.md` | MIGRATED |
| §32 | Urutan Eksekusi | `06-DEPLOYMENT-AND-OPERATIONS.md` | MIGRATED |
| §33 | Hal yang Harus Ditanyakan Sebelum Tindakan Berisiko | `06-DEPLOYMENT-AND-OPERATIONS.md` | MIGRATED |

## 3. Cross-reference PRD v1.2.4

| PRD section | Requirement yang diverifikasi | Target package | Hasil |
|---|---|---|---|
| §1.3 | Voice MVP: WAV → STT → Hermes → Kokoro/RVC → MP3 → WS URL | 01, 03, 04 | MATCH |
| §3.1 | Express TS, FastAPI, faster-whisper, Kokoro, RVC, FFmpeg, in-memory state | 01, 03, 04, 06 | MATCH |
| §4.2 | Tanggung jawab Express, Hermes, Audio Service | 01, 03, 04 | MATCH |
| §5 | 27-step voice pipeline | 02, 03, 04 | MATCH |
| §5.1–§5.7 | WAV format, language, output, lifecycle, idempotency, error behavior | 01–04 | MATCH |
| §8.1/§8.3 | Display hanya idle/thinking/speaking/error; backend hanya thinking | 01, 02 | MATCH |
| §9 | Endpoint/event/protocol SW ↔ HW | 02 | MATCH |
| §10 | Hermes `/v1/responses`, payload dan runtime instructions | 03 | MATCH |
| §13 | Personality, output English, plain text, Kokoro→RVC | 01, 03, 04 | MATCH |
| §14 | VPS layout, env, staging stages | 06 | MATCH |
| §15.3 | Sprint 2 SW scope | 01, 05, 06 | MATCH |
| §16/§16.1 | Locked decisions dan benchmarkable baseline | 01, 04, 06 | MATCH |
| §17 | Open items yang masih perlu benchmark/test | 04, 05, 06 | MATCH |
| §18 | Authority hierarchy | 00, 02 | MATCH |

## 4. Cross-reference hardware contract v1.0.5

| Contract area | Backend obligation | Target package | Hasil |
|---|---|---|---|
| §3–§4 | Device identity, WS auth, duplicate connection, heartbeat | 02 | MATCH |
| §5 | Display ownership dan input WAV expectation | 01, 02 | MATCH |
| §6 | Raw WAV upload, headers, status, retries/idempotency | 02 | MATCH |
| §7 | `audio_ready`, MP3 GET, playback completion/failure | 02, 03 | MATCH |
| §8 | `request_failed` codes dan recoverability | 02 | MATCH |
| §9 | Reconnect state sync dan pending event resend | 02, 03 | MATCH |
| §10 | Satu request aktif per device | 01, 03 | MATCH |
| §14 | Canonical endpoint dan event set | 02 | MATCH |

## 5. Locked-decision checklist

| Decision | Package location | Verified |
|---|---|---|
| Raw WAV utuh via HTTP `audio/wav`, bukan multipart/chunk WS | 01, 02 | YES |
| Rekaman 2,5 detik silence / 60 detik hard limit | 01, 02 | YES |
| WAV PCM signed 16-bit LE, 16 kHz, mono | 01, 02 | YES |
| WS aktif dan authenticated sebelum upload | 01, 02 | YES |
| UUID v4 dari ESP32 sebagai idempotency key | 01, 02 | YES |
| State voice request in-memory | 01, 03 | YES |
| STT auto-detect ID/EN/mixed | 01, 04 | YES |
| BMO output selalu English, plain text, singkat | 01, 03, 04 | YES |
| Kokoro + RVC dengan fallback Kokoro-only | 01, 04 | YES |
| MP3 URL via WS, bytes via HTTP GET | 01, 02 | YES |
| Display modes hanya idle/thinking/speaking/error | 01, 02 | YES |
| Backend hanya mengirim thinking | 01, 02 | YES |
| Download retry satu kali dari awal, tanpa Range | 01, 02 | YES |
| WAV/MP3 lifecycle dan TTL 300 detik | 01, 03 | YES |
| Error audio lokal dimainkan firmware | 01, 02 | YES |
| Tidak ada PostgreSQL/Prisma pada voice MVP | 00, 01 | YES |
| Tidak ada firmware/mobile/Spotify/WhatsApp implementation | 00, 01 | YES |

## 6. Requirement ownership rule

- Target `primary` adalah tempat requirement dijelaskan lengkap.
- Cross-reference atau ringkasan boleh muncul di file lain untuk menjaga konteks.
- Perubahan public contract wajib dimulai dari hardware contract dan membutuhkan approval user.
- Perubahan implementation detail wajib memperbarui target primary, traceability, verification report, dan changelog.
