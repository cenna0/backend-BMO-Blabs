# BMO Backend MVP — Implementation Status

**Last updated:** 2026-07-19  
**Documentation package version:** 1.0.1

## 1. Control state

```text
Documentation package: VERIFIED
Active implementation phase: P2
Implementation authorization: P2 ONLY
```

Coding agent tidak boleh mulai mengubah source code sampai user mengotorisasi satu phase secara eksplisit.

## 2. Documentation status

| Document | Status | Verification |
|---|---|---|
| `00-AGENT-EXECUTION-GUIDE.md` | VERIFIED | Workflow, boundary, phase control, stop condition tersedia |
| `01-SCOPE-AND-DECISIONS.md` | VERIFIED / LOCKED | Backend source §1–§3 termigrasi |
| `02-API-AND-WEBSOCKET-CONTRACT.md` | VERIFIED / LOCKED | Backend source §15–§17, §22 dan hardware contract dicocokkan |
| `03-BACKEND-ARCHITECTURE.md` | VERIFIED | Backend source §7–§8, §18–§21, §23–§24 termigrasi |
| `04-AUDIO-SERVICE.md` | VERIFIED | Backend source §9–§14 termigrasi |
| `05-TESTING-AND-ACCEPTANCE.md` | VERIFIED | Backend source §27, §30–§31 termigrasi |
| `06-DEPLOYMENT-AND-OPERATIONS.md` | VERIFIED | Backend source §4–§6, §25–§26, §28–§29, §32–§33 termigrasi |
| `REQUIREMENT-TRACEABILITY.md` | VERIFIED | Seluruh source §1–§33 memiliki target primary |
| `VERIFICATION-REPORT.md` | VERIFIED | Structural dan consistency checks lulus |
| `CHANGELOG.md` | VERIFIED | Baseline package tercatat |

## 3. Implementation phases

| Phase | Scope | Required docs | Status | Authorization | Evidence |
|---|---|---|---|---|---|
| P1 | Core backend transport + hardware test mode: health, WS auth/state, raw WAV upload, dummy MP3, fake ESP32 basic | 01, 02, 03, 05, 06 | VERIFIED — BACKEND | AUTHORIZED BY USER | [`P1-TEST-EVIDENCE.md`](P1-TEST-EVIDENCE.md); external hardware validation deferred |
| P2 | Audio Service bootstrap + faster-whisper STT | 01, 03, 04, 05, 06 | AUTHORIZED | AUTHORIZED BY USER | P2 implementation plan required before coding |
| P3 | Kokoro + FFmpeg + RVC fallback | 01, 03, 04, 05, 06 | NOT_STARTED | NOT AUTHORIZED | — |
| P4 | Hermes adapter + full voice pipeline orchestration | 01, 02, 03, 04, 05 | NOT_STARTED | NOT AUTHORIZED | — |
| P5 | Reliability, security, lifecycle, full automated test, reconnect/idempotency/TTL | 01, 02, 03, 05, 06 | NOT_STARTED | NOT AUTHORIZED | — |
| P6 | VPS integration, benchmark, staging, final report | 01–06 | NOT_STARTED | NOT AUTHORIZED | — |

## 4. Verification types

```text
BACKEND VERIFIED
```

Phase backend terbukti melalui unit test, integration test, fake ESP32, typecheck, build, dependency audit, documentation verifier, contract consistency, PRD consistency, dan scope audit lokal.

```text
DEPLOYMENT VERIFIED
```

Phase deployment terbukti setelah service berjalan di VPS dan endpoint staging tersedia.

```text
HARDWARE INTEGRATION VERIFIED
```

Integrasi hardware terbukti bersama tim hardware memakai physical ESP32 setelah endpoint staging tersedia.

Physical ESP32 test dan progressive hardware playback tetap requirement final, tetapi bukan blocker untuk melanjutkan development backend P2–P6. Perubahan ini hanya memperbaiki klasifikasi verification; tidak mengurangi requirement hardware final.

## 5. Phase ownership and dependency

```text
P1 → P2 → P3 → P4 → P5 → P6
```

- P1 diprioritaskan agar tim hardware dapat menguji kontrak transport tanpa menunggu AI stack.
- P2/P3 dapat memakai internal test harness, tetapi tidak boleh mengubah public interface.
- P4 menyatukan seluruh pipeline setelah komponen individual terbukti.
- P5 menutup edge case dan membuktikan acceptance criteria lengkap.
- P6 menjalankan integration/benchmark pada environment VPS asli.
- Idle WebSocket soak satu jam menjadi bagian P5 reliability verification, bukan blocker untuk memulai P2.

## 6. External integration milestones

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

Status: AUTHORIZED  
Authorized by: explicit user instruction in chat  
Started at: —  
Verified at: —  
Commit: —  
Files changed: —  
Requirements implemented: —  
Commands run: —  
Test result: —  
Contract consistency: pending  
PRD consistency: pending  
Known limitations: P3–P6 remain not authorized  
Blockers: P2 implementation plan required before coding
