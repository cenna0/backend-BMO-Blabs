# P4 — Hermes adapter + full voice pipeline orchestration Test Evidence

> **HISTORICAL PHASE RECORD — NOT A CURRENT EXECUTION INSTRUCTION.** This file records the P1–P5 state/ownership at the time it was written. References to “P6” or old runtime defaults inside this record are historical. For current execution order and ownership, use `../NEXT-ACTION.md`, `IMPLEMENTATION-STATUS.md`, and `../roadmap/P6-P10-ROADMAP.md`.

**Status:** VERIFIED — LOCAL FUNCTIONAL
**Verification date:** 2026-07-19
**Authorized by:** explicit user instruction in chat
**Scope:** P4 only. P5–P6 remain `NOT AUTHORIZED`.

## 1. Result

P4 is `VERIFIED — LOCAL FUNCTIONAL` because local orchestration is proven end-to-end:

```text
fake ESP32 auth
→ raw WAV upload
→ HTTP 202
→ transcribing
→ thinking
→ real faster-whisper STT
→ real local Hermes /v1/responses
→ generating_voice
→ real Kokoro + FFmpeg TTS via Audio Service
→ backend temp MP3
→ audio_ready
→ MP3 download
→ playback_done
```

Explicit non-claims:

- Real Hermes VPS integration: DEFERRED TO P6.
- Real Hermes VPS latency/resource benchmark: DEFERRED TO P6.
- Real RVC inference: DEFERRED TO `P3-RVC-VERIFICATION`.
- Physical ESP32 hardware playback: DEFERRED TO `HW-INTEGRATION-01`.

RVC was requested by backend with `use_rvc=true`; Audio Service correctly used Kokoro-only fallback because local RVC runtime is unavailable.

## 2. Implementation coverage

| Requirement | Evidence |
|---|---|
| Audio Service backend client for `/stt/transcribe` and `/tts/synthesize` | `backend/tests/audio-service-client.test.ts` |
| Hermes `/v1/responses` default adapter | `backend/tests/hermes-client.test.ts`; real local Hermes full pipeline |
| Runtime BMO instructions sent every request | unit test payload assertion |
| Parser does not rely on `output[0]`; ignores tool/function items | unit tests; Hermes fixture includes ignored function item |
| `/v1/chat/completions` fallback adapter exists but is not runtime default | separate unit test only |
| Sanitizer removes Markdown/URL/code fences, caps three sentences / 600 chars | unit tests |
| Provider/internal error text blocked before TTS | unit tests |
| Async pipeline after HTTP 202 | integration tests and fake-device pipeline |
| `NO_SPEECH`, `STT_FAILED`, `HERMES_FAILED`, `TTS_FAILED`, `PIPELINE_TIMEOUT`, `INTERNAL_ERROR` mapping | unit/integration tests |
| Raw WAV → STT → Hermes → TTS → MP3 → `audio_ready` | full local fake-device pipeline |
| WAV input cleanup | unit/integration tests |
| Per-conversation serialization | `backend/tests/conversation-queue.test.ts`; pipeline uses `HERMES_CONVERSATION=bmo-001` |
| Public endpoint/WebSocket event/hardware contract unchanged | scope audit and docs verifier |

## 3. Real local Hermes evidence

Hermes local install:

```text
hermes --version
exit code: 0
Hermes Agent v0.16.0 (2026.6.5) · upstream c0c76a47
Project: C:\Users\cenna\AppData\Local\hermes\hermes-agent
Python: 3.11.15
OpenAI SDK: 2.24.0
```

`hermes status` exit code: 0. Evidence showed:

- provider: OpenAI Codex;
- auth: OpenAI Codex logged in;
- configured model in Hermes status: `gpt-5.5`;
- temporary local gateway exposed `/v1/models` entry `hermes-agent`;
- gateway was stopped after verification.

Real local gateway test used:

```text
API_SERVER_ENABLED=true
API_SERVER_KEY=p4-local-hermes-key
API_SERVER_HOST=127.0.0.1
API_SERVER_PORT=8642
API_SERVER_MODEL_NAME=hermes-agent
hermes gateway run --force --accept-hooks
```

No real secret was committed. `p4-local-hermes-key` is a local verification placeholder.

## 4. Full pipeline — real local Hermes

Command:

```powershell
cd backend
$env:P4_USE_REAL_HERMES='1'
$env:HERMES_API_URL='http://127.0.0.1:8642'
$env:HERMES_API_KEY='p4-local-hermes-key'
npm run verify-p4-full-pipeline
```

Exit code: 0

Input fixture:

| Field | Value |
|---|---|
| Fixture | `audio-service/temp/real-inference-fixtures/english.wav` |
| WAV contract | PCM signed 16-bit little-endian, 16 kHz, mono |
| STT duration | 4.032 s |
| Transcript | `Hello BMO, please help me remember the meeting tomorrow.` |
| Detected language | `en` |
| Language probability | `0.9942911863327026` |
| Speech detected | `true` |

Hermes/TTS result:

| Field | Value |
|---|---|
| Hermes mode | `real-local` |
| Hermes model label | `hermes-agent` |
| Sanitized English response | `Of course, friend. What time tomorrow should BMO remind you about the meeting?` |
| TTS request `use_rvc` | `true` |
| TTS engine | `kokoro` |
| RVC applied | `false` |
| Audio Service health | `degraded` because `rvc_available=false`; `stt_loaded=true`, `kokoro_loaded=true`, `ffmpeg_available=true` |
| Backend health | `degraded`; `backend=ok`, `hermes=configured`, `audio_service=configured`, `rvc=delegated_to_audio_service` |

Fake ESP32 result:

| Field | Value |
|---|---|
| Authenticated | `true` |
| Upload status | `202` |
| `thinking` seen | `true` |
| `audio_ready` seen | `true` |
| Audio content type | `audio/mpeg` |
| Audio bytes | `62253` |
| Playback done sent | `true` |
| Elapsed | `60.744 s` |

Pipeline timings:

| Stage | Duration |
|---|---:|
| STT | 24649 ms |
| Hermes | 12079 ms |
| TTS | 23943 ms |
| Store MP3 | 5 ms |
| Total | 60682 ms |

Final MP3:

```text
Path: D:\codex\BMO\audio-service\temp\p4-full-pipeline\pipeline-output.mp3
codec: mp3
sample_rate: 24000
channels: 1
stream bit_rate: 96000
duration: 5.100000
format bit_rate: 97651
```

Standalone `ffprobe` command:

```powershell
cd audio-service
ffprobe -v error -show_entries stream=codec_name,sample_rate,channels,bit_rate -show_entries format=duration,bit_rate -of json .\temp\p4-full-pipeline\pipeline-output.mp3
```

Exit code: 0.

## 5. Full pipeline — Hermes-compatible fixture

Command:

```powershell
cd backend
npm run verify-p4-full-pipeline
```

Exit code: 0.

Fixture-mode evidence:

- fake ESP32 authenticated, uploaded WAV with HTTP 202, saw `thinking`, saw `audio_ready`, downloaded `audio/mpeg`, and sent `playback_done`;
- Hermes fixture received canonical `/v1/responses` payload with `model`, `instructions`, `conversation`, `store:true`, `stream:false`, `truncation:auto`;
- Hermes fixture response included a tool/function item; backend ignored it and used only message `output_text`;
- real Audio Service STT, Kokoro, and FFmpeg were used;
- MP3 output passed ffprobe as MP3, 24 kHz, mono, 96 kbps.

Fixture-mode timings:

| Stage | Duration |
|---|---:|
| STT | 13992 ms |
| Hermes fixture | 15 ms |
| TTS | 13930 ms |
| Store MP3 | 3 ms |
| Total | 27942 ms |

## 6. Regression commands

| Command | Exit code | Result |
|---|---:|---|
| `python scripts/verify-backend-mvp-docs.py` | 0 | PASS |
| `cd backend; npm test` | 0 | 14 files / 70 tests passed |
| `cd backend; npm run typecheck` | 0 | PASS |
| `cd backend; npm run build` | 0 | PASS |
| `cd backend; npm audit` | 0 | 0 vulnerabilities |
| `cd backend; npm run fake-esp32` with local backend server | 0 | authenticated/upload 202/`thinking`/`audio_ready`/MP3 download/`playback_done` |
| `cd backend; npm run verify-p4-full-pipeline` | 0 | fixture full pipeline PASS |
| `cd backend; P4_USE_REAL_HERMES=1 npm run verify-p4-full-pipeline` | 0 | real local Hermes full pipeline PASS |
| `cd audio-service; python -m pytest` via project `.venv` | 0 | 47 passed |
| `cd audio-service; python -m compileall app tests scripts` via project `.venv` | 0 | PASS |
| `cd audio-service; python -m pip check` via project `.venv` | 0 | No broken requirements |
| `ffprobe` on P4 output MP3 | 0 | MP3, 24 kHz, mono, 96 kbps |

Total latest automated regression tests:

```text
backend: 70 passed / 0 failed
audio-service: 47 passed / 0 failed
combined automated tests: 117 passed / 0 failed
```

## 7. Scope audit

PASS:

- P5–P6 remain `NOT AUTHORIZED`.
- P3 remains `IMPLEMENTED — not VERIFIED`.
- `P3-RVC-VERIFICATION` remains `DEFERRED`.
- Public endpoint unchanged: `POST /api/v1/voice`.
- Public WebSocket event set unchanged.
- Hardware contract unchanged.
- PRD locked decisions unchanged.
- Canonical docs `00`–`06`, requirement traceability, PRD, and hardware contract unchanged.
- No firmware, physical ESP32 test, deployment VPS, Spotify, WhatsApp, database, or mobile app work.
- No `.only` or skipped tests in P4 source/tests.
- No generated model/cache/audio, `node_modules`, `dist`, `.env`, secret, or temp file staged.

Changed files are P4 implementation/evidence only.

## 8. Files changed

- `backend/package.json`
- `backend/scripts/fake-esp32.ts`
- `backend/scripts/hermes-fixture.ts`
- `backend/scripts/verify-p4-full-pipeline.ts`
- `backend/src/config/env.ts`
- `backend/src/domain/request-store.ts`
- `backend/src/http/health.route.ts`
- `backend/src/http/voice.route.ts`
- `backend/src/server.ts`
- `backend/src/services/audio-service.client.ts`
- `backend/src/services/conversation-queue.ts`
- `backend/src/services/hermes.client.ts`
- `backend/src/services/temp-audio.service.ts`
- `backend/tests/audio-service-client.test.ts`
- `backend/tests/conversation-queue.test.ts`
- `backend/tests/env.test.ts`
- `backend/tests/health.integration.test.ts`
- `backend/tests/helpers/test-runtime.ts`
- `backend/tests/hermes-client.test.ts`
- `backend/tests/voice-pipeline.test.ts`
- `backend/tests/voice.integration.test.ts`
- `docs/backend-mvp/IMPLEMENTATION-STATUS.md`
- `docs/backend-mvp/P4-IMPLEMENTATION-PLAN.md`
- `docs/backend-mvp/P4-TEST-EVIDENCE.md`
- `docs/backend-mvp/CHANGELOG.md`

## 9. Known limitations

- P4 is local functional only. It is not `DEPLOYMENT VERIFIED`.
- Real Hermes VPS smoke, staging URL, and latency/resource benchmark remain P6.
- Real RVC inference remains deferred to `P3-RVC-VERIFICATION`.
- Physical ESP32 validation remains deferred to `HW-INTEGRATION-01`.
