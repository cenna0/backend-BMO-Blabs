# BMO Documentation — Start Here

**Last audited:** 2026-08-04
**Purpose:** Documentation entry point for the verified voice MVP and the P9
final application-platform architecture.

## 1. What to read

### Hardware / firmware team

Read these in order:

1. [`hardware-handoff/README.md`](hardware-handoff/README.md) — concise implementation guide.
2. [`hardware-handoff/CURRENT-STATUS.md`](hardware-handoff/CURRENT-STATUS.md) — what is actually verified vs still pending.
3. [`hardware-handoff/DEPLOYMENT-CONFIG.md`](hardware-handoff/DEPLOYMENT-CONFIG.md) — live endpoint gate and deployment-specific values.
4. [`hardware-handoff/AGENT-CONTEXT.md`](hardware-handoff/AGENT-CONTEXT.md) — deterministic context for a coding agent.
5. [`hardware-handoff/FIRMWARE-CHECKLIST.md`](hardware-handoff/FIRMWARE-CHECKLIST.md) — implementation checklist.
6. [`hardware-handoff/ACCEPTANCE-TESTS.md`](hardware-handoff/ACCEPTANCE-TESTS.md) — end-to-end verification matrix.
7. [`hardware-contract/BMO-MVP-HW-INTERFACE-CONTRACT-v1.0.5.md`](hardware-contract/BMO-MVP-HW-INTERFACE-CONTRACT-v1.0.5.md) — canonical protocol contract.

The handoff pack is intentionally shorter than the canonical contract. It must not invent or change protocol behavior.

### Backend / infrastructure developer / Codex

For the **next implementation action**, read:

1. [`NEXT-ACTION.md`](NEXT-ACTION.md) — current next phase and exact execution boundary.
2. [`backend-mvp/P8-PRODUCTION-ROLLOUT-EVIDENCE.md`](backend-mvp/P8-PRODUCTION-ROLLOUT-EVIDENCE.md) — verified P8 production evidence.
3. [`backend-mvp/IMPLEMENTATION-STATUS.md`](backend-mvp/IMPLEMENTATION-STATUS.md) — current phase/status authority.
4. [`backend-mvp/CURRENT-RUNTIME-CONFIG.md`](backend-mvp/CURRENT-RUNTIME-CONFIG.md) — current STT/TTS deployment values.
5. [`backend-mvp/00-AGENT-EXECUTION-GUIDE.md`](backend-mvp/00-AGENT-EXECUTION-GUIDE.md) — general agent rules.

Then use the active backend references as needed:

1. [`backend-mvp/01-SCOPE-AND-DECISIONS.md`](backend-mvp/01-SCOPE-AND-DECISIONS.md)
2. [`backend-mvp/02-API-AND-WEBSOCKET-CONTRACT.md`](backend-mvp/02-API-AND-WEBSOCKET-CONTRACT.md)
3. [`backend-mvp/03-BACKEND-ARCHITECTURE.md`](backend-mvp/03-BACKEND-ARCHITECTURE.md)
4. [`backend-mvp/04-AUDIO-SERVICE.md`](backend-mvp/04-AUDIO-SERVICE.md)
5. [`backend-mvp/05-TESTING-AND-ACCEPTANCE.md`](backend-mvp/05-TESTING-AND-ACCEPTANCE.md)
6. [`backend-mvp/06-DEPLOYMENT-AND-OPERATIONS.md`](backend-mvp/06-DEPLOYMENT-AND-OPERATIONS.md)
7. [`operations/MAINTENANCE-AND-RECOVERY.md`](operations/MAINTENANCE-AND-RECOVERY.md) — host maintenance/update/recovery rules.
8. [`roadmap/P6-P10-ROADMAP.md`](roadmap/P6-P10-ROADMAP.md)
9. [`p9/README.md`](p9/README.md) — P9 architecture and product lock; proposal only until implementation evidence exists.
10. [`roadmap/P8-EXECUTION-SPEC.md`](roadmap/P8-EXECUTION-SPEC.md) — historical P8 closure/specification record.

[`roadmap/P6-EXECUTION-SPEC.md`](roadmap/P6-EXECUTION-SPEC.md) remains the
historical locked P6 execution record and is not the current next-phase action.

## 2. Source-of-truth hierarchy

If two documents disagree, use this order:

1. **Hardware ↔ backend public protocol:** `hardware-contract/BMO-MVP-HW-INTERFACE-CONTRACT-v1.0.5.md`.
2. **Current STT/TTS runtime values:** `backend-mvp/CURRENT-RUNTIME-CONFIG.md`.
3. **Actual implementation status/evidence:** `backend-mvp/IMPLEMENTATION-STATUS.md` plus the latest phase/manual evidence.
4. **Backend/audio implementation details:** active `backend-mvp/` reference documents.
5. **Deployment-specific values:** `hardware-handoff/DEPLOYMENT-CONFIG.md` after those values are marked `VERIFIED`.
6. **P9 platform architecture:** `p9/README.md` and linked documents; these
   are proposed boundaries and do not claim implementation.
7. **Product context:** `product/BMO-BY-BLABS-PRD-v1.2.4.md`.
8. **Archive:** `archive/` is historical reference only.

Never resolve a conflict by silently changing firmware behavior or adding a new endpoint/event.

## 2.1 Operational next-step authority

`NEXT-ACTION.md` determines **what the coding agent should execute next**. It
does not override the protocol/runtime source-of-truth hierarchy above. At this
revision, **P6, P7, and P8 are verified**, with P8 production using Piper
Prudence primary, Kokoro fallback, and RVC disabled. P9.1 architecture is
approved and locked, while P9 implementation remains
`NOT_STARTED / AWAITING EXPLICIT USER AUTHORIZATION`; its architecture is
documented under `p9/`. Later phases must not be collapsed into one execution
turn.

P7 is `VERIFIED — PRODUCTION`; real RVC inference is not verified and is not a
production dependency; its compact evidence and Git history are archived.

## 2.2 Hermes host bootstrap clarification

The 2026-07-27 production VPS preflight reported Hermes absent. P6 re-confirmed
the `ABSENT` branch and bootstrapped Hermes 0.19.0 as a loopback-only host
runtime. Current evidence is in
[`backend-mvp/P6-TEST-EVIDENCE.md`](backend-mvp/P6-TEST-EVIDENCE.md). The branch
rules remain:

- `PRESENT` → audit and preserve the proven installation; never reinstall/migrate for cleanliness.
- `ABSENT` → P6 bootstraps a maintainable host runtime bound only to `127.0.0.1:8642`, then records health, ownership, paths, startup/restart, and recovery evidence.

P7 integrated backend/audio with the P6-verified Hermes API in production; it
did not install Hermes. This operational clarification supersedes the earlier
“existing Hermes” assumption for phase execution, but does not modify the
locked PRD snapshot or hardware contract.

## 3. Current verified boundary

At this audit point:

- the production backend and Audio Service are deployed from immutable images;
- public HTTPS/WSS, sanitized readiness, canonical transport/lifecycle behavior,
  and fake-ESP32 public acceptance are verified with `23/23` checks passed;
- faster-whisper, Piper, Kokoro fallback, and FFmpeg are real production
  dependencies running from curated offline model artifacts;
- Hermes `/v1/responses` integration is verified in production through the
  private `127.0.0.1:8642` origin;
- **Piper Prudence is the fixed P8 production primary**, with Kokoro `af_heart`
  at speed `0.80` as fallback; `RVC_ENABLED=false` and no RVC runtime artifact
  is in production;
- **physical ESP32 integration is not verified** and belongs to P10;
- PostgreSQL/Prisma is not implemented or deployed; it belongs to P9.1 and
  remains blocked until a separate implementation authorization.

The hardware team may use
[`hardware-handoff/DEPLOYMENT-CONFIG.md`](hardware-handoff/DEPLOYMENT-CONFIG.md)
as the verified live endpoint source. The public fake-client result does not
equal `HARDWARE INTEGRATION VERIFIED`; that classification requires P10
physical ESP32 evidence.

## 4. Important current implementation override

The original MVP documents used faster-whisper `small` as a benchmarkable baseline. Local STT accuracy investigation selected the current implementation setting:

```text
WHISPER_MODEL=medium
WHISPER_HOTWORDS=BMO
WHISPER_DEVICE=cpu
WHISPER_COMPUTE_TYPE=int8
WHISPER_CPU_THREADS=4
WHISPER_WORKERS=1
WHISPER_BEAM_SIZE=5
WHISPER_VAD=true
language=None / auto-detect

KOKORO_LANG_CODE=a
KOKORO_VOICE=af_heart
KOKORO_SPEED=0.80
```

`KOKORO_SPEED=0.80` is the verified fallback value selected after manual
listening UAT. Piper Prudence is the production primary; archived RVC evidence
does not represent a production dependency, and the firmware/public hardware
contract does not change.

These runtime changes do **not** change the hardware API contract or WAV format. See [`backend-mvp/CURRENT-RUNTIME-CONFIG.md`](backend-mvp/CURRENT-RUNTIME-CONFIG.md), [`backend-mvp/P5-STT-ACCURACY-INVESTIGATION.md`](backend-mvp/P5-STT-ACCURACY-INVESTIGATION.md), and [`backend-mvp/P5-MANUAL-TEST-EVIDENCE.md`](backend-mvp/P5-MANUAL-TEST-EVIDENCE.md).

## 4.1 P9 architecture boundary

P9 architecture is documented under [`p9/`](p9/). PostgreSQL is the proposed
application source of truth; chat history, curated memory, schedules,
integrations, and settings are proposed Backend-owned capabilities. No P9
runtime is installed or active from this documentation branch.

## 5. Secrets

No real device token, Hermes API key, database password, Telegram bot token, or other credential belongs in this folder.

Hardware credentials are handed off out-of-band. Documentation uses placeholders such as:

```text
DEVICE_TOKEN=PROVIDED_OUT_OF_BAND
```

## 6. Audit record

Use [`audit/README.md`](audit/README.md) and the newest final verification in `audit/`. Intermediate audit reports are archived because they describe superseded document states.
