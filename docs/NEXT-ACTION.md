# BMO — Next Execution Action

**Last updated:** 2026-07-26  
**Audience:** Codex / infrastructure-backend coding agent  
**Current next phase:** **P6 — VPS Foundation and Operations Baseline**  
**Phase state:** `READY` — execute only after the user explicitly asks to execute/continue the next phase.

> This is the operational entry point for the next implementation turn. Do not infer the next task from historical P1–P5 evidence. Do not start P7 in the same execution turn unless the user explicitly authorizes it after P6 verification.

## 1. What must happen next

The next implementation task is **P6 only**.

P6 prepares the VPS foundation required by every later phase:

```text
P6 VPS foundation
  ↓ VERIFIED + explicit next-phase authorization
P7 backend/audio deployment + public API
  ↓ VERIFIED + explicit next-phase authorization
P8 real RVC verification + resource benchmark
  ↓ completed/verified status + explicit next-phase authorization
P9 PostgreSQL + Prisma readiness
  ↓ VERIFIED + explicit next-phase authorization
P10 hardware handoff activation + physical ESP32 verification
```

Do not collapse P6–P10 back into one large task and do not skip the locked execution order **P6 → P7 → P8 → P9 → P10** unless the user explicitly changes the roadmap. Technical dependency alone is not execution authorization.

## 2. Read these before touching the VPS

Read in this order:

1. `NEXT-ACTION.md` — this file.
2. `roadmap/P6-EXECUTION-SPEC.md` — exact P6 execution contract.
3. `backend-mvp/IMPLEMENTATION-STATUS.md` — current phase/status authority.
4. `backend-mvp/06-DEPLOYMENT-AND-OPERATIONS.md` — locked deployment/operations target.
5. `backend-mvp/00-AGENT-EXECUTION-GUIDE.md` — general agent safety and verification rules.
6. `backend-mvp/CURRENT-RUNTIME-CONFIG.md` — runtime values that later deployment must preserve.
7. `hardware-contract/BMO-MVP-HW-INTERFACE-CONTRACT-v1.0.5.md` — read-only public HW/backend contract.
8. `operations/MAINTENANCE-AND-RECOVERY.md` — maintenance/update/recovery baseline that P6 must establish.
9. `roadmap/P6-P10-ROADMAP.md` — downstream dependency plan; do not execute later phases yet.

Historical P1–P5 plans/evidence are evidence, not next-step instructions.

## 3. Locked decisions for P6

Treat these as already decided unless the real VPS audit proves a technical blocker:

```text
Production source branch        : main
Production source location      : /opt/bmo/app
Persistent root                 : /opt/bmo
Reverse proxy                   : Caddy (host system service; config managed/recoverable under /opt/bmo/config/caddy)
BMO production hostname         : api.personalbmo.web.id
Monitoring hostname             : monitor.personalbmo.web.id
Monitoring                      : Beszel
Portainer                       : NOT USED for now
Admin private network           : Tailscale
Public ports                    : 80/443 only for application/monitoring traffic
Public SSH                      : may be restricted only AFTER Tailscale SSH path is proven
Daily operator                  : bmo-admin
Root                            : emergency/system admin only
Hermes                          : preserve existing host runtime/user/path; do not migrate for cosmetics
Docker host user                : do NOT create a dedicated Linux user named docker
Runtime code                    : immutable Docker images built from Git source
Live source bind mount          : do NOT use for production backend/audio-service
Real secrets                    : /opt/bmo/config, outside Git; bmo-admin-readable only as required for deploy; never world-readable
RVC ownership                   : Audio Service; target assets under /opt/bmo/models/rvc/bmo
Telegram                        : Beszel alert destination; use a fresh active bot token + target chat ID supplied out-of-band, never Git/docs
Deployment downtime             : short recreate interruption ~10–30 s acceptable for current MVP
Image release identity           : application images must be tied to deployed Git commit SHA for deterministic rollback
Database activation              : PostgreSQL/DATABASE_URL are P9; P7 voice deployment must not require the DB
```

## 4. P6 is infrastructure only

P6 **does**:

- audit and protect existing VPS/Hermes/Codex;
- establish admin access/user/permissions;
- Docker + Compose foundation;
- `/opt/bmo` filesystem and config separation;
- Caddy/DNS/TLS foundation;
- Tailscale administration path;
- firewall transition using safe ordering;
- Beszel + authenticated monitoring + Telegram test alert;
- bounded logging/resource observability;
- backup framework and test artifact;
- maintenance/update/recovery runbook + pinned-version inventory;
- evidence, rollback notes, and documentation update.

P6 **does not**:

- deploy/claim the BMO public voice API as ready — P7;
- integrate/verify real RVC inference — P8;
- deploy PostgreSQL/Prisma application layer — P9;
- hand a live endpoint/token to physical hardware or claim HW integration — P10;
- modify the firmware contract;
- migrate Hermes to Docker or another Linux user merely for cleanliness.

## 5. Authorization semantics

This documentation does not authorize actions by itself.

When the user explicitly says **“execute P6”**, **“continue the next phase”**, or equivalent while pointing the agent to this documentation, that authorizes the non-destructive P6 actions defined in `roadmap/P6-EXECUTION-SPEC.md`, including installation/configuration of the selected P6 tooling.

Even after P6 authorization, stop for approval before:

- deleting existing data, containers, images, volumes, users, or unrelated config;
- migrating/changing the existing Hermes runtime user, path, config, service, or data;
- closing the only working SSH path before a second tested admin path exists;
- destructive firewall recovery actions not covered by the safe P6 transition;
- rotating existing production credentials;
- destructive database operations;
- replacing unrelated existing host services;
- proceeding around an unverified model/license/security blocker.

## 6. First action after P6 authorization

Do **not** install first. Start with a read-only preflight and capture evidence:

```text
OS/kernel
CPU/RAM/disk
current users/sudo
current SSH path
Hermes user/process/service/config/data/listener
Codex location
Docker/Compose presence
current containers/images/volumes
listeners/ports
firewall
DNS for api + monitor hostnames
existing Caddy/Tailscale/Beszel state
Git remote/current repo state
```

If a real VPS fact conflicts with these docs, document the conflict before modifying the host.

## 7. P6 finish line

P6 may become `VERIFIED` only when all acceptance criteria in `roadmap/P6-EXECUTION-SPEC.md` pass and evidence is recorded.

At minimum:

```text
Hermes still healthy + loopback-only
bmo-admin operational
Docker + Compose healthy
/opt/bmo structure + permissions verified
/opt/bmo/app is an approved clean `main` Git checkout usable by bmo-admin
secrets outside Git
Caddy/TLS foundation valid
Tailscale admin SSH verified before public SSH restriction
firewall exposes only approved surfaces
Beszel HTTPS/login works
Telegram test alert received
logging/resource guardrails active
backup test artifact + restore procedure documented
maintenance/update/recovery runbook verified
reboot/restart behavior checked where relevant
P7 has NOT been silently started
```

## 8. What to do after P6

After P6 is verified:

1. update `backend-mvp/IMPLEMENTATION-STATUS.md` with evidence/commit/state;
2. create/update P6 evidence under `backend-mvp/` or `audit/`;
3. summarize changed host state, commands, risks, and rollback;
4. stop;
5. report that **P7 is now the next phase**.

Do not auto-run P7 merely because P6 passed.
