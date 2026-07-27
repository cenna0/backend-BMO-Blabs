# P4 — Hermes adapter + full voice pipeline orchestration Implementation Plan

> **HISTORICAL PHASE RECORD — NOT A CURRENT EXECUTION INSTRUCTION.** This file records the P1–P5 state/ownership at the time it was written. References to “P6” or old runtime defaults inside this record are historical. For current execution order and ownership, use `../NEXT-ACTION.md`, `IMPLEMENTATION-STATUS.md`, and `../roadmap/P6-P10-ROADMAP.md`.

> **For agentic workers:** Execute inline in this session. No subagent delegation unless the user explicitly asks for it.

**Goal:** Implement P4 only: Express backend orchestration from accepted WAV upload through Audio Service STT, Hermes-compatible response generation, Audio Service TTS, temporary MP3 storage, and `audio_ready` WebSocket notification.

**Architecture:** Keep public HTTP/WebSocket contract unchanged. `POST /api/v1/voice` continues to validate/upload and return HTTP `202`, then dispatches asynchronous P4 processing. New service boundaries isolate Audio Service HTTP calls, Hermes `/v1/responses` parsing/sanitization, optional documented chat-completions adapter, per-conversation serialization, and request-state transitions. Tests use local HTTP fixtures; real Hermes/VPS stays P6, real RVC stays `P3-RVC-VERIFICATION`.

**Tech Stack:** Node.js 22, Express, TypeScript strict, Vitest, native `fetch`, `AbortController`, existing WebSocket registry/store/temp-audio service, local Python Audio Service for optional real-audio verification.

---

## Acceptance map

| ID | Requirement | Evidence |
|---|---|---|
| P4-AC-01 | P4 authorized/active; P5–P6 locked | `IMPLEMENTATION-STATUS.md`, docs verifier |
| P4-AC-02 | Audio Service client for `/stt/transcribe` and `/tts/synthesize` with token auth/timeouts | unit tests |
| P4-AC-03 | Hermes `/v1/responses` adapter sends `instructions`, `conversation`, `store:true`, `stream:false`, `truncation:auto` | unit/integration tests |
| P4-AC-04 | safe Responses-style parser searches message/output_text, ignores tool/function items | unit tests |
| P4-AC-05 | documented chat-completions fallback adapter tested separately, not runtime default | unit tests |
| P4-AC-06 | output sanitization: English voice text, plain text, no Markdown/URL/code fence, max 600 chars/3 sentences | unit tests |
| P4-AC-07 | provider/internal error detection maps to `HERMES_FAILED` and never reaches TTS | unit tests |
| P4-AC-08 | async pipeline after HTTP `202`; state flow accepted → transcribing → thinking → generating_voice → audio_ready/completed/failed | integration tests |
| P4-AC-09 | no-speech maps to `NO_SPEECH`; STT/Hermes/TTS/timeouts map canonical errors | integration tests |
| P4-AC-10 | raw WAV is sent to STT; valid transcript goes to Hermes; sanitized English text goes to TTS; MP3 saved and served | full local fake-pipeline test |
| P4-AC-11 | WAV input cleanup after MP3 success/failure | integration tests |
| P4-AC-12 | request serialization per device/conversation | unit/integration tests |
| P4-AC-13 | no public endpoint/event/hardware contract/PRD locked changes; no P5/P6 work | scope audit |

## File plan

- Modify `backend/src/config/env.ts`: add P4 env config for Audio Service, Hermes, timeout, production/test-mode guards.
- Modify `backend/src/domain/request-store.ts`: add P4 internal states and safe transition helpers without changing public WebSocket schema.
- Create `backend/src/services/audio-service.client.ts`: internal STT/TTS HTTP client.
- Create `backend/src/services/hermes.client.ts`: Responses adapter, chat-completions adapter, parser, sanitizer, provider-error filter.
- Create `backend/src/services/conversation-queue.ts`: per-conversation serialization.
- Create `backend/src/services/voice-pipeline.service.ts`: orchestration and error mapping.
- Modify `backend/src/http/voice.route.ts`: dispatch async pipeline for production mode; keep P1 hardware-test mode.
- Modify `backend/src/server.ts`: wire clients/pipeline.
- Add tests: `backend/tests/audio-service-client.test.ts`, `backend/tests/hermes-client.test.ts`, `backend/tests/voice-pipeline.test.ts`, plus P4 integration coverage inside `backend/tests/voice.integration.test.ts` or new focused integration file.
- Add verification script `backend/scripts/verify-full-pipeline.ts` only if needed for final local evidence.
- Docs: `P4-TEST-EVIDENCE.md`, `IMPLEMENTATION-STATUS.md`, `CHANGELOG.md`.

## TDD execution

1. Run docs verifier after phase-control edit.
2. Write RED tests for Hermes parser, sanitizer, provider-error detection, request payload, non-2xx/invalid JSON/incomplete/empty output/timeout/tool item cases, and chat fallback adapter.
3. Implement minimal `hermes.client.ts`; run focused tests to green.
4. Write RED tests for Audio Service client STT/TTS calls, headers, MP3 headers, non-2xx/timeouts.
5. Implement minimal `audio-service.client.ts`; run focused tests to green.
6. Write RED tests for conversation serialization.
7. Implement minimal queue; run focused tests to green.
8. Write RED tests for voice pipeline success/no-speech/STT fail/Hermes fail/TTS fail/timeout/cleanup/state events.
9. Implement minimal `voice-pipeline.service.ts` and route wiring; run focused tests to green.
10. Run full backend tests.
11. Run local fake-device pipeline with Hermes fixture and Audio Service fixture/real audio component where feasible; record transcript, sanitized response, TTS mode, MP3 metadata, timing per stage.
12. Run full P1–P4 regression commands.
13. Audit scope, generated artifacts, skipped tests, `.only`, canonical docs, P5/P6 authorization, and P3 RVC claim.
14. Update evidence/status/changelog from actual command output.
15. Commit with `feat: implement P4 Hermes adapter and voice pipeline orchestration`.

## Verification commands

```powershell
python scripts/verify-backend-mvp-docs.py
cd backend
npm test
npm run typecheck
npm run build
npm audit
npm run fake-esp32
cd ../audio-service
python -m pytest
python -m compileall app tests scripts
python -m pip check
```

Run the P4 full-pipeline verification command and `ffprobe` on its final MP3 output. Record exit codes and actual output only.

## Out-of-scope guard

- No P5 reliability/TTL edge-case implementation beyond minimum P4 cleanup/error mapping.
- No deployment VPS, real Hermes smoke, benchmark, firewall/domain/TLS.
- No firmware, physical ESP32, database, Spotify, WhatsApp, or mobile app.
- No public backend endpoint, WebSocket event, hardware contract, PRD, or locked decision change.
- P5–P6 remain `NOT AUTHORIZED`.
