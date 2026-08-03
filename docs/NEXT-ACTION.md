# BMO — Next Execution Action

**Last updated:** 2026-08-03
**Audience:** Codex / infrastructure-backend coding agent
**Current next phase:** **P9 — PostgreSQL and persistent user/device data**
**Phase state:** `P8_PIPER_PRODUCTION_ROLLED_BACK; P9 NOT_STARTED / AWAITING EXPLICIT USER AUTHORIZATION`

> P8 is `P8_PIPER_PRODUCTION_ROLLED_BACK`; P7 is restored. P8 completion does
> **not** authorize P9. A future P9 run requires a new explicit instruction such as **“execute P9”**
> or equivalent.

## 1. Current checkpoint

P6 VPS Foundation and Operations Baseline remains `VERIFIED`. P7 backend,
Audio Service, and Hermes production integration is `VERIFIED — PRODUCTION`.
P7 is `VERIFIED — PRODUCTION`. P8 is `P8_PIPER_PRODUCTION_ROLLED_BACK` and P7
is restored. P8 completion does **not** authorize P9. Do not execute P10 from
this gate.
Sanitized proof is in
[`backend-mvp/P7-TEST-EVIDENCE.md`](backend-mvp/P7-TEST-EVIDENCE.md).

Verified P7 outcomes include:

- immutable deployment source
  `4d7b472adc4c2243d8f7364032a491ad70efb6d3`;
- backend image
  `bmo-backend@sha256:e981751498fca13bf1f1c1c046a6874a490b3e681aeef9787a53181059506fd7`;
- Audio Service image
  `bmo-audio@sha256:62d8b48feb978e303831e20dc558cb95d3240af9a3cf09e8dcd0c82142986e7e`;
- verified public HTTPS API and WSS at `api.personalbmo.web.id`;
- private origins only: backend `127.0.0.1:3000`, Audio Service
  `127.0.0.1:8001`, and Hermes `127.0.0.1:8642`;
- production Whisper/Kokoro inference from pinned curated artifacts with
  runtime downloads disabled, plus FFmpeg output;
- production Hermes integration through the P6 host runtime;
- public fake-ESP32 acceptance passed `23/23`;
- final resource soak passed for 3,665 seconds / 61 minutes 5 seconds with
  `13/13` samples, zero new OOM events, and zero backend/audio restarts;
- minimum `MemAvailable` was 3.209 GiB and minimum relevant free disk was
  59.137 GiB;
- protected backup `20260730T115645Z` and the P6 Caddy rollback anchor remain
  retained;
- [`hardware-handoff/DEPLOYMENT-CONFIG.md`](hardware-handoff/DEPLOYMENT-CONFIG.md)
  is the verified live endpoint handoff.

The restored production uses Kokoro `af_heart` at `0.80`; the approved fixed
Piper Prudence candidate passed its canary but was rolled back. RVC remains
disabled. Physical ESP32 acceptance is not run, and PostgreSQL/Prisma is not
implemented or deployed.

## 2. Locked execution order

```text
P6 VPS foundation                         VERIFIED
  ↓
P7 backend/audio production deployment   VERIFIED — PRODUCTION
  ↓ explicit new authorization required
P8 fixed Piper primary + Kokoro fallback ROLLED BACK — P7 RESTORED
  ↓ completed/verified status + explicit authorization
P9 PostgreSQL + Prisma readiness         NOT_STARTED / dependency-gated
  ↓ VERIFIED + explicit authorization
P10 physical ESP32 acceptance            NOT_STARTED / dependency-gated
```

Do not collapse phases or infer execution authority from technical readiness.
P8 completion does not automatically start P9.

## 3. Read before a future P9 execution

Read in this order:

1. `NEXT-ACTION.md` — this operational gate.
2. `backend-mvp/P8-PRODUCTION-ROLLOUT-EVIDENCE.md` — closed P8 evidence.
3. `roadmap/P8-EXECUTION-SPEC.md` — P8 closure and boundaries.
4. `backend-mvp/IMPLEMENTATION-STATUS.md` — current status authority.
5. `backend-mvp/P7-TEST-EVIDENCE.md` — immutable P7 baseline and headroom.
6. `backend-mvp/04-AUDIO-SERVICE.md` — current adapter/model rules.
7. `backend-mvp/CURRENT-RUNTIME-CONFIG.md` — verified P8 runtime values.
8. `backend-mvp/06-DEPLOYMENT-AND-OPERATIONS.md` — verified production
   topology and operational controls.
9. `hardware-contract/BMO-MVP-HW-INTERFACE-CONTRACT-v1.0.5.md` — read-only
   public protocol contract.
10. `operations/MAINTENANCE-AND-RECOVERY.md` — live recovery procedures.

Historical P1–P7 plans/evidence remain evidence, not execution authority.

## 4. P8 closed boundary

P8 delivered:

- audit, select, and pin a compatible RVC inference runtime;
- validate the existing BMO RVC model asset;
- resolve required HuBERT/RMVPE assets;
- perform isolated real Kokoro → RVC → FFmpeg inference;
- test forced RVC failure and Kokoro-only fallback;
- benchmark RVC CPU, RAM, latency, `MemAvailable`, disk, restart, and OOM
  behavior;
- compare Kokoro-only output with RVC output;
- perform listening/quality evidence;
- determine whether production has enough resource headroom;
- fixed Piper Prudence primary TTS with Kokoro fallback;
- offline pinned asset provisioning and integrated persistent worker controls;
- production canary, acceptance, public regression, and soak evidence.

P8 did not:

- change the locked public hardware contract;
- invent endpoints, events, fields, or protocol behavior;
- implement P9 database work;
- perform P10 physical ESP32 acceptance;
- remove the Kokoro-only fallback;
- expose backend, Hermes, or device secrets to RVC;
- turn RVC on in production before its validation and deployment gates pass;
- silently use mutable or unverified RVC dependencies/assets;
- merge or deploy RVC; `RVC_ENABLED=false` remains.

## 5. P9 authorization and first action

This documentation does not authorize P9. After a new explicit user command
such as **“execute P9”**, begin with a fresh read-only source/runtime audit and
create an isolated branch/worktree. Do not start database work from this
closure.

Document and stop on any conflict with the locked hardware contract, P7
production provenance, secret isolation, offline model policy, or Kokoro
fallback requirement.

## 6. P8 finish line

P8 may finish as `VERIFIED`, `PARTIALLY VERIFIED`, or `BLOCKED`. The final
classification must be evidence-backed and must not claim real RVC success
unless real Kokoro → RVC → FFmpeg inference, output validation, fallback
regression, quality review, and resource measurements support it.

At minimum, closure must record:

```text
exact pinned RVC engine/runtime and immutable dependencies, or blocker
verified model/archive and resolved .pth/.index paths
HuBERT/RMVPE provenance when required
isolated real inference result
hardware-compatible MP3 result
forced-RVC-failure Kokoro-only fallback result
RVC and total pipeline latency
CPU/RAM/MemAvailable/disk/OOM/restart evidence
comparison against the P7 production baseline and headroom
safe production rollout decision
post-deploy public regression if and only if rollout is separately gated
```

Kokoro-only fallback must remain working even if P8 is partially verified or
blocked. After P8 evidence and status are recorded, stop. Do not execute P9
without another explicit user authorization.
