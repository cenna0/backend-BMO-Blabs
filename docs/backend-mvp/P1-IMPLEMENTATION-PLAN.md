# P1 — Core Backend Transport & Hardware Test Mode Implementation Plan

> **HISTORICAL PHASE RECORD — NOT A CURRENT EXECUTION INSTRUCTION.** This file records the P1–P5 state/ownership at the time it was written. References to “P6” or old runtime defaults inside this record are historical. For current execution order and ownership, use `../NEXT-ACTION.md`, `IMPLEMENTATION-STATUS.md`, and `../roadmap/P6-P10-ROADMAP.md`.

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` inline. Steps use checkbox (`- [ ]`) syntax for tracking. No subagent/delegation is authorized.

**Goal:** Build only P1: Express.js + TypeScript transport, authenticated WebSocket state, raw WAV validation/upload, hardware-test dummy MP3 delivery, and basic fake ESP32 verification.

**Architecture:** One backend process owns HTTP, WebSocket, in-memory device/request state, and temporary P1 audio. Hardware-test processor is an explicit adapter enabled only by environment configuration; it never calls Audio Service, faster-whisper, Hermes, Kokoro, RVC, or production deployment services.

**Tech Stack:** Node.js 22, TypeScript strict, Express.js, `ws`, Zod, Pino, Vitest, Supertest.

---

## Authorized acceptance map

| ID | P1 acceptance proof | Planned test |
|---|---|---|
| P1-AC-01 | Backend starts; `/health` reports backend health without secrets | `health.integration.test.ts` |
| P1-AC-02 | Hardware test mode defaults off and is rejected with `NODE_ENV=production` | `env.test.ts` |
| P1-AC-03 | WS message auth works; close codes `4001`, `4003`, `4008` match contract | `websocket.integration.test.ts` |
| P1-AC-04 | Latest authenticated connection replaces old connection; native heartbeat policy is configurable for deterministic test | `websocket.integration.test.ts` |
| P1-AC-05 | `authenticated` exposes `idle/thinking/audio_ready` state; backend emits only display mode `thinking` | `websocket.integration.test.ts`, `voice.integration.test.ts` |
| P1-AC-06 | Raw `audio/wav` requires canonical headers, valid credential, active WS, UUID v4, max bytes, PCM 16-bit LE/16 kHz/mono, ≤60 s | `voice.integration.test.ts`, validator unit tests |
| P1-AC-07 | One active request per device; second new request receives `DEVICE_BUSY` | `request-store.test.ts`, `voice.integration.test.ts` |
| P1-AC-08 | Valid upload creates safe state, returns HTTP 202, and emits correlated `thinking` regardless of HTTP/WS observation order | `voice.integration.test.ts`, `fake-esp32.test.ts` |
| P1-AC-09 | Test mode bypasses future AI stack, copies dummy MP3, emits `audio_ready`, and serves UUID URL with exact content headers | `voice.integration.test.ts`, `fake-esp32.e2e.test.ts` |
| P1-AC-10 | Basic playback done/failed cleanup releases device and never resends `audio_ready` on failure | `voice.integration.test.ts` |
| P1-AC-11 | Basic fake ESP32 connects, authenticates, uploads WAV, observes thinking/audio-ready, downloads MP3, validates headers/bytes, sends playback done | `fake-esp32.e2e.test.ts`, `npm run fake-esp32` |

Deferred to named owners: duplicate upload/hash conflict/tombstone/GC/reconnect replay/TTL/startup cleanup/security failure matrix (P5); Audio Service/STT (P2); Kokoro/RVC/FFmpeg (P3); Hermes/full orchestration (P4); VPS/deployment/benchmark (P6).

## File map

```text
backend/
├── package.json                         pinned scripts/dependencies
├── package-lock.json                    resolved dependency graph
├── tsconfig.json                        strict TypeScript build
├── src/
│   ├── config/env.ts                    environment schema and P1 safety rule
│   ├── domain/request-store.ts          basic in-memory active request state
│   ├── http/audio.route.ts              safe dummy MP3 download
│   ├── http/health.route.ts             P1 health response
│   ├── http/voice.route.ts              upload preflight/body/postflight flow
│   ├── services/hardware-test.service.ts dummy MP3 copy + audio record
│   ├── services/temp-audio.service.ts   UUID path ownership and deletion
│   ├── utils/device-auth.ts             timing-safe token comparison
│   ├── utils/uuid.ts                    UUID v4 validation
│   ├── utils/wav-validator.ts           RIFF chunk parser + canonical metadata
│   ├── websocket/device-registry.ts     active authenticated socket/state
│   ├── websocket/events.ts              exact inbound/outbound schemas
│   ├── websocket/websocket.server.ts    auth timeout/replacement/heartbeat/events
│   └── server.ts                        app/runtime factory + shutdown
├── scripts/fake-esp32.ts                runnable basic hardware client
├── tests/
│   ├── fixtures/test-response.mp3       generated static dummy MP3
│   ├── helpers/test-runtime.ts           isolated temp runtime
│   ├── helpers/wav.ts                    canonical in-memory WAV generator
│   ├── env.test.ts
│   ├── request-store.test.ts
│   ├── uuid.test.ts
│   ├── wav-validator.test.ts
│   ├── health.integration.test.ts
│   ├── websocket.integration.test.ts
│   ├── voice.integration.test.ts
│   ├── fake-esp32.test.ts
│   └── fake-esp32.e2e.test.ts
docs/backend-mvp/
├── IMPLEMENTATION-STATUS.md             P1 transition + final evidence
├── CHANGELOG.md                          actual P1 implementation summary
├── P1-IMPLEMENTATION-PLAN.md             this plan
└── P1-TEST-EVIDENCE.md                   commands, results, files, limitations
scripts/verify-backend-mvp-docs.py        phase-aware authorization-gate assertion only if RED proves stale initial-state check
```

## Task 1: Bootstrap and configuration safety

**Files:** create `backend/package.json`, `backend/tsconfig.json`, `backend/src/config/env.ts`, `backend/tests/env.test.ts`.

- [ ] Write RED tests for canonical defaults and production exclusion:

```ts
expect(parseEnv(minimal).HARDWARE_TEST_MODE).toBe(false);
expect(() => parseEnv({ ...minimal, NODE_ENV: "production", HARDWARE_TEST_MODE: "true" }))
  .toThrow(/HARDWARE_TEST_MODE/);
```

- [ ] Run `npm test -- tests/env.test.ts`; expect failure because `parseEnv` does not exist.
- [ ] Add strict Zod schema. Export `BackendConfig` and `parseEnv(input)`; parse booleans explicitly, set `MAX_AUDIO_BYTES=3145728`, `MAX_AUDIO_DURATION_SECONDS=60`, auth timeout 5000 ms, heartbeat 60000 ms, two missed pongs, and reject test mode in production.
- [ ] Run focused test; expect pass. Run `npm run typecheck`; expect exit 0.

## Task 2: Pure transport validators and basic request state

**Files:** create unit tests plus `uuid.ts`, `device-auth.ts`, `wav-validator.ts`, `request-store.ts`.

- [ ] Write RED UUID tests: accept RFC UUID v4; reject v1, malformed, uppercase/lowercase remain acceptable.
- [ ] Run focused UUID test; expect missing module failure. Implement anchored v4 parser; rerun green.
- [ ] Write RED WAV tests using `makePcmWav`: accept RIFF/WAVE PCM format 1, mono, 16000 Hz, 16-bit; reject corrupt RIFF, stereo, 8000 Hz, 8-bit, float format, >60 seconds, truncated chunks.
- [ ] Run focused WAV tests; expect missing validator failure. Implement chunk iteration over `fmt ` and `data`, little-endian bounds checks, byte-rate/duration calculation; rerun green.
- [ ] Write RED auth tests ensuring correct token succeeds and wrong/length-different token fails. Implement SHA-256 digest plus `timingSafeEqual`; rerun green.
- [ ] Write RED request-store tests:

```ts
store.create({ requestId, deviceId, inputPath, inputSha256, inputContentLength });
expect(store.getActiveForDevice(deviceId)?.requestId).toBe(requestId);
expect(() => store.create({ requestId: other, deviceId, ...input })).toThrow("DEVICE_BUSY");
store.markAudioReady(requestId, audio);
store.complete(requestId);
expect(store.getActiveForDevice(deviceId)).toBeUndefined();
```

- [ ] Implement only basic statuses `accepted`, `audio_ready`, `completed`, `failed`; no tombstone expiry, duplicate upload behavior, or GC. Run unit suite green.

## Task 3: WebSocket contract

**Files:** create `events.ts`, `device-registry.ts`, `websocket.server.ts`, `websocket.integration.test.ts`.

- [ ] Write RED integration tests for successful `authenticate` and exact `authenticated` fields.
- [ ] Run test; expect server factory missing. Implement schema size limit 8 KB, first-message auth, timing-safe credential validation, registry ownership, and `backend_state` lookup.
- [ ] Write RED close tests: non-auth first event → `4001`; wrong credentials emits exact `authentication_failed` then `4003`; no message by configured timeout → `4008`.
- [ ] Run RED. Implement close paths; rerun green.
- [ ] Write RED replacement test: second authenticated socket receives active ownership; first receives exact `connection_replaced` then closes.
- [ ] Implement replacement without closing new socket; rerun green.
- [ ] Write RED heartbeat test with short injected interval: missed pongs increment, automatic/native pong resets, close only after two misses.
- [ ] Implement native ping timer and cleanup on close/shutdown; rerun WebSocket suite green.
- [ ] Assert outbound display schema accepts only `thinking`; grep source/test for forbidden `listening` event/status.

## Task 4: HTTP upload and hardware-test audio path

**Files:** create HTTP/service/server files, helpers, `health.integration.test.ts`, `voice.integration.test.ts`, and MP3 fixture.

- [ ] Write RED `/health` test: status 200, backend `ok`, no env secrets; in hardware mode dependency fields state `bypassed` rather than fabricated production health.
- [ ] Implement health route; rerun green.
- [ ] Write RED preflight tests for missing headers, invalid credential, invalid UUID, unsupported content type, too-large declared length, and missing authenticated WS. Assert canonical HTTP/error bodies.
- [ ] Implement pre-body middleware in canonical validation order; rerun green.
- [ ] Write RED post-body tests for actual size, malformed WAV/metadata, and WS disconnected before state creation. Assert temporary input removed and no request state created.
- [ ] Implement raw `express.raw({ type: "audio/wav", limit })`, safe temp write, SHA-256, second WS check, centralized error mapping; rerun green.
- [ ] Write RED happy-path test: valid WAV with authenticated WS returns `202 {request_id,status:"processing"}` and emits only `display_status:{status:"thinking"}`.
- [ ] Generate static fixture with local FFmpeg only as test data:

```powershell
ffmpeg -f lavfi -i "sine=frequency=660:duration=0.25" -ac 1 -ar 24000 -b:a 96k backend/tests/fixtures/test-response.mp3
```

- [ ] Implement async `HardwareTestService`: copy configured dummy MP3 to random audio UUID, mark request `audio_ready`, delete input WAV, emit exact `audio_ready` with remaining configured TTL.
- [ ] Write RED download test: valid UUID returns 200 with `audio/mpeg`, exact `Content-Length`, `Cache-Control: no-store, private, max-age=0`; unknown/invalid UUID returns 404; no directory listing/path traversal.
- [ ] Implement audio route through `TempAudioService`; rerun green.
- [ ] Write RED active-request test: another UUID during audio-ready state returns canonical `409 DEVICE_BUSY`.
- [ ] Write RED playback tests: owner `audio_playback_done` deletes MP3/completes/releases; `audio_playback_failed` deletes/fails/releases and sends no new `audio_ready`. Implement basic handlers; rerun green.
- [ ] Write RED non-test-mode upload test. Implement safe `500 INTERNAL_ERROR` before acceptance when no future pipeline adapter exists; document as P1 limitation, without implementing future services.

## Task 5: Fake ESP32 basic client

**Files:** create `scripts/fake-esp32.ts`, `fake-esp32.test.ts`, `fake-esp32.e2e.test.ts`.

- [ ] Write RED coordinator tests feeding HTTP 202 and WS thinking in both orders. Both must reach same correlated state; duplicate observations must not trigger a second download.
- [ ] Implement request coordinator keyed by `request_id`; rerun green.
- [ ] Write RED E2E test that starts isolated backend, runs `runFakeEsp32`, then asserts: authenticated; upload accepted; thinking seen; audio-ready seen; MP3 headers/bytes valid; playback-done sent; temp MP3 removed.
- [ ] Implement runnable fake client with no firmware code and no future reconnect/idempotency matrix. Run E2E green.

## Task 6: Full verification and evidence

**Files:** update only active P1 status/evidence, changelog, evidence report; modify docs verifier only if its stale state assertion fails after required status transition.

- [ ] Run `npm test`; require zero failed/skipped P1 tests.
- [ ] Run `npm run typecheck`; require exit 0.
- [ ] Run `npm run build`; require exit 0.
- [ ] Start isolated hardware-test backend and run `npm run fake-esp32`; require successful basic flow.
- [ ] Run `python scripts/verify-backend-mvp-docs.py`.
- [ ] If verifier fails only because it hardcodes initial `NONE/NOT GRANTED/P1 NOT AUTHORIZED`, add RED verifier regression test or reproduce failure, minimally change it to accept valid P1 transition while still rejecting unauthorized P2-P6, then rerun to PASS. Do not change canonical docs to satisfy verifier.
- [ ] Read `REQUIREMENT-TRACEABILITY.md`; compare P1 interfaces against hardware contract and relevant PRD sections.
- [ ] Audit read-only canonical hashes and `git status --short`; flag every changed path against this plan.
- [ ] Write `P1-TEST-EVIDENCE.md`: commands, exit codes, test counts, sanitized sample flow, hashes, changed files, limitations, blockers.
- [ ] Update `CHANGELOG.md` with actual P1 work.
- [ ] Set P1 `IMPLEMENTED` after code/build/typecheck complete. Set `VERIFIED` only if every P1-AC-01..11 has fresh evidence and audit/verifier pass; otherwise retain `IMPLEMENTED` or set `BLOCKED` with exact gap.

## Plan self-review

- P1-AC-01..11 each map to at least one test/task.
- No Audio Service, faster-whisper, Hermes, Kokoro, RVC runtime, deployment/VPS, firmware, mobile, Spotify, WhatsApp, PostgreSQL, or Prisma work.
- No canonical/locked document edit.
- No placeholders such as `TBD`, `TODO`, or future implementation inside source plan.
- Signatures/types are consistent across route, store, registry, and fake client steps.
