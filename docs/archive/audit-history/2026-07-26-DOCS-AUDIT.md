# BMO Docs Audit — 2026-07-26

**Scope:** full uploaded `docs/` archive  
**Primary objective:** make the documentation usable as a hardware ↔ backend handoff without requiring backend source reading.

## 1. Audit boundary and honesty note

The uploaded archive contained documentation only. It did **not** contain the backend/audio-service source tree itself.

Therefore this audit did two different checks:

1. **Direct documentation consistency:** canonical hardware contract, backend API contract, product PRD, deployment docs, phase plans/status, and handoff material were compared directly.
2. **Implementation consistency by evidence:** actual implementation behavior was compared against the implementation/test/manual evidence already present in `docs/backend-mvp/`, including referenced source/test paths, test counts, manual HTTP/WS observations, ffprobe results, soak evidence, Hermes real addendum, and STT accuracy investigation.

This audit does **not** claim a fresh line-by-line source-code review because source files were not included in the uploaded ZIP. A fresh source audit should be rerun by Codex against the Git repository before/deuring P7 deployment.

## 2. Canonical files preserved

The following canonical source snapshots were intentionally left byte-for-byte unchanged:

| File | SHA-256 |
|---|---|
| `hardware-contract/BMO-MVP-HW-INTERFACE-CONTRACT-v1.0.5.md` | `633e398a7fa39a3ebc469af7f9ca46fd04890339bb132ec7de2c2286207c6a44` |
| `product/BMO-BY-BLABS-PRD-v1.2.0.md` | `77b4bba8333aa277201976b024466d85c10257b13a63d5f5824b6c94555b70b8` |
| `archive/BMO-MVP-BACKEND-IMPLEMENTATION-FOR-HERMES-v1.0.5.md` | `d1554d8d2cdbd6e32cf7acca75ce17031adcc47463b8577f64cdc288fa076853` |

The PRD remains product context. Current implementation/deployment overrides are documented in active backend/handoff files rather than rewriting the historical PRD snapshot.

## 3. Main problems found

### A. No completed hardware handoff pack

The uploaded docs contained a design/implementation plan for a future handoff pack, but the actual `docs/hardware-handoff/` files did not exist.

Impact: hardware engineers/coding agents still had to read long canonical/backend documents and infer an implementation sequence.

Resolution: created an operational handoff folder with concise protocol, status, deployment, checklist, coding-agent context, and acceptance tests.

### B. Internal planning documents contained unresolved/broken links

The old `docs/superpowers/` plan referenced handoff files/scripts that had not been created and had multiple broken relative links.

Impact: the whole `docs` folder could not be treated as a clean handoff package.

Resolution: internal superpowers planning material was removed from the final handoff ZIP. The actual handoff files now exist as first-class docs.

### C. Static phase status was stale

`00-AGENT-EXECUTION-GUIDE.md` still said the active state was `NONE`, next phase P1, while `IMPLEMENTATION-STATUS.md` showed P5 and evidence files showed P1–P5 work had already happened.

Impact: a new agent could incorrectly think implementation had not started.

Resolution:

- converted the P1 bootstrap marker into an explicit historical snapshot;
- made `IMPLEMENTATION-STATUS.md` the current phase authority;
- marked no future phase as automatically authorized.

### D. Original P6 became too broad/outdated

The old P6 meant roughly “VPS integration/benchmark/staging/final report”. Subsequent project decisions added:

- Linux user/permission model;
- `/opt/bmo` persistent layout;
- Git `main` as production source;
- immutable Docker image runtime;
- Caddy;
- `api.personalbmo.web.id` and `monitor.personalbmo.web.id`;
- HTTPS/WSS;
- Tailscale admin path / SSH migration;
- firewall/public-port policy;
- Beszel + Telegram alerting;
- backup/restore/rollback;
- real RVC verification;
- PostgreSQL/Prisma readiness;
- public fake-ESP32 E2E and physical hardware handoff.

Impact: forcing all of this into one P6 would create unnecessary context/risk.

Resolution: proposed dependency-based P6–P10 roadmap in `roadmap/P6-P10-ROADMAP.md`.

### E. STT documentation was outdated

Active references still presented faster-whisper `small` as the implementation configuration, but `P5-STT-ACCURACY-INVESTIGATION.md` shows the selected fix:

```text
WHISPER_MODEL=medium
WHISPER_HOTWORDS=BMO
```

while keeping CPU INT8, 4 threads, 1 worker, beam 5, VAD, and language auto-detect.

Impact: deployment could load the wrong model and reproduce the known poor transcript.

Resolution:

- updated active Audio Service reference to `medium` + `BMO` hotword;
- kept P2 `small` references as historical evidence of what P2 originally verified;
- explicitly require VPS resource/latency benchmark before deployment verification.

### F. Deployment layout was obsolete for the current plan

Old deployment documentation used `/opt/bmo-mvp`, direct staging IP/port flows, and did not include the newly agreed persistent/source split, Caddy/Beszel/Tailscale/DB/backup plan.

Resolution: rewrote the active deployment/operations reference around `/opt/bmo`, Git/image separation, external config/secrets, production domain, monitoring, backup, rollback, and hardware handoff gate.

### G. RVC status could be misunderstood

RVC orchestration, model asset verification, and Kokoro fallback exist, but real RVC inference was not proven.

Resolution: every new handoff/current-status document explicitly distinguishes:

```text
RVC integration/fallback: implemented
real RVC inference: NOT VERIFIED
firmware protocol impact: none; output remains MP3 through audio_ready
```

### H. Public domain could be mistaken as already live

The agreed target is:

```text
https://api.personalbmo.web.id
wss://api.personalbmo.web.id/ws
```

but BMO backend public deployment had not been verified in the evidence archive.

Resolution: `hardware-handoff/DEPLOYMENT-CONFIG.md` starts with `DEPLOYMENT_STATUS: NOT_VERIFIED`. Hardware is told not to treat the endpoint as live until P7 updates it with evidence.


### I. Minor playback-completion ordering ambiguity inside the canonical material

Detailed hardware-contract prose places `idle`/buffer cleanup before sending `audio_playback_done`, while higher-level flow/state descriptions can be read as completion event first and idle immediately after.

Protocol consequence: none, as long as `audio_playback_done` is never sent before playback actually finishes.

Resolution in handoff: document the three completion actions together — playback must be finished, then firmware performs local idle/cleanup and sends `audio_playback_done` as the completion signal. No backend contract field/event was changed.

## 4. Public protocol cross-check

The canonical hardware contract and active backend API contract agree on the public route set:

```text
WS   /ws
POST /api/v1/voice
GET  /audio/:audioId.mp3
```

Backend additionally exposes diagnostic `GET /health`.

### ESP32 → Backend events verified consistent

```text
authenticate
audio_playback_done
audio_playback_failed
```

### Backend → ESP32 events verified consistent

```text
authenticated
authentication_failed
connection_replaced
display_status
audio_ready
request_failed
```

### Critical negative assertions preserved

- no audio over WebSocket;
- no `audio_chunk`;
- no `wake_word_detected` public event;
- no `audio_ready_received` acknowledgment;
- no `listening` display mode;
- raw WAV upload, not multipart;
- backend controls only `thinking` display state.

### Upload/error vocabulary preserved

The handoff documents cover canonical upload outcomes including:

```text
MISSING_REQUIRED_HEADER
INVALID_REQUEST_ID
INVALID_DEVICE_CREDENTIALS
WEBSOCKET_NOT_CONNECTED
DEVICE_BUSY
REQUEST_ID_CONFLICT
UNSUPPORTED_AUDIO_TYPE
AUDIO_TOO_LARGE
INVALID_AUDIO_FORMAT
```

and pipeline errors:

```text
NO_SPEECH
INVALID_AUDIO
STT_FAILED
HERMES_FAILED
TTS_FAILED
AUDIO_EXPIRED
PIPELINE_TIMEOUT
INTERNAL_ERROR
```

### Reconnect/idempotency rules preserved

- UUID v4 generated by ESP32;
- retry same recording → same request ID and bytes;
- duplicate check before `DEVICE_BUSY`;
- duplicate same body does not create second pipeline;
- same request ID with different bytes/device → `REQUEST_ID_CONFLICT`;
- `backend_state` resynchronization after reconnect;
- replay `audio_ready` only while result remains valid;
- duplicate `audio_ready` must never produce double playback;
- playback completion/failure can be resent idempotently.

## 5. Implementation evidence captured in the handoff

Evidence files indicate the following without overclaiming public deployment:

- backend P5 automated suite passed its recorded reliability/security/lifecycle checks;
- one-hour idle WebSocket soak passed with ping/pong and no disconnect;
- raw upload, duplicate/conflict, reconnect, playback failure, and expiry cases have manual local observations;
- faster-whisper real local English/Indonesian/mixed/no-speech behavior was tested;
- Kokoro and FFmpeg generated valid MP3 locally;
- Hermes real `/v1/responses` local integration was observed in the P5 manual addendum;
- real RVC inference remains outstanding;
- physical ESP32 remains outstanding;
- public VPS/domain deployment remains outstanding.

## 6. Files added

```text
README.md
hardware-handoff/README.md
hardware-handoff/CURRENT-STATUS.md
hardware-handoff/DEPLOYMENT-CONFIG.md
hardware-handoff/FIRMWARE-CHECKLIST.md
hardware-handoff/ACCEPTANCE-TESTS.md
hardware-handoff/AGENT-CONTEXT.md
roadmap/P6-P10-ROADMAP.md
audit/2026-07-26-DOCS-AUDIT.md
audit/2026-07-26-VERIFICATION.md
```

## 7. Files materially updated

```text
backend-mvp/00-AGENT-EXECUTION-GUIDE.md
backend-mvp/01-SCOPE-AND-DECISIONS.md
backend-mvp/04-AUDIO-SERVICE.md
backend-mvp/05-TESTING-AND-ACCEPTANCE.md
backend-mvp/06-DEPLOYMENT-AND-OPERATIONS.md
backend-mvp/IMPLEMENTATION-STATUS.md
backend-mvp/VERIFICATION-REPORT.md
backend-mvp/CHANGELOG.md
```

`docs/superpowers/` internal planning files were removed from the final handoff package because they were not authoritative and contained unresolved references to files/scripts that did not exist in the uploaded archive.

## 8. Hardware usability assessment

### Can a human hardware engineer implement from this folder without backend source?

**YES for the protocol/firmware implementation.** The quick guide, exact payloads, retry/error behavior, state ownership, lifecycle, and physical acceptance tests are now directly available.

### Can a hardware coding agent implement without major assumptions?

**YES for the firmware protocol**, provided the agent receives the handoff folder + canonical contract and obeys the authority rules in `AGENT-CONTEXT.md`.

### Can the hardware team connect to the real production backend immediately?

**NOT YET PROVEN.** The public endpoint target is documented but remains `NOT_VERIFIED` until P7 deploys and runs external fake-device E2E.

This distinction is intentional: documentation is implementation-ready without fabricating deployment availability.

## 9. Recommended next execution order

Use:

```text
P6  VPS foundation/security/monitoring/backup
P7  deploy backend/audio + Hermes + public HTTPS/WSS E2E
P8  real RVC + resource benchmark
P9  PostgreSQL/Prisma readiness + restore proof
P10 activate endpoint handoff + physical ESP32 acceptance
```

See `roadmap/P6-P10-ROADMAP.md` for inputs, outputs, dependencies, and acceptance criteria.

## 10. Re-verification requirement before final physical handoff

When P7/P8/P10 run, Codex must perform a fresh source-aware verification against the real Git checkout because this audit did not receive source code.

Required loop:

```text
source audit
→ compare canonical hardware contract
→ deploy/test
→ update deployment config/evidence
→ re-audit handoff
→ physical ESP32 tests
```

Only then mark `DEPLOYMENT_STATUS: VERIFIED` and later `HARDWARE INTEGRATION VERIFIED`.
