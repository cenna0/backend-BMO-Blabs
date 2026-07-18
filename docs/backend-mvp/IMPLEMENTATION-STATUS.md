# BMO Backend MVP — Implementation Status

**Last updated:** 2026-07-19  
**Documentation package version:** 1.0.1

## 1. Control state

```text
Documentation package: VERIFIED
Active implementation phase: P1
Implementation authorization: P1 ONLY
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
| P1 | Core backend transport + hardware test mode: health, WS auth/state, raw WAV upload, dummy MP3, fake ESP32 basic | 01, 02, 03, 05, 06 | IMPLEMENTED | AUTHORIZED BY USER | [`P1-TEST-EVIDENCE.md`](P1-TEST-EVIDENCE.md); physical ESP32 verification still open |
| P2 | Audio Service bootstrap + faster-whisper STT | 01, 03, 04, 05, 06 | NOT_STARTED | NOT AUTHORIZED | — |
| P3 | Kokoro + FFmpeg + RVC fallback | 01, 03, 04, 05, 06 | NOT_STARTED | NOT AUTHORIZED | — |
| P4 | Hermes adapter + full voice pipeline orchestration | 01, 02, 03, 04, 05 | NOT_STARTED | NOT AUTHORIZED | — |
| P5 | Reliability, security, lifecycle, full automated test, reconnect/idempotency/TTL | 01, 02, 03, 05, 06 | NOT_STARTED | NOT AUTHORIZED | — |
| P6 | VPS integration, benchmark, staging, final report | 01–06 | NOT_STARTED | NOT AUTHORIZED | — |

## 4. Phase ownership and dependency

```text
P1 → P2 → P3 → P4 → P5 → P6
```

- P1 diprioritaskan agar tim hardware dapat menguji kontrak transport tanpa menunggu AI stack.
- P2/P3 dapat memakai internal test harness, tetapi tidak boleh mengubah public interface.
- P4 menyatukan seluruh pipeline setelah komponen individual terbukti.
- P5 menutup edge case dan membuktikan acceptance criteria lengkap.
- P6 menjalankan integration/benchmark pada environment VPS asli.

## 5. Status transition checklist

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

## 6. Evidence template per phase

```md
### Pn — <name>
Status:
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

## 7. Phase evidence

### P1 — Core Backend Transport & Hardware Test Mode

Status: IMPLEMENTED — not VERIFIED  
Authorized by: explicit user instruction in chat  
Started at: 2026-07-19  
Verified at: —  
Commit: `feat: implement P1 core backend transport and hardware test mode`  
Files changed: recorded in `P1-TEST-EVIDENCE.md`  
Requirements implemented: health, WS auth/state/heartbeat, raw WAV validation/upload, one active request, dummy MP3 URL/download, basic playback cleanup, fake ESP32 basic  
Commands run: `npm test`, `npm run typecheck`, `npm run build`, `npm audit`, `npm run fake-esp32`, `ffprobe`, `python scripts/verify-backend-mvp-docs.py`  
Test result: latest 2026-07-19 rerun: 10 files / 50 tests passed; typecheck/build/audit/docs verifier/fake ESP32/ffprobe passed  
Contract consistency: automated contract tests and canonical verifier passed on latest 2026-07-19 rerun  
PRD consistency: P1 transport/hardware-test subset matches PRD §§1.3, 4.2, 5, 8, 9, 15.3, 16  
Known limitations: no physical ESP32 decoder/progressive playback test; no one-hour wall-clock idle soak; P2–P6 deliberately absent  
Blockers: physical hardware evidence required before P1 can be marked VERIFIED
