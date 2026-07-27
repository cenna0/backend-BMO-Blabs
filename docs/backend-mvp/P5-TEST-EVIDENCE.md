# P5 Reliability, Security, Lifecycle Test Evidence

> **HISTORICAL PHASE RECORD — NOT A CURRENT EXECUTION INSTRUCTION.** This file records the P1–P5 state/ownership at the time it was written. References to “P6” or old runtime defaults inside this record are historical. For current execution order and ownership, use `../NEXT-ACTION.md`, `IMPLEMENTATION-STATUS.md`, and `../roadmap/P6-P10-ROADMAP.md`.

**Status:** VERIFIED — BACKEND
**Verification date:** 2026-07-19
**Authorized by:** explicit user instruction in chat
**Scope:** P5 only. P6 remains `NOT AUTHORIZED`.

## 1. Result

P5 is `VERIFIED — BACKEND` because reliability, security, lifecycle, reconnect, idempotency, TTL, timeout, cleanup, soak, and regression evidence passed locally.

Explicit non-claims:

- Real VPS deployment: NOT RUN; remains P6.
- VPS resource benchmark: NOT RUN; remains P6.
- Real RVC inference: NOT RUN; remains `P3-RVC-VERIFICATION`.
- Physical ESP32: NOT RUN; remains `HW-INTEGRATION-01`.

## 2. Implementation Coverage

| Requirement | Evidence |
|---|---|
| Duplicate same `device_id + request_id + sha256` does not start second pipeline | `backend/tests/p5-idempotency.integration.test.ts` |
| Duplicate valid returns HTTP `200` with current public status | `backend/tests/p5-idempotency.integration.test.ts` |
| Same request ID with different body returns `409 REQUEST_ID_CONFLICT` | `backend/tests/p5-idempotency.integration.test.ts` |
| Same request ID from different device returns `409 REQUEST_ID_CONFLICT` | `backend/tests/p5-idempotency.integration.test.ts` |
| Duplicate check happens before `DEVICE_BUSY` | `backend/tests/p5-idempotency.integration.test.ts` |
| Internal status maps to public status | `backend/tests/p5-request-store.test.ts` |
| Tombstone retained baseline 10 minutes and GC bounded | `backend/tests/p5-request-store.test.ts` |
| WebSocket auth timeout and close codes `4001/4003/4008` | `backend/tests/websocket.integration.test.ts` |
| Latest authenticated connection wins and old connection gets `connection_replaced` | `backend/tests/websocket.integration.test.ts` |
| Native ping/pong and close after two missed pong | `backend/tests/websocket.integration.test.ts`; one-hour soak |
| Reconnect sends `backend_state` and pending `thinking`/`audio_ready` | `backend/tests/websocket.integration.test.ts` |
| `audio_ready` resend uses remaining TTL | `backend/tests/websocket.integration.test.ts` |
| Backend restart/empty store reports `backend_state: idle` | `backend/tests/websocket.integration.test.ts` |
| Unknown/invalid WebSocket event does not crash process | `backend/tests/websocket.integration.test.ts` |
| Playback done/failed idempotent and owner-only | `backend/tests/p5-playback-lifecycle.integration.test.ts` |
| Failed playback deletes MP3, releases busy, no regenerate/resend | `backend/tests/p5-playback-lifecycle.integration.test.ts` |
| WAV input cleanup after success/failure | existing pipeline tests; P4 full pipeline |
| Kokoro/RVC intermediate cleanup through `finally` | `audio-service/tests/test_tts.py` |
| MP3 done/failed/TTL cleanup and `AUDIO_EXPIRED` event | `backend/tests/p5-temp-audio-lifecycle.test.ts` |
| Expired audio ID returns HTTP `410`; unknown returns `404` | `backend/tests/p5-temp-audio-lifecycle.test.ts`; existing audio route tests |
| Startup cleanup only temp dir and path traversal rejected | `backend/tests/p5-temp-audio-lifecycle.test.ts`; existing audio route tests |
| STT/TTS/Hermes/total timeout mapping | `backend/tests/p5-timeouts.test.ts`; existing pipeline tests |
| Full failure matrix maps `NO_SPEECH`, `INVALID_AUDIO`, `STT_FAILED`, `HERMES_FAILED`, `TTS_FAILED`, `AUDIO_EXPIRED`, `PIPELINE_TIMEOUT`, `INTERNAL_ERROR` | `backend/tests/p5-failure-mapping.test.ts`; TTL tests for `AUDIO_EXPIRED` |
| Provider error not sent to TTS | `backend/tests/hermes-client.test.ts`; `backend/tests/voice-pipeline.test.ts` |
| Timing-safe token compare | `backend/tests/device-auth.test.ts`; `backend/src/utils/device-auth.ts` |
| HTTP 3 MB limit, Content-Length/actual bytes, WAV metadata | `backend/tests/voice.integration.test.ts`; `backend/tests/p5-security.test.ts`; `backend/tests/wav-validator.test.ts` |
| WebSocket 8 KB limit | `backend/tests/websocket.integration.test.ts` |
| Secrets/raw audio/full transcript not logged by default | `backend/tests/p5-security.test.ts`; log field audit |
| Audio Service internal token required | `backend/tests/audio-service-client.test.ts`; `audio-service/tests/test_health_and_auth.py` |
| `.env`, generated audio, model, and cache ignored | `.gitignore`, `backend/.gitignore`, `audio-service/.gitignore`; `git status --short` audit |

## 3. One-Hour Idle WebSocket Soak

Command:

```powershell
cd backend
npm run soak-p5-idle-ws
```

Exit code: 0

Result:

```json
{
  "duration_ms": 3600004,
  "memory_start_rss_bytes": 89092096,
  "memory_end_rss_bytes": 56586240,
  "memory_delta_rss_bytes": -32505856,
  "ping_count": 59,
  "pong_count": 59,
  "terminated_count": 0,
  "disconnect_count": 0,
  "reconnect_count": 0,
  "unhandled_rejections": 0,
  "socket_open": true
}
```

Soak used baseline 60-second native ping. No disconnect, reconnect, crash, terminate, or unhandled rejection occurred.

## 4. Post-Soak Full Local Pipeline

Command:

```powershell
cd backend
npm run verify-p4-full-pipeline
```

Exit code: 0

Result:

- `pass: true`
- fake ESP32 authenticated, uploaded WAV, saw `thinking`, saw `audio_ready`, downloaded MP3, and sent `playback_done`
- STT: real local faster-whisper fixture, transcript `Hello BMO, please help me remember the meeting tomorrow.`
- Hermes: Hermes-compatible fixture via `/v1/responses`
- TTS: real Kokoro + FFmpeg through Audio Service; RVC requested but fallback Kokoro-only because local RVC unavailable
- Output MP3: `D:\codex\BMO\audio-service\temp\p4-full-pipeline\pipeline-output.mp3`
- Timings: STT 27955 ms; Hermes 14 ms; TTS 23541 ms; store MP3 17 ms; total 51531 ms

Standalone ffprobe:

```powershell
cd audio-service
ffprobe -v error -show_entries stream=codec_name,sample_rate,channels,bit_rate -show_entries format=duration,bit_rate -of json .\temp\p4-full-pipeline\pipeline-output.mp3
```

Exit code: 0

```json
{
  "streams": [
    {
      "codec_name": "mp3",
      "sample_rate": "24000",
      "channels": 1,
      "bit_rate": "96000"
    }
  ],
  "format": {
    "duration": "5.125000",
    "bit_rate": "97624"
  }
}
```

## 5. Regression Commands

| Command | Exit code | Result |
|---|---:|---|
| `python scripts/verify-backend-mvp-docs.py` | 0 | PASS; 11 package files verified |
| `cd backend; npm test` | 0 | 21 files / 99 tests passed |
| `cd backend; npm test -- p5` | 0 | 7 files / 29 tests passed |
| `cd backend; npm run typecheck` | 0 | PASS |
| `cd backend; npm run build` | 0 | PASS |
| `cd backend; npm audit` | 0 | 0 vulnerabilities |
| `cd backend; npm run fake-esp32` | 0 | authenticated/upload 202/`thinking`/`audio_ready`/MP3 download/`playback_done` |
| `cd backend; npm run verify-p4-full-pipeline` after soak | 0 | full local pipeline PASS |
| `cd backend; npm run soak-p5-idle-ws` | 0 | 60-minute idle soak PASS |
| `cd audio-service; .venv\Scripts\python.exe -m pytest` | 0 | 48 passed |
| `cd audio-service; .venv\Scripts\python.exe -m compileall app tests scripts` | 0 | PASS |
| `cd audio-service; .venv\Scripts\python.exe -m pip check` | 0 | No broken requirements |
| `cd audio-service; ffprobe ... pipeline-output.mp3` | 0 | MP3, 24 kHz, mono, 96 kbps |

Non-final diagnostic commands:

| Command | Exit code | Note |
|---|---:|---|
| `cd backend; npm run fake-esp32` before self-host patch | 1 | Failed with `ECONNREFUSED 127.0.0.1:3000`; script previously required external backend. Fixed by self-host fallback and reran successfully. |
| `cd audio-service; python -m pytest` using default Python | 1 | Default Python lacked pytest. Reran with project `.venv` successfully. |
| `cd backend; $env:P5_SOAK_MS='200'; npm run soak-p5-idle-ws` | 0 | Short script smoke only; not used as one-hour soak evidence. |

## 6. Test Counts

```text
backend full suite: 99 passed / 0 failed / 0 skipped
backend P5 targeted: 29 passed / 0 failed / 0 skipped
audio-service: 48 passed / 0 failed / 0 skipped
combined full automated tests: 147 passed / 0 failed / 0 skipped
combined including standalone P5 rerun: 176 passed / 0 failed / 0 skipped
```

## 7. Files Changed

- `.gitignore`
- `audio-service/tests/test_tts.py`
- `backend/package.json`
- `backend/scripts/fake-esp32.ts`
- `backend/scripts/soak-p5-idle-ws.ts`
- `backend/src/config/env.ts`
- `backend/src/domain/request-store.ts`
- `backend/src/http/audio.route.ts`
- `backend/src/http/voice.route.ts`
- `backend/src/server.ts`
- `backend/src/services/audio-service.client.ts`
- `backend/src/services/hermes.client.ts`
- `backend/src/services/temp-audio.service.ts`
- `backend/src/websocket/websocket.server.ts`
- `backend/tests/audio-service-client.test.ts`
- `backend/tests/hermes-client.test.ts`
- `backend/tests/p5-failure-mapping.test.ts`
- `backend/tests/p5-idempotency.integration.test.ts`
- `backend/tests/p5-playback-lifecycle.integration.test.ts`
- `backend/tests/p5-request-store.test.ts`
- `backend/tests/p5-security.test.ts`
- `backend/tests/p5-temp-audio-lifecycle.test.ts`
- `backend/tests/p5-timeouts.test.ts`
- `docs/backend-mvp/CHANGELOG.md`
- `docs/backend-mvp/IMPLEMENTATION-STATUS.md`
- `docs/backend-mvp/P5-IMPLEMENTATION-PLAN.md`
- `docs/backend-mvp/P5-TEST-EVIDENCE.md`

## 8. Scope Audit

PASS:

- P6 remains `NOT AUTHORIZED`.
- P3 remains `IMPLEMENTED — not VERIFIED`.
- `P3-RVC-VERIFICATION` remains `DEFERRED`.
- Public endpoint set unchanged: `GET /health`, `WS /ws`, `POST /api/v1/voice`, `GET /audio/:audioId.mp3`.
- Public WebSocket event set unchanged.
- Hardware contract unchanged.
- PRD unchanged.
- No firmware, physical ESP32, VPS deployment, public port/firewall, Spotify, WhatsApp, database, or mobile app work.
- No real RVC success claimed.
- No `.env`, generated audio, model, cache, `node_modules`, or `dist` artifact intended for Git.

## 9. Known Limitations

- P5 is backend/local reliability verification only. It is not `DEPLOYMENT VERIFIED`.
- Real VPS deployment and resource benchmark remain P6.
- Real RVC inference remains deferred to `P3-RVC-VERIFICATION`.
- Physical ESP32 validation remains deferred to `HW-INTEGRATION-01`.
