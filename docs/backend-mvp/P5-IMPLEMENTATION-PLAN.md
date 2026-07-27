# P5 Reliability Security Lifecycle Implementation Plan

> **HISTORICAL PHASE RECORD — NOT A CURRENT EXECUTION INSTRUCTION.** This file records the P1–P5 state/ownership at the time it was written. References to “P6” or old runtime defaults inside this record are historical. For current execution order and ownership, use `../NEXT-ACTION.md`, `IMPLEMENTATION-STATUS.md`, and `../roadmap/P6-P10-ROADMAP.md`.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement and verify P5 reliability, security, reconnect, idempotency, temporary-file lifecycle, TTL, timeout, and automated regression requirements without changing public endpoints/events or touching P6 scope.

**Architecture:** Keep the in-memory MVP architecture. Extend request state with tombstones, expiration, fake-clock injection, bounded garbage collection, and ownership-aware playback finalization. Keep WebSocket schema stable while making invalid/unknown messages connection-safe, replaying pending state, and using native ping/pong.

**Tech Stack:** Node.js 22, TypeScript, Express, ws, Zod, Pino, Vitest fake timers, FastAPI/Python tests for Audio Service cleanup.

---

## Scope Lock

- P1 remains `VERIFIED - BACKEND`.
- P2 remains `VERIFIED - LOCAL FUNCTIONAL`.
- P3 remains `IMPLEMENTED - not VERIFIED`.
- `P3-RVC-VERIFICATION` remains `DEFERRED`.
- P4 remains `VERIFIED - LOCAL FUNCTIONAL`.
- P5 is `AUTHORIZED` and `IN_PROGRESS`.
- P6 remains `NOT AUTHORIZED`.
- No PRD, hardware contract, public endpoint, WebSocket event set, or locked decision changes.
- No VPS deployment, public port/firewall change, firmware, physical ESP32, Spotify, WhatsApp, database, or mobile app work.

## Requirement Mapping

| ID | Requirement | Primary tests |
|---|---|---|
| P5-IDEMP-01 | Duplicate same `device_id + request_id + sha256` returns `200` and starts no second pipeline | `backend/tests/p5-idempotency.integration.test.ts` |
| P5-IDEMP-02 | Same request ID with different body or different device conflicts before `DEVICE_BUSY` | `backend/tests/p5-idempotency.integration.test.ts` |
| P5-IDEMP-03 | Public status maps to `processing`, `audio_ready`, `completed`, `failed`, `expired` | `backend/tests/p5-idempotency.integration.test.ts` |
| P5-IDEMP-04 | Tombstone retained 10 minutes, GC bounded by max entries | `backend/tests/p5-request-store.test.ts` |
| P5-WS-01 | Close codes `4001/4003/4008`, latest connection wins, old connection gets `connection_replaced` | existing + `backend/tests/p5-websocket-reliability.test.ts` |
| P5-WS-02 | Native ping 60s baseline, close after two missed pong, one-hour idle soak | accelerated test + `backend/scripts/soak-p5-idle-ws.ts` |
| P5-WS-03 | Reconnect replays `backend_state`, pending `thinking`, pending `audio_ready` with remaining TTL | `backend/tests/p5-websocket-reliability.test.ts` |
| P5-PB-01 | Playback done/failed idempotent, owner-only, duplicate-safe | `backend/tests/p5-playback-lifecycle.integration.test.ts` |
| P5-PB-02 | Failed playback deletes MP3, releases busy, does not regenerate/resend | `backend/tests/p5-playback-lifecycle.integration.test.ts` |
| P5-TTL-01 | WAV success/failure cleanup, MP3 done/failed/TTL cleanup, startup cleanup safe to temp dir | `backend/tests/p5-temp-audio-lifecycle.test.ts` |
| P5-TTL-02 | Expired audio returns `410 AUDIO_EXPIRED`; unknown audio returns `404` | `backend/tests/p5-temp-audio-lifecycle.test.ts` |
| P5-TIMEOUT-01 | STT, Hermes soft/hard, TTS, total timeout map correctly | `backend/tests/p5-timeouts.test.ts` |
| P5-ERR-01 | Failure matrix maps `NO_SPEECH`, `INVALID_AUDIO`, `STT_FAILED`, `HERMES_FAILED`, `TTS_FAILED`, `AUDIO_EXPIRED`, `PIPELINE_TIMEOUT`, `INTERNAL_ERROR` | `backend/tests/p5-failure-mapping.test.ts` |
| P5-SEC-01 | Timing-safe token compare, body byte limit, Content-Length check, WAV metadata, WS 8 KB, no secret logging | `backend/tests/p5-security.test.ts` |
| P5-AUDIO-01 | Audio Service requires internal token and removes Kokoro/RVC intermediate through `finally` | existing Python tests + added assertion if missing |

## Task 1 - Phase Gate Docs

**Files:**
- Modify: `docs/backend-mvp/IMPLEMENTATION-STATUS.md`
- Modify: `docs/backend-mvp/CHANGELOG.md`
- Create: `docs/backend-mvp/P5-IMPLEMENTATION-PLAN.md`

- [x] Update active phase to `P5`.
- [x] Update authorization to `P5 ONLY`.
- [x] Mark P5 `IN_PROGRESS`.
- [x] Keep P6 `NOT AUTHORIZED`.
- [x] Keep P1/P2/P3/P4/P3-RVC statuses unchanged.

## Task 2 - Request Store Idempotency and GC

**Files:**
- Modify: `backend/src/domain/request-store.ts`
- Modify: `backend/src/config/env.ts`
- Test: `backend/tests/p5-request-store.test.ts`

- [x] RED: create duplicate/body-conflict/device-conflict/public-status/tombstone/GC tests.
- [x] GREEN: add `expired` status, public status mapper, `findByRequestId`, `findDuplicate`, `expire`, idempotent completion/failure, tombstone retention, max-entry GC, and injectable clock.
- [x] Verify: `cd backend; npm test -- p5-request-store`.

## Task 3 - HTTP Upload Idempotency Before Busy

**Files:**
- Modify: `backend/src/http/voice.route.ts`
- Modify: `backend/src/services/hardware-test.service.ts`
- Test: `backend/tests/p5-idempotency.integration.test.ts`

- [x] RED: duplicate same WAV returns `200 duplicate:true` while request active and does not enqueue a second pipeline.
- [x] RED: same request ID with different body returns `409 REQUEST_ID_CONFLICT`.
- [x] RED: same request ID from another device returns `409 REQUEST_ID_CONFLICT`.
- [x] RED: duplicate check happens before `DEVICE_BUSY`.
- [x] GREEN: accept body for duplicate within 3 MB, compare actual SHA-256, return public status, resend `audio_ready` when still valid.
- [x] Verify: `cd backend; npm test -- p5-idempotency`.

## Task 4 - Temp Audio TTL, Sweeper, Startup Cleanup

**Files:**
- Modify: `backend/src/services/temp-audio.service.ts`
- Modify: `backend/src/http/audio.route.ts`
- Modify: `backend/src/server.ts`
- Test: `backend/tests/p5-temp-audio-lifecycle.test.ts`

- [x] RED: MP3 TTL expiry marks request `expired`, releases busy, sends `AUDIO_EXPIRED`, deletes MP3, and later GET returns `410`.
- [x] RED: unknown UUID returns `404`; invalid/path traversal returns `404`.
- [x] RED: startup cleanup removes old orphan `.mp3`/`input-*.wav` only inside temp dir.
- [x] GREEN: add expired audio tombstones, safe path checks, periodic sweeper using 30s interval, startup cleanup, injectable clock.
- [x] Verify: `cd backend; npm test -- p5-temp-audio-lifecycle`.

## Task 5 - Playback Lifecycle

**Files:**
- Modify: `backend/src/server.ts`
- Modify: `backend/src/domain/request-store.ts`
- Test: `backend/tests/p5-playback-lifecycle.integration.test.ts`

- [x] RED: `audio_playback_done` and `audio_playback_failed` duplicates are idempotent.
- [x] RED: event from non-owner device is ignored with warning.
- [x] RED: failed playback deletes MP3, releases busy, no regenerate/resend.
- [x] GREEN: centralize owner-aware finalization and tolerate terminal duplicate events.
- [x] Verify: `cd backend; npm test -- p5-playback-lifecycle`.

## Task 6 - WebSocket Reliability

**Files:**
- Modify: `backend/src/websocket/websocket.server.ts`
- Modify: `backend/src/websocket/device-registry.ts`
- Test: `backend/tests/p5-websocket-reliability.test.ts`
- Script: `backend/scripts/soak-p5-idle-ws.ts`

- [x] RED: invalid authenticated event does not crash process and does not require process restart.
- [x] RED: reconnect sends `idle` when store is empty.
- [x] RED: reconnect resends pending `thinking`.
- [x] RED: reconnect resends `audio_ready` with remaining TTL, not reset 300.
- [x] GREEN: keep process safe on schema/JSON/payload errors, preserve close code behavior, instrument heartbeat counts for soak.
- [x] Verify: `cd backend; npm test -- p5-websocket-reliability`.

## Task 7 - Timeout and Failure Matrix

**Files:**
- Modify: `backend/src/services/voice-pipeline.service.ts`
- Modify: `backend/src/services/audio-service.client.ts`
- Modify: `backend/src/services/hermes.client.ts`
- Test: `backend/tests/p5-timeouts.test.ts`
- Test: `backend/tests/p5-failure-mapping.test.ts`

- [x] RED: STT timeout -> `STT_FAILED` or `PIPELINE_TIMEOUT` per source.
- [x] RED: Hermes soft threshold logs warning and hard timeout aborts.
- [x] RED: TTS timeout -> `TTS_FAILED` or total timeout -> `PIPELINE_TIMEOUT`.
- [x] RED: provider-error output never reaches TTS.
- [x] GREEN: use AbortController timeout paths consistently and keep total timeout dominant.
- [x] Verify: `cd backend; npm test -- p5-timeouts p5-failure-mapping`.

## Task 8 - Security Hardening

**Files:**
- Modify: `backend/src/config/env.ts`
- Modify: `backend/src/http/voice.route.ts`
- Modify: `backend/src/server.ts`
- Modify: `backend/src/services/audio-service.client.ts`
- Test: `backend/tests/p5-security.test.ts`
- Audit: `.gitignore`

- [x] RED: actual body bytes over 3 MB reject even with misleading `Content-Length`.
- [x] RED: actual bytes mismatch `Content-Length` reject.
- [x] RED: logs do not include device token, Hermes key, internal token, authorization header, raw audio, or full transcript.
- [x] RED: unsafe production/test-mode/internal-token config rejected.
- [x] GREEN: tighten env validation, byte checks, logging fields, and Git ignore audit.
- [x] Verify: `cd backend; npm test -- p5-security`.

## Task 9 - Audio Service Cleanup Confirmation

**Files:**
- Inspect/modify if needed: `audio-service/app/tts.py`
- Test: `audio-service/tests/test_tts.py`

- [x] RED if missing: forced Kokoro/RVC/FFmpeg failure leaves no request temp dir.
- [x] GREEN if needed: keep `shutil.rmtree(request_dir, ignore_errors=True)` in `finally`.
- [x] Verify: `cd audio-service; python -m pytest`.

## Task 10 - Full Verification and Evidence

**Files:**
- Create: `docs/backend-mvp/P5-TEST-EVIDENCE.md`
- Modify: `docs/backend-mvp/IMPLEMENTATION-STATUS.md`
- Modify: `docs/backend-mvp/CHANGELOG.md`

- [x] Run docs verifier.
- [x] Run backend `npm test`, `npm run typecheck`, `npm run build`, `npm audit`, `npm run fake-esp32`, `npm run verify-p4-full-pipeline`.
- [x] Run audio-service `python -m pytest`, `python -m compileall app tests scripts`, `python -m pip check`.
- [x] Run P5 targeted tests.
- [x] Run one-hour idle WebSocket soak with fake ESP32 and record memory start/end plus heartbeat counts.
- [x] Run one full local pipeline after soak and `ffprobe` final MP3.
- [x] Update evidence with command, exit code, pass/fail/skip counts, changed files, and non-claims.
- [x] Mark P5 `VERIFIED` only if every acceptance criterion has evidence and all regressions pass.
- [x] Commit with `feat: implement P5 reliability security and lifecycle` only when verified.
