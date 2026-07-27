# P1 — Core Backend Transport & Hardware Test Mode Evidence

> **HISTORICAL PHASE RECORD — NOT A CURRENT EXECUTION INSTRUCTION.** This file records the P1–P5 state/ownership at the time it was written. References to “P6” or old runtime defaults inside this record are historical. For current execution order and ownership, use `../NEXT-ACTION.md`, `IMPLEMENTATION-STATUS.md`, and `../roadmap/P6-P10-ROADMAP.md`.

**Date:** 2026-07-19  
**Status:** VERIFIED — BACKEND  
**External hardware validation:** DEFERRED  
**Authorization:** P1 only, explicit user instruction

## Verification classification

P1 is `VERIFIED — BACKEND` because local backend evidence is complete: unit tests, integration tests, fake ESP32, typecheck, build, dependency audit, documentation verifier, contract consistency, PRD consistency, and scope audit passed.

Physical ESP32 decoder/playback remains a final hardware requirement, but it is external integration evidence. It moved to `HW-INTEGRATION-01` and is not claimed here.

## Scope delivered

- Express.js + TypeScript strict backend.
- `GET /health`, `WS /ws`, `POST /api/v1/voice`, `GET /audio/:audioId.mp3`.
- JSON-message WebSocket auth, close codes `4001/4003/4008`, latest connection wins, native heartbeat, state sync.
- Raw WAV validation: required headers, device credentials, active WS checked twice, UUID v4, 3 MB, RIFF PCM signed 16-bit LE, 16 kHz, mono, maximum 60 seconds.
- One active request per device using in-memory state.
- Hardware test mode disabled by default and prohibited with `NODE_ENV=production`.
- Hardware test flow: thinking event → dummy MP3 UUID URL → streamed HTTP response → playback done/failed cleanup.
- Fake ESP32 basic flow and HTTP/WS observation-order coordinator.

No Audio Service, faster-whisper, Hermes integration, Kokoro, RVC runtime, FFmpeg pipeline, VPS deployment, firmware, mobile app, Spotify, WhatsApp, PostgreSQL, or Prisma was implemented in P1.

## Acceptance evidence

| ID | Evidence | Result |
|---|---|---|
| P1-AC-01 | `/health` integration test; CLI health returned backend `ok` with future services explicitly `bypassed` | PASS |
| P1-AC-02 | Env tests prove test mode defaults false and production + test mode is rejected | PASS |
| P1-AC-03 | WS integration tests prove message auth and exact `4001/4003/4008` conditions | PASS |
| P1-AC-04 | Replacement and accelerated native ping/pong/missed-pong tests | PASS automated; one-hour soak moved to P5 reliability verification |
| P1-AC-05 | Idle/thinking/audio-ready auth state tests; source/event types expose backend display status only `thinking` | PASS |
| P1-AC-06 | Upload tests cover missing headers, credentials, UUID, content type, >3 MB, invalid WAV metadata, missing/mid-upload WS | PASS |
| P1-AC-07 | Request-store and HTTP tests prove `DEVICE_BUSY` for second active request | PASS |
| P1-AC-08 | HTTP 202 + correlated thinking integration; coordinator tests both HTTP→WS and WS→HTTP observation order | PASS |
| P1-AC-09 | Dummy MP3 copy, `audio_ready`, UUID route, content type/length/cache headers, unknown/traversal rejection | PASS backend/fake-client; progressive physical hardware playback deferred |
| P1-AC-10 | Playback done/failed tests prove MP3 deletion, busy release, and no failed-playback resend | PASS |
| P1-AC-11 | Fake ESP32 E2E and standalone CLI complete auth→upload→thinking→audio-ready→download→playback-done | PASS |

## Fresh command evidence

```text
Command: python scripts/verify-backend-mvp-docs.py
Exit code: 0
Result: PASS — 11 package files, exact source hashes, semantic migration §§1–§33, canonical decisions, internal path, verification taxonomy, and authorization gate verified.
Fresh rerun: 2026-07-19
```

```text
Command: cd backend && npm test
Exit code: 0
Result: 10 test files passed; 50 tests passed; 0 failed; 0 skipped.
Fresh rerun: 2026-07-19
```

```text
Command: cd backend && npm run typecheck
Exit code: 0
Fresh rerun: 2026-07-19

Command: cd backend && npm run build
Exit code: 0
Fresh rerun: 2026-07-19

Command: cd backend && npm audit
Exit code: 0
Result: found 0 vulnerabilities
Fresh rerun: 2026-07-19
```

```text
Command: cd backend && npm run fake-esp32
Exit code: 0
Result: requestId=a52a3493-ca00-4e6d-bfed-06684ebd2abd,
        authenticated=true, uploadStatus=202, thinkingSeen=true,
        audioReadySeen=true, audioContentType=audio/mpeg,
        audioBytes=4077, playbackDoneSent=true
Fresh rerun: 2026-07-19
```

Health during the same isolated run:

```json
{"status":"ok","backend":"ok","hermes":"bypassed","audio_service":"bypassed","rvc":"bypassed"}
```

```text
Command: ffprobe -v error -select_streams a:0 -show_entries stream=codec_name,sample_rate,channels,bit_rate -of json backend/tests/fixtures/test-response.mp3
Exit code: 0
Result: codec_name=mp3, sample_rate=24000, channels=1, bit_rate=96000
Fresh rerun: 2026-07-19
```

## Scope and canonical audit

- Verifier confirms canonical SHA-256 references, semantic migration §§1–§33, locked required strings/decisions, versioned internal hardware-contract path, stable filenames, phase rows P1–P6, and authorization gate.
- Canonical/locked files `00`–`06`, hardware contract, PRD, and requirement traceability were not edited by P1 implementation.
- Canonical source hashes rechecked: PRD `77b4bba8333aa277201976b024466d85c10257b13a63d5f5824b6c94555b70b8`, backend source archive `d1554d8d2cdbd6e32cf7acca75ce17031adcc47463b8577f64cdc288fa076853`, hardware contract `633e398a7fa39a3ebc469af7f9ca46fd04890339bb132ec7de2c2286207c6a44`.
- Source scan found no implementation of excluded services/features. `TTS_FAILED` and health key `rvc` occur only because canonical public schemas require future status/error vocabulary.
- No skipped/only tests. No critical TODO/FIXME/HACK/XXX/TBD/unfinished markers in source/tests/scripts; marker hits only document the audit rule itself.
- No secret file, `.env`, model, generated request audio, deployment config, firmware, or app code was added. `backend/.gitignore` excludes `.env`, `node_modules/`, `dist/`, and `temp-audio/`.

## External integration moved out of P1 backend blocker

### HW-INTEGRATION-01

Status: NOT_STARTED  
Owner: Backend team + Hardware team  
Dependency: P6 staging endpoint available  
Scope:

- physical ESP32 WebSocket authentication;
- upload WAV asli;
- progressive MP3 download;
- decoder dan speaker playback;
- playback_done/playback_failed;
- reconnect dan duplicate-event handling.

Idle WebSocket soak one hour belongs to P5 reliability verification. It is not a blocker for P2 backend development.
