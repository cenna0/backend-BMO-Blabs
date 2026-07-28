# BMO — Next Execution Action

**Last updated:** 2026-07-28
**Audience:** Codex / infrastructure-backend coding agent
**Current next phase:** **P7 — Deploy Backend + Audio Service + Hermes Integration**
**Phase state:** `NOT_STARTED / AWAITING EXPLICIT USER AUTHORIZATION`

> P6 is `VERIFIED`. This file identifies the next phase but does not authorize
> it. Do not start P7 merely because its dependency is satisfied.

## 1. Current checkpoint

P6 VPS Foundation and Operations Baseline is complete. Sanitized proof is in
[`backend-mvp/P6-TEST-EVIDENCE.md`](backend-mvp/P6-TEST-EVIDENCE.md).

Verified P6 outcomes include:

- Hermes 0.19.0 healthy on loopback `127.0.0.1:8642`, enabled under systemd,
  with restart/recovery evidence;
- Docker/Compose, `/opt/bmo`, Caddy TLS, Tailscale-only SSH firewall access,
  and protected backup/restore foundations;
- Beszel host/container/six-unit systemd telemetry and supported host alerts;
- a private strict Beszel-to-Telegram relay plus an independent Hermes health
  notifier with three-failure threshold and single recovery notification;
- both labeled Telegram receipt tests confirmed by the operator;
- no P7 backend/audio containers, public API readiness claim, or P7 listeners.

The current turn must stop after recording P6. P7 requires a new explicit user
command such as **“execute P7”** or **“continue with P7.”**

## 2. Locked execution order

```text
P6 VPS foundation                         VERIFIED
  ↓ explicit next-phase authorization
P7 backend/audio deployment + public API NOT_STARTED
  ↓ VERIFIED + explicit authorization
P8 real RVC verification + benchmark
  ↓ completed/verified + explicit authorization
P9 PostgreSQL + Prisma readiness
  ↓ VERIFIED + explicit authorization
P10 physical hardware acceptance
```

Do not collapse phases or infer execution authority from technical readiness.

## 3. Read before a future P7 execution

Read in this order:

1. `NEXT-ACTION.md` — this file.
2. `roadmap/P6-P10-ROADMAP.md` — P7 goal, scope, outputs, and acceptance.
3. `backend-mvp/IMPLEMENTATION-STATUS.md` — current status authority.
4. `backend-mvp/P6-TEST-EVIDENCE.md` — foundation and residual risks P7 must
   preserve.
5. `backend-mvp/06-DEPLOYMENT-AND-OPERATIONS.md` — deployment target.
6. `backend-mvp/00-AGENT-EXECUTION-GUIDE.md` — general execution rules.
7. `backend-mvp/CURRENT-RUNTIME-CONFIG.md` — runtime values to preserve.
8. `hardware-contract/BMO-MVP-HW-INTERFACE-CONTRACT-v1.0.5.md` — read-only
   public protocol contract.
9. `operations/MAINTENANCE-AND-RECOVERY.md` — live recovery procedures.

Historical P1–P5 plans and evidence remain evidence, not next-step authority.

## 4. P7 boundary

P7 may:

- audit source behavior against current docs and the hardware contract;
- select the exact `main` commit to deploy;
- build immutable backend/audio images tied to that commit;
- configure runtime secrets outside Git;
- deploy backend/audio with health, restart, and rollback controls;
- integrate backend with the P6-verified Hermes host API;
- activate the Caddy API route;
- run public HTTPS/WSS and fake-ESP32 end-to-end tests;
- record baseline resource/latency and deployment evidence.

P7 must not:

- reinstall, relocate, Dockerize, or cosmetically restructure Hermes;
- expose Hermes, Beszel, Audio Service, or backend origin ports publicly;
- require PostgreSQL or activate `DATABASE_URL`; that is P9;
- claim real RVC verification; that is P8;
- hand off a live credential to physical hardware or claim final physical
  integration; that is P10;
- change the locked hardware/backend contract without explicit authorization.

## 5. Authorization and first action

Documentation does not authorize P7. After an explicit user command, start with
a read-only source/runtime reconciliation:

```text
local main commit and fetch state
source routes/events/env behavior vs canonical docs
P6 service/listener/firewall baseline
Hermes health and loopback listener
available build tooling and pinned base images
runtime secret-file presence/metadata without values
rollback anchors and current backup state
```

Document any conflict before changing public behavior or the live stack.

## 6. P7 finish line

P7 is verified only when:

```text
immutable backend/audio images are tied to a recorded commit
backend and Audio Service are healthy with private origins
backend integrates with the existing Hermes host runtime
https://api.personalbmo.web.id/health succeeds through Caddy
public WSS authentication and canonical events pass
valid WAV upload, MP3 retrieval, and completion flow pass
fake ESP32 public-domain E2E passes
internal ports remain non-public
rollback and resource evidence are recorded
Hermes and all P6 controls remain healthy
```

After P7 evidence is recorded, stop again. Do not auto-run P8.
