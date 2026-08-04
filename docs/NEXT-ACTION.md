# BMO — Next Execution Action

**Last updated:** 2026-08-04
**Audience:** Codex / infrastructure-backend coding agent
**Current next phase:** **P9.1 production readiness lock**
**Phase state:** `P9.1 MERGED / NOT DEPLOYED; PRODUCTION READINESS IN PROGRESS`

> P8 is `P8_PIPER_PRODUCTION_VERIFIED`. P9.1 source is merged and independently
> reviewed, but this gate does **not** authorize production deployment,
> PostgreSQL installation, or migration. P9.2–P9.6 require separate gates.

## 1. Current checkpoint

P6 VPS Foundation and Operations Baseline remains `VERIFIED`. P7 backend,
Audio Service, and Hermes production integration is `VERIFIED — PRODUCTION`.
P7 is `VERIFIED — PRODUCTION`. P8 is `P8_PIPER_PRODUCTION_VERIFIED` with Piper
Prudence primary, Kokoro fallback, and RVC disabled. P8 completion does **not** authorize P9 implementation or deployment. P9.1 source is now merged but not deployed; its
readiness package is available under [`p9/README.md`](p9/README.md). Do not
install a production database or execute P10 from this documentation gate.
Do not execute P10 from the P9.1 readiness package.
P8 completion does **not** authorize P9.
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

Production uses Piper Prudence as the fixed primary and Kokoro `af_heart` at
`0.80` as automatic fallback; real RVC inference is not verified and RVC
remains disabled. Physical ESP32 acceptance
is not run. PostgreSQL/Prisma source is merged, but production PostgreSQL is
not installed and no production migration has run.

P9.1 architecture is now approved and locked for invite-only email/password
authentication, Argon2id, short-lived access tokens, rotating opaque refresh
tokens by hash, server-enforced `Asia/Jakarta`, six-digit ten-minute pairing,
private PostgreSQL targets, persisted user/device settings, migration policy,
backup/restore, audit/redaction controls, operator-owned production secret
ownership, and file-based service-specific secret injection. P9.1 implementation
is merged; production readiness and deployment remain separately authorized
tasks. Secret ownership/injection is a locked design, not proof that any real
production secret has been created or mounted.

## 2. Locked execution order

```text
P6 VPS foundation                         VERIFIED
  ↓
P7 backend/audio production deployment   VERIFIED — PRODUCTION
  ↓ explicit new authorization required
P8 fixed Piper primary + Kokoro fallback VERIFIED — PRODUCTION
  ↓ completed/verified status + explicit authorization
P9.1 production readiness                IN PROGRESS / OPERATOR REVIEW REQUIRED
  ↓ VERIFIED + explicit authorization
P10 physical ESP32 acceptance            NOT_STARTED / dependency-gated
```

Do not collapse phases or infer deployment authority from technical readiness.
P9.1 merge does not automatically start a production canary.

## 3. Read before a future P9 execution

Read in this order:

1. `NEXT-ACTION.md` — this operational gate.
2. `backend-mvp/P8-PRODUCTION-ROLLOUT-EVIDENCE.md` — closed P8 evidence.
3. `roadmap/P8-EXECUTION-SPEC.md` — historical P8 closure boundaries.
4. `backend-mvp/IMPLEMENTATION-STATUS.md` — current status authority.
5. `backend-mvp/P7-TEST-EVIDENCE.md` — immutable P7 baseline and headroom.
6. `backend-mvp/04-AUDIO-SERVICE.md` — current adapter/model rules.
7. `backend-mvp/CURRENT-RUNTIME-CONFIG.md` — verified P8 runtime values.
8. `backend-mvp/06-DEPLOYMENT-AND-OPERATIONS.md` — verified production
   topology and operational controls.
9. `hardware-contract/BMO-MVP-HW-INTERFACE-CONTRACT-v1.0.5.md` — read-only
   public protocol contract.
10. `operations/MAINTENANCE-AND-RECOVERY.md` — live recovery procedures.
11. `p9/README.md` — approved P9.1 architecture lock and later subphase gates.
12. `p9/P9.1-PRODUCTION-SECRETS-OPERATOR-GUIDE.md` — approved secret
    provisioning, validation, rotation, recovery, and incident handoff.
13. `p9/P9.1-PRODUCTION-SECRET-MATRIX.md` — service isolation and mount
    boundary.
14. `p9/P9.1-WINDOWS-OFF-VPS-BACKUP-GUIDE.md` — locked Windows manual
    off-VPS backup pull and restore-rehearsal procedure.

Historical P1–P7 plans/evidence remain evidence, not execution authority.

## 4. P8 closed boundary

P8 closed with the fixed Piper Prudence primary, Kokoro fallback, offline
pinned assets, integrated persistent worker controls, production canary,
fallback/recovery tests, public regression, resource soak, rollback retention,
and sanitized evidence. The exact result is in
[`backend-mvp/P8-PRODUCTION-ROLLOUT-EVIDENCE.md`](backend-mvp/P8-PRODUCTION-ROLLOUT-EVIDENCE.md).

The RVC experiment was not deployed. Its compact evidence and Git history are
archived; no RVC runtime or Docker artifact is part of production and
`RVC_ENABLED=false` remains locked.

P8 did not:

- change the locked public hardware contract;
- invent endpoints, events, fields, or protocol behavior;
- implement P9 database work;
- perform P10 physical ESP32 acceptance;
- remove the Kokoro fallback;
- expose backend, Hermes, or device secrets to any audio runtime;
- change the public hardware contract;
- begin P9 implementation without a new explicit authorization.

## 5. P9 authorization and first action

This documentation does not authorize production deployment. A future explicit
command such as **“execute P9.1”** is required for a canary. After operator
approval, the next canary task must begin with a fresh read-only audit from the
exact final main SHA and a separate isolated worktree. Do not start database
work from this readiness branch. P9.2–P9.6 require their own completed gate.

Document and stop on any conflict with the locked hardware contract, P7
production provenance, secret isolation, offline model policy, or Kokoro
fallback requirement.

## 6. P8 finish line

P8 is closed as `P8_PIPER_PRODUCTION_VERIFIED`. Do not repeat P8 work from this
gate. Production deployment requires a separate explicit authorization; this
branch only supplies the reviewable readiness design and execution gates.
