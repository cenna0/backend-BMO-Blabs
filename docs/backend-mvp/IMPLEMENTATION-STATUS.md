# BMO Backend MVP — Implementation Status

**Last updated:** 2026-07-27
**Backend reference lineage:** 1.0.1; current active documentation is date-audited and governed by this status file

## 1. Control state

```text
Documentation package: AUDITED / HARDWARE HANDOFF ADDED
P1–P5 backend history: implemented/verified according to phase evidence below
Current next implementation phase: P6 — VPS Foundation and Operations Baseline
P6 state: READY
P6 execution authorization: requires an explicit user command to execute/continue the next phase; documentation alone does not start host changes
P7–P10: PLANNED / dependency-gated
```

The previous active P5 marker was stale after P5 verification/manual follow-up. The next phase is now explicitly **P6**. Read `../NEXT-ACTION.md` and `../roadmap/P6-EXECUTION-SPEC.md` before execution. A coding agent still needs an explicit user execution command before changing the VPS, and must stop after P6 verification rather than auto-start P7.

## 2. Documentation status

| Document | Status | Verification |
|---|---|---|
| `../NEXT-ACTION.md` | CURRENT OPERATIONAL ENTRY | Explicitly selects P6 and prevents accidental P7+ execution |
| `../roadmap/P6-EXECUTION-SPEC.md` | READY / LOCKED P6 SPEC | Exact P6 scope, authorization boundary, tasks, acceptance, evidence, stop condition |
| `00-AGENT-EXECUTION-GUIDE.md` | VERIFIED | Workflow, boundary, phase control, stop condition tersedia |
| `01-SCOPE-AND-DECISIONS.md` | VERIFIED / LOCKED | Backend source §1–§3 termigrasi |
| `02-API-AND-WEBSOCKET-CONTRACT.md` | VERIFIED / LOCKED | Backend source §15–§17, §22 dan hardware contract dicocokkan |
| `03-BACKEND-ARCHITECTURE.md` | VERIFIED | Backend source §7–§8, §18–§21, §23–§24 termigrasi |
| `04-AUDIO-SERVICE.md` | AUDITED / CURRENT TUNING | Current STT `medium` + `BMO`; RVC real pending |
| `05-TESTING-AND-ACCEPTANCE.md` | AUDITED / UPDATED | Future verification ownership split P6–P10 |
| `06-DEPLOYMENT-AND-OPERATIONS.md` | AUDITED / TARGET DEFINED | Current VPS target defined; deployment itself not verified |
| `REQUIREMENT-TRACEABILITY.md` | VERIFIED | Seluruh source §1–§33 memiliki target primary |
| `VERIFICATION-REPORT.md` | HISTORICAL PASS | Original 2026-07-18 package verification; not current implementation status |
| `CHANGELOG.md` | VERIFIED | Baseline package tercatat |

## 3. Implementation phases

| Phase | Scope | Required docs | Status | Authorization | Evidence |
|---|---|---|---|---|---|
| P1 | Core backend transport + hardware test mode: health, WS auth/state, raw WAV upload, dummy MP3, fake ESP32 basic | 01, 02, 03, 05, 06 | VERIFIED — BACKEND | AUTHORIZED BY USER | [`P1-TEST-EVIDENCE.md`](P1-TEST-EVIDENCE.md); external hardware validation deferred |
| P2 | Audio Service bootstrap + faster-whisper STT | 01, 03, 04, 05, 06 | VERIFIED — LOCAL FUNCTIONAL | AUTHORIZED BY USER | [`P2-TEST-EVIDENCE.md`](P2-TEST-EVIDENCE.md); real faster-whisper inference passed locally; deployed latency/resource benchmark now belongs to P7/P8 |
| P3 | Kokoro + FFmpeg + RVC fallback | 01, 03, 04, 05, 06 | IMPLEMENTED — not VERIFIED | AUTHORIZED BY USER | [`P3-TEST-EVIDENCE.md`](P3-TEST-EVIDENCE.md); real RVC inference runtime unavailable |
| P4 | Hermes adapter + full voice pipeline orchestration | 01, 02, 03, 04, 05 | VERIFIED — LOCAL FUNCTIONAL | AUTHORIZED BY USER | [`P4-TEST-EVIDENCE.md`](P4-TEST-EVIDENCE.md); real local Hermes pipeline passed; real Hermes host/VPS integration belongs to P7 |
| P5 | Reliability, security, lifecycle, full automated test, reconnect/idempotency/TTL | 01, 02, 03, 05, 06 | VERIFIED — BACKEND | AUTHORIZED BY USER | [`P5-TEST-EVIDENCE.md`](P5-TEST-EVIDENCE.md) |
| P6 | VPS foundation: conditional Hermes host preserve/bootstrap, users, `/opt/bmo`, Docker/Compose, Caddy/TLS, Tailscale, firewall, Beszel/Telegram, backup | `../NEXT-ACTION.md` + `../roadmap/P6-EXECUTION-SPEC.md` + 06 | READY | AWAITING EXPLICIT EXECUTION COMMAND | — |
| P7 | Deploy backend/audio on VPS, integrate with P6-verified Hermes host API, public HTTPS/WSS, fake ESP32 public E2E | 02–06 + handoff | NOT_STARTED | DEPENDS ON P6 VERIFIED | — |
| P8 | Real RVC inference + fallback verification + VPS resource benchmark | 04–06 + roadmap | NOT_STARTED | DEPENDS ON P7 VERIFIED | — |
| P9 | PostgreSQL + Prisma ready-to-use application data layer + backup/restore | PRD + 06 + roadmap | NOT_STARTED | DEPENDS ON P8 COMPLETED/VERIFIED STATUS; EXECUTE AFTER P8 | — |
| P10 | Activate verified hardware endpoint handoff + physical ESP32 acceptance | hardware contract + handoff | NOT_STARTED | DEPENDS ON P9 VERIFIED; ALSO REQUIRES P7 PUBLIC ENDPOINT + P8 STATUS | — |

## 3.1 Post-P5 implementation updates captured by this audit

- P6 now owns conditional Hermes host bootstrap: preserve/audit a proven installation when present; install/configure a maintainable loopback-only host runtime when preflight proves it absent. P7 remains integration-only and does not own initial Hermes installation.
- The 2026-07-27 production VPS preflight reported Hermes `ABSENT`; this documentation update records the execution path but did not install Hermes or start P6 host changes. The P6 executor must re-confirm absence from host evidence before bootstrap.
- STT accuracy investigation on 2026-07-25 selected `WHISPER_MODEL=medium` with `WHISPER_HOTWORDS=BMO`, while keeping CPU INT8, 4 threads, 1 worker, beam 5, VAD, and language auto-detect. The earlier `small` references in P2 evidence remain historical evidence of P2 at that time, not the current tuning target.
- Kokoro manual listening selected `KOKORO_VOICE=af_heart` with `KOKORO_SPEED=0.80` as the current deployment target; earlier evidence that production remained at `1.0` is historical and superseded by this later project decision. Revalidate perceived tempo after real RVC integration.
- Hermes real local `/v1/responses` integration is recorded in the P5 manual evidence addendum. This is not equivalent to VPS/public deployment verification.
- Real RVC inference remains unverified; Kokoro-only fallback is verified behavior.
- The public production target is `api.personalbmo.web.id`, but it must not be called live/verified until P7 evidence updates the deployment handoff.

## 4. Verification types

```text
BACKEND VERIFIED
```

Phase backend terbukti melalui unit test, integration test, fake ESP32, typecheck, build, dependency audit, documentation verifier, contract consistency, PRD consistency, dan scope audit lokal.

```text
DEPLOYMENT VERIFIED
```

Phase deployment terbukti setelah service berjalan di VPS dan public HTTPS/WSS endpoint lulus smoke/E2E verification.

```text
HARDWARE INTEGRATION VERIFIED
```

Integrasi hardware terbukti bersama tim hardware memakai physical ESP32 setelah public endpoint P7 tersedia dan matrix P10 lulus.

Physical ESP32 test dan progressive hardware playback tetap requirement final di P10, tetapi bukan blocker untuk P6–P9 selama public contract tidak berubah. Perubahan ini hanya memperbaiki klasifikasi verification; tidak mengurangi requirement hardware final.

```text
VERIFIED — LOCAL FUNCTIONAL
```

Phase audio/backend terbukti secara lokal dengan dependency nyata, unit/integration test, typecheck/compile, build, dependency check, documentation verifier, contract consistency, dan scope audit. Benchmark latency/resource pada VPS kini dimiliki deployment/resource phases P7–P8, bukan blocker untuk historical local functional verification.

## 5. Phase ownership and dependency

```text
P1 → P2 → P3 → P4 → P5 → P6 → P7 → P8 → P9 → P10
```

- P1 diprioritaskan agar tim hardware dapat menguji kontrak transport tanpa menunggu AI stack.
- P2/P3 dapat memakai internal test harness, tetapi tidak boleh mengubah public interface.
- P4 menyatukan seluruh pipeline setelah komponen individual terbukti.
- P5 menutup edge case dan membuktikan acceptance criteria lengkap.
- P6 menyiapkan fondasi VPS termasuk Hermes host runtime kondisional; P7 menjalankan deployment/public integration terhadap Hermes yang sudah diverifikasi P6; P8 membuktikan RVC dan resource benchmark; P9 menyiapkan database; P10 melakukan hardware handoff/physical verification.
- Idle WebSocket soak satu jam menjadi bagian P5 reliability verification, bukan blocker untuk memulai P2.

## 6. External integration milestones

### HW-INTEGRATION-01

Status: NOT_STARTED  
Owner: Backend team + Hardware team  
Dependency: P7 public endpoint verified; final physical verification is P10  
Scope:

- physical ESP32 WebSocket authentication;
- upload WAV asli;
- progressive MP3 download;
- decoder dan speaker playback;
- playback_done/playback_failed;
- reconnect dan duplicate-event handling.

### P3-RVC-VERIFICATION

Status: DEFERRED
Dependency: P7 deployed Audio Service; execution owner is P8
Scope:

- install/pin compatible RVC inference runtime;
- real Kokoro → RVC → FFmpeg inference;
- validate BMO `.pth` dan `.index`;
- record latency, output metadata, and listening samples;
- rerun P3 regressions.

P3 yang belum verified penuh tidak memblokir P4 karena Kokoro-only fallback sudah terbukti dan RVC bukan single point of failure.

## 7. Status transition checklist

Sebelum mengubah phase menjadi `IMPLEMENTED`:

- code authorized scope selesai;
- daftar file berubah dicatat;
- build/typecheck/lint relevan lulus.

Sebelum mengubah phase menjadi `VERIFIED`:

- seluruh acceptance criteria phase lulus;
- evidence command/output tersedia;
- traceability implementation tersedia;
- tidak ada out-of-scope change;
- consistency check ke hardware contract dan PRD relevan selesai;
- known limitations dicatat.

Sebelum mengubah phase menjadi `VERIFIED — BACKEND`:

- seluruh backend acceptance criteria phase aktif lulus melalui automated/unit/integration/fake-client test yang relevan;
- typecheck, build, dependency audit, docs verifier, contract consistency, PRD consistency, dan scope audit lulus;
- external deployment/hardware requirement yang belum bisa diuji dicatat sebagai milestone external, bukan dinyatakan lulus.

## 8. Evidence template per phase

```md
### Pn — <name>
Status:
Verification type:
Authorized by:
Started at:
Verified at:
Commit:
Files changed:
Requirements implemented:
Commands run:
Test result:
Contract consistency:
PRD consistency:
Known limitations:
Blockers:
```

## 9. Phase evidence

> **Audit note:** detailed P1–P5 evidence below is historical evidence and is preserved verbatim where possible. References saying “remains P6” describe the old phase model at the time the evidence was written. Current future ownership follows the P6–P10 roadmap.


### P1 — Core Backend Transport & Hardware Test Mode

Status: VERIFIED — BACKEND  
External hardware validation: DEFERRED  
Authorized by: explicit user instruction in chat  
Started at: 2026-07-19  
Verified at: 2026-07-19  
Commit: `feat: implement P1 core backend transport and hardware test mode`  
Files changed: recorded in `P1-TEST-EVIDENCE.md`  
Requirements implemented: health, WS auth/state/heartbeat, raw WAV validation/upload, one active request, dummy MP3 URL/download, basic playback cleanup, fake ESP32 basic  
Commands run: `npm test`, `npm run typecheck`, `npm run build`, `npm audit`, `npm run fake-esp32`, `ffprobe`, `python scripts/verify-backend-mvp-docs.py`  
Test result: latest 2026-07-19 rerun: 10 files / 50 tests passed; typecheck/build/audit/docs verifier/fake ESP32/ffprobe passed  
Contract consistency: automated contract tests and canonical verifier passed on latest 2026-07-19 rerun  
PRD consistency: P1 transport/hardware-test subset matches PRD §§1.3, 4.2, 5, 8, 9, 15.3, 16  
Known limitations: physical ESP32 decoder/progressive playback is deferred to `HW-INTEGRATION-01`; one-hour wall-clock idle soak is deferred to P5 reliability verification; P2–P6 deliberately absent from P1  
Blockers: none for BACKEND verification

### P2 — Audio Service bootstrap + faster-whisper STT

Status: VERIFIED — LOCAL FUNCTIONAL
Authorized by: explicit user instruction in chat  
Started at: 2026-07-19  
Verified at: 2026-07-19
Commit: `feat: implement P2 audio service and faster-whisper STT`  
Files changed: recorded in `P2-TEST-EVIDENCE.md`  
Requirements implemented at P2: FastAPI bootstrap, env validation, internal token auth, health state, raw WAV STT endpoint, WAV validation, faster-whisper adapter boundary, real faster-whisper `small` multilingual CPU INT8 inference, auto language detection, language/no-speech normalization, model cache/bootstrap, unit/integration tests. **Historical note:** P5 accuracy work later superseded the runtime default to `medium` + hotword `BMO`.
Commands run: `verify_real_inference.py`, `bootstrap_whisper.py --allow-download`, offline cache rerun with `HF_HUB_OFFLINE=1`, `pytest`, `compileall`, `pip check`, `python scripts/verify-backend-mvp-docs.py`, plus P1 regression `npm test`, `npm run typecheck`, `npm run build`, `npm audit`, and `npm run fake-esp32`
Test result: latest 2026-07-19 final rerun: real faster-whisper inference passed English, Indonesian, mixed Indonesian-English, silence, and noise fixtures; P1 10 files / 50 tests passed; P2 22 tests passed; typecheck/build/audit/docs verifier/fake ESP32/compileall/pip check passed
Contract consistency: internal Audio Service API matches P2 subset of `04-AUDIO-SERVICE.md` §14.1–§14.2; public hardware contract unchanged  
PRD consistency: P2 STT subset matches PRD voice pipeline requirement for Audio Service/faster-whisper; later Hermes/TTS/RVC steps remain deferred  
Known limitations: benchmark latency/resource pada VPS belum dilakukan dan tetap scope P6; P3–P6 remain not authorized
Blockers: none for LOCAL FUNCTIONAL verification

### P3 — Kokoro + FFmpeg + RVC fallback

Status: IMPLEMENTED — not VERIFIED
Authorized by: explicit user instruction in chat
Started at: 2026-07-19
Verified at: —
Commit: `feat: implement P3 Kokoro FFmpeg and RVC fallback`
Files changed: recorded in `P3-TEST-EVIDENCE.md`
Requirements implemented: Kokoro English TTS adapter, text validation, full waveform merge to one WAV, FFmpeg MP3 conversion, MP3 output configuration, safe RVC model bootstrap/inspection/extraction, configurable RVC CLI adapter, Kokoro-only fallback when RVC unavailable/fails, internal `/tts/synthesize`, result headers, P3 health state, cleanup via `finally`, unit/integration tests
Commands run: `bootstrap_rvc.py --allow-download`, `verify_voice_pipeline.py`, offline cache rerun with `HF_HUB_OFFLINE=1`, `ffprobe`, `pytest`, `compileall`, `pip check`, `python scripts/verify-backend-mvp-docs.py`, plus P1 regression `npm test`, `npm run typecheck`, `npm run build`, `npm audit`, and `npm run fake-esp32`
Test result: latest 2026-07-19 final rerun: backend 10 files / 50 tests passed; audio-service 47 tests passed; Kokoro-only real MP3 and forced RVC fallback passed; RVC archive size/hash verified; real RVC inference not run because RVC inference command/runtime unavailable
Contract consistency: internal Audio Service `/tts/synthesize` only; public backend interface must remain unchanged
PRD consistency: P3 TTS/RVC subset matches PRD voice pipeline requirement; Hermes/full orchestration remains deferred to P4
Known limitations: VPS benchmark and physical ESP32 remain out of P3
Blockers: real RVC inference runtime/CLI unavailable locally; P3 cannot become `VERIFIED — LOCAL FUNCTIONAL` until Kokoro + real RVC + FFmpeg succeeds end-to-end

### P4 — Hermes adapter + full voice pipeline orchestration

Status: VERIFIED — LOCAL FUNCTIONAL
Authorized by: explicit user instruction in chat
Started at: 2026-07-19
Verified at: 2026-07-19
Commit: `feat: implement P4 Hermes adapter and voice pipeline orchestration`
Files changed: recorded in `P4-TEST-EVIDENCE.md`
Requirements implemented: backend Audio Service client, Hermes `/v1/responses` runtime adapter, documented chat-completions fallback adapter, safe output parser, BMO runtime instructions, output sanitizer, provider-error detection, async STT→Hermes→TTS orchestration, MP3 temp storage, `audio_ready`, input WAV cleanup, canonical error mapping, per-conversation serialization, and full local fake-device verification
Commands run: `npm test`, `npm run typecheck`, `npm run build`, `npm audit`, `npm run fake-esp32`, `npm run verify-p4-full-pipeline`, real local Hermes full-pipeline verification, `ffprobe`, audio-service `pytest`, `compileall`, `pip check`, and `python scripts/verify-backend-mvp-docs.py`
Test result: latest 2026-07-19 rerun: backend 14 files / 70 tests passed; audio-service 47 tests passed; full local pipeline passed with Hermes fixture and real local Hermes; typecheck/build/audit/docs verifier/fake ESP32/ffprobe/compileall/pip check passed
Contract consistency: public backend interface, WebSocket event set, hardware contract, PRD locked decisions unchanged
PRD consistency: P4 local orchestration matches PRD voice pipeline using real local STT, real local Hermes, real Kokoro/FFmpeg fallback TTS, and fake ESP32 transport
Known limitations: real RVC inference remains deferred to P8; real Hermes host/VPS integration belongs to P7; deployed latency/resource benchmarking belongs to P7/P8
Blockers: none for LOCAL FUNCTIONAL verification

### P5 — Reliability, security, lifecycle, reconnect/idempotency/TTL

Status: VERIFIED — BACKEND
Authorized by: explicit user instruction in chat
Started at: 2026-07-19
Verified at: 2026-07-19
Commit: `feat: implement P5 reliability security and lifecycle`
Files changed: recorded in `P5-TEST-EVIDENCE.md`
Requirements implemented: request idempotency, duplicate conflict handling, public status mapping, tombstone retention and GC, WebSocket heartbeat/reconnect verification, playback done/failed idempotency, temp WAV/MP3 lifecycle, MP3 TTL expiry and `410 AUDIO_EXPIRED`, startup cleanup, total-timeout cancellation, timeout/failure mapping, security hardening, fake ESP32 soak instrumentation, and full regression evidence
Commands run: `python scripts/verify-backend-mvp-docs.py`, backend `npm test`, `npm test -- p5`, `npm run typecheck`, `npm run build`, `npm audit`, `npm run fake-esp32`, `npm run soak-p5-idle-ws`, `npm run verify-p4-full-pipeline`, audio-service `.venv\Scripts\python.exe -m pytest`, `compileall`, `pip check`, and standalone `ffprobe`
Test result: latest 2026-07-19 rerun: backend 21 files / 99 tests passed; backend P5 targeted 7 files / 29 tests passed; audio-service 48 tests passed; one-hour idle soak passed; post-soak full local pipeline passed; typecheck/build/audit/docs verifier/fake ESP32/compileall/pip check/ffprobe passed
Contract consistency: public backend interface, WebSocket event set, hardware contract, and PRD locked decisions must remain unchanged
PRD consistency: P5 reliability/security/lifecycle behavior matches PRD/backend MVP voice pipeline guardrails; VPS deployment/public integration (P7) and deployed resource/RVC benchmark (P8) remain out of scope
Known limitations: real RVC inference remains deferred to P8; public VPS deployment belongs to P7; resource/RVC benchmark belongs to P8; physical ESP32 remains P10/HW-INTEGRATION-01
Blockers: none for BACKEND verification
