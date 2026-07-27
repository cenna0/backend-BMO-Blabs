# BMO Documentation — Start Here

**Last audited:** 2026-07-27
**Purpose:** Single documentation entry point for BMO voice MVP, especially hardware ↔ backend integration.

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
2. [`roadmap/P6-EXECUTION-SPEC.md`](roadmap/P6-EXECUTION-SPEC.md) — detailed P6 execution contract.
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

## 2. Source-of-truth hierarchy

If two documents disagree, use this order:

1. **Hardware ↔ backend public protocol:** `hardware-contract/BMO-MVP-HW-INTERFACE-CONTRACT-v1.0.5.md`.
2. **Current STT/TTS runtime values:** `backend-mvp/CURRENT-RUNTIME-CONFIG.md`.
3. **Actual implementation status/evidence:** `backend-mvp/IMPLEMENTATION-STATUS.md` plus the latest phase/manual evidence.
4. **Backend/audio implementation details:** active `backend-mvp/` reference documents.
5. **Deployment-specific values:** `hardware-handoff/DEPLOYMENT-CONFIG.md` after those values are marked `VERIFIED`.
6. **Product context:** `product/BMO-BY-BLABS-PRD-v1.2.4.md`.
7. **Archive:** `archive/` is historical reference only.

Never resolve a conflict by silently changing firmware behavior or adding a new endpoint/event.

## 2.1 Operational next-step authority

`NEXT-ACTION.md` determines **what the coding agent should execute next**. It does not override the protocol/runtime source-of-truth hierarchy above. At this revision, the next phase is **P6**, and later phases must not be collapsed into the same execution turn.

## 2.2 Hermes host bootstrap clarification

The 2026-07-27 production VPS preflight reported Hermes absent. The P6 executor must still re-confirm `PRESENT` or `ABSENT` from process/service/path/runtime/listener evidence before changing the host:

- `PRESENT` → audit and preserve the proven installation; never reinstall/migrate for cleanliness.
- `ABSENT` → P6 bootstraps a maintainable host runtime bound only to `127.0.0.1:8642`, then records health, ownership, paths, startup/restart, and recovery evidence.

P7 integrates backend/audio with the P6-verified Hermes API; it does not install Hermes. This operational clarification supersedes the earlier “existing Hermes” assumption for phase execution, but does not modify the locked PRD snapshot or hardware contract.

## 3. Current verified boundary

At this audit point:

- backend HTTP/WebSocket transport, idempotency, reconnect, lifecycle, security guardrails, and failure mapping have local backend evidence;
- faster-whisper, Kokoro, and FFmpeg have real local evidence;
- Hermes real `/v1/responses` has local integration evidence;
- RVC model assets and fallback behavior exist, but **real RVC inference is not yet verified**;
- BMO backend has **not yet been verified as deployed on the VPS through the public production domain**;
- physical ESP32 integration has **not yet been verified**.

Therefore the protocol documentation is implementation-ready, but hardware must not treat a public endpoint as available until `hardware-handoff/DEPLOYMENT-CONFIG.md` says `DEPLOYMENT_STATUS: VERIFIED`.

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

`KOKORO_SPEED=0.80` is the current deployment target selected after manual listening UAT. Real RVC integration must revalidate perceived tempo, but the firmware/public hardware contract does not change.

These runtime changes do **not** change the hardware API contract or WAV format. See [`backend-mvp/CURRENT-RUNTIME-CONFIG.md`](backend-mvp/CURRENT-RUNTIME-CONFIG.md), [`backend-mvp/P5-STT-ACCURACY-INVESTIGATION.md`](backend-mvp/P5-STT-ACCURACY-INVESTIGATION.md), and [`backend-mvp/P5-MANUAL-TEST-EVIDENCE.md`](backend-mvp/P5-MANUAL-TEST-EVIDENCE.md).

## 5. Secrets

No real device token, Hermes API key, database password, Telegram bot token, or other credential belongs in this folder.

Hardware credentials are handed off out-of-band. Documentation uses placeholders such as:

```text
DEVICE_TOKEN=PROVIDED_OUT_OF_BAND
```

## 6. Audit record

Use [`audit/README.md`](audit/README.md) and the newest final verification in `audit/`. Intermediate audit reports are archived because they describe superseded document states.
