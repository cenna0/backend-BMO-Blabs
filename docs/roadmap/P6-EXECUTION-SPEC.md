# P6 — VPS Foundation and Operations Baseline — Execution Spec

**Status:** `VERIFIED`
**Executor:** Codex acting as infrastructure/backend operator  
**Dependency:** safe access to the existing VPS  
**Next phase after verification:** P7  
**Hermes host policy:** preserve the proven installation when present; bootstrap a maintainable host runtime when absent

## 1. Goal

Create a safe, maintainable and repeatable VPS foundation for BMO without yet deploying or claiming the public BMO voice API as ready.

P6 is successful when later phases can deploy application services into a known filesystem/network/security/monitoring/backup baseline without guessing host state. This includes a healthy loopback-only Hermes host API whether preflight found an existing installation or no Hermes installation at all.

## 2. Inputs

Known project decisions:

```text
Domain                    : personalbmo.web.id
API hostname              : api.personalbmo.web.id
Monitoring hostname       : monitor.personalbmo.web.id
Production Git branch     : main
Deployment root           : /opt/bmo
Reverse proxy             : Caddy as host system service
Monitoring                : Beszel
Admin private network     : Tailscale
Alert destination         : Telegram
Portainer                 : skipped
Infrastructure Compose    : /opt/bmo/deploy/infra-compose.yml (Beszel Hub + local Agent and later infra-only containers)
Runtime packaging         : Docker images + Docker Compose
```

Runtime values/secrets are supplied out-of-band and must not be invented or committed.

## 3. Explicit non-goals

Do not during P6:

- deploy backend/audio service as a verified production API;
- modify backend/audio application source code merely to satisfy P6; P7 owns source-vs-doc audit and any application correction needed for deployment;
- mark `api.personalbmo.web.id` hardware-ready;
- implement PostgreSQL/Prisma application data layer;
- perform real RVC integration;
- modify firmware or public HW/backend contract;
- migrate Hermes into Docker;
- reinstall, relocate, or change the owner of a working Hermes installation for cosmetic consistency;
- defer initial Hermes installation to P7 when P6 preflight proves Hermes is absent;
- create a host Linux user named `docker`;
- enable/install Portainer; Portainer remains intentionally skipped.

Those belong to later phases or are explicitly rejected.

## 4. Task 0 — Read-only preflight and safety snapshot

Collect and record at least:

```bash
whoami
id
uname -a
cat /etc/os-release
nproc
free -h
df -h
ss -lntp
getent passwd
```

Inspect without modifying:

- current SSH login user/path;
- sudo configuration relevant to the operator;
- Hermes installation evidence, process, owning user, service unit/process supervisor, config/data paths, and listener;
- Codex install/workspace;
- Docker/Compose presence/version/state;
- existing containers/images/volumes/networks if Docker exists;
- Caddy/Tailscale/Beszel presence;
- firewall implementation/rules;
- DNS resolution for `api.personalbmo.web.id` and `monitor.personalbmo.web.id`;
- Git remote/branch/status of the current project checkout if available; determine whether the remote is public/private and whether existing SSH/deploy-key authentication is already usable;
- disk headroom.

Guardrail:

```text
free disk < 20 GB → BLOCK large image/model/runtime downloads and report
```

Output: sanitized preflight evidence and a conflict list (if any). If the repository is private and no working non-interactive Git credential/deploy key exists for `bmo-admin`, stop and request that credential rather than inventing or embedding a personal token.

Classify Hermes deterministically before any installation:

```text
PRESENT → installation/runtime evidence exists; audit and preserve it
ABSENT  → no installation/runtime evidence after process, service, path, package/runtime, and listener checks
```

A stopped or unhealthy service is not automatically `ABSENT`. Diagnose and recover a proven installation before considering bootstrap. Record the commands and sanitized evidence supporting the classification.

## 5. Task 1 — Operator/user model

Target:

```text
root      → emergency/system administration
bmo-admin → daily SSH, Codex, Git/deploy, Docker operations, sudo when needed
Hermes    → keep proven ownership when present; select ownership from the actual install/runtime model when absent
```

Requirements:

- create `bmo-admin` only if it does not already exist;
- configure SSH key access before depending on the account;
- least privilege where practical;
- if `bmo-admin` joins the Docker group, document that Docker-group access is effectively root-equivalent;
- do not delete the existing working admin account during P6;
- do not migrate a present Hermes user/path for cleanliness;
- do not invent a dedicated Hermes Linux user when the selected installation/runtime model does not require one.

Acceptance:

- a fresh `bmo-admin` session can log in and perform authorized admin/deploy tasks;
- Codex is usable from the `bmo-admin` account through a supported authentication/config path; do not copy another user's credentials blindly;
- root login is not required for normal operation;
- a present Hermes installation still runs under its preflight-proven ownership;
- an absent-then-bootstrapped Hermes installation runs under the ownership selected from its actual installation/runtime requirements, with that decision recorded.

## 5.1 Task 1A — Conditional Hermes host runtime

Hermes remains a host runtime and is never Dockerized.

### `PRESENT` branch

- audit the actual runtime user, install path, config path, data path, startup/service mechanism, listener, and health behavior;
- preserve the working user/path/config/data/runtime;
- recover an unhealthy proven installation through its existing mechanism;
- do not reinstall, migrate, or restructure it merely for cleanliness.

### `ABSENT` branch

- bootstrap/install Hermes host runtime during P6 from a documented, maintainable source and record the selected version/revision where the installation model exposes one;
- configure a maintainable startup/service mechanism appropriate to the actual Hermes runtime;
- bind the API only to `127.0.0.1:8642`;
- configure and run the applicable health check;
- determine ownership from the installation/runtime model and least-privilege needs. Do not create a dedicated Linux user solely for Hermes unless that model or a proven security/operational requirement needs one;
- record the actual runtime user, actual install, config, and data paths, and startup/service mechanism;
- verify service restart and automatic startup behavior. Perform a full VPS reboot test where safely possible; otherwise verify enablement plus a service restart and record why a full reboot was deferred;
- write the exact recovery/start procedure using the mechanism actually installed.

Both branches require:

```text
health check = PASS
listener = 127.0.0.1:8642 only
no public :8642 exposure
restart behavior is verified
recovery/start procedure is documented
```

Do not put active Hermes credentials in Git, docs, logs, command transcripts, or evidence. P7 performs backend/audio → Hermes integration; it does not perform initial Hermes installation.

## 6. Task 2 — `/opt/bmo` filesystem and permission baseline

Create/verify:

```text
/opt/bmo/
├── app/
├── config/
│   └── caddy/
├── models/
│   ├── hf-cache/
│   ├── torch-cache/
│   ├── kokoro/
│   ├── rvc/bmo/
│   └── MODEL_MANIFEST.md
├── data/
│   ├── postgres/
│   └── beszel/
├── temp/audio/
├── backups/
│   ├── database/
│   ├── config/
│   └── manifests/
└── deploy/
    ├── infra-compose.yml      # P6 infra-only Compose source (Beszel)
    ├── current
    ├── previous
    └── history/
```

Rules:

- `/opt/bmo/app` is Git/deployment source managed by `bmo-admin`;
- secret env files are outside Git; baseline owner is `bmo-admin:bmo-admin` with mode `600` so the authorized deploy operator can read them without making them group/world-readable. If P6 chooses a stricter root-owned scheme, the exact `sudo` deploy workflow must be proven and documented;
- Caddy must not depend on reading secret `.env` files. Keep the recoverable Caddy source under `/opt/bmo/config/caddy/`, then deploy the effective runtime file with explicit Caddy-readable ownership/permissions (baseline `/etc/caddy/Caddyfile`, `root:caddy`, mode `640`) or document/prove an equivalent safe layout;
- persistent data/models are not placed inside the Git checkout;
- runtime model mounts are read-only where possible;
- service-specific writable directories use the UID/GID required by that service;
- no real secret is written into docs/evidence.

## 6.1 Task 2A — Production Git checkout baseline

Establish `/opt/bmo/app` as the production source checkout without deploying the application yet.

Rules:

- discover and reuse the actual project Git remote from the current repository/workspace when available; do not invent a repository URL;
- production source of truth is branch `main`;
- clone/fetch as `bmo-admin` into `/opt/bmo/app`; if the directory is non-empty, inspect it first and never overwrite unknown files;
- use a working SSH deploy key/account credential appropriate for `bmo-admin`; never place a personal access token in Git remote URLs, docs, shell history, or evidence;
- verify `origin`, `main`, current commit SHA, clean working tree, and ability to `git fetch` without changing production state;
- P6 does **not** build/start the BMO backend/audio application from this checkout; application images/deployment begin in P7;
- record the remote in sanitized form, branch, and commit SHA in P6 evidence.

Acceptance:

```text
/opt/bmo/app is a valid Git checkout
origin points to the approved project repository
main is available and selected as production source
bmo-admin can fetch safely
working tree is clean or any intentional local state is documented/blocking
no credential is embedded in the remote URL or evidence
```

## 7. Task 3 — Docker Engine + Compose foundation

If absent, install a supported Docker Engine and Compose plugin through a documented source. If already present, preserve working installation unless there is a proven blocker.

Verify:

```text
Docker daemon healthy
Compose available
restart-after-reboot behavior verified for P6 infra containers (baseline `restart: unless-stopped`)
bounded Docker logging configured
no unrelated container/volume deleted
```

Production rule to preserve for P7:

```text
Git source → build image → run container
```

Do not make backend/audio production depend on live source bind mounts.

## 8. Task 4 — Tailscale admin path before SSH restriction

Install/configure Tailscale if absent. Tailnet enrollment/login/auth material is supplied interactively or out-of-band; do not commit/store a reusable Tailscale auth key in Git/docs/evidence.

Required order:

```text
Tailscale on VPS
→ admin device joins tailnet
→ reach VPS through Tailscale IP/MagicDNS
→ open SECOND SSH session over Tailscale
→ verify sudo/admin workflow
→ only then consider restricting public SSH
```

Normal OpenSSH over the Tailscale network is sufficient. The optional Tailscale SSH feature is not required unless deliberately selected.

Never close the only known-good SSH path.

Evidence must show the alternative admin session worked before any public-SSH restriction.

## 9. Task 5 — Caddy + DNS/TLS foundation

Validate DNS first.

Target names:

```text
api.personalbmo.web.id
monitor.personalbmo.web.id
```

Set up Caddy as a **host system service** so it can reach loopback-only origins cleanly and remain separate from the application Compose lifecycle. Keep its effective config recoverable under `/opt/bmo/config/caddy/` (or a documented symlink/source-of-truth arrangement) and record the exact runtime path.

P6 requirements:

- coordinate Tasks 5 and 6 safely: prepare/validate Caddy config first; if the audited firewall blocks ACME/public traffic, open only the approved `80/443` surface after the alternate admin path is proven, then complete certificate/TLS verification; do not expose internal origins just to obtain TLS;
- valid HTTPS/TLS certificate path works for both the monitoring hostname and API hostname; the API hostname may return a deliberate P6 placeholder until P7;
- HTTP redirects to HTTPS;
- Caddy config is stored/recoverable and does not contain secrets unnecessarily;
- API hostname may be reserved/prepared but must not be documented as BMO API `VERIFIED` until P7 E2E passes;
- do not expose backend/audio/Hermes origin ports publicly.

## 10. Task 6 — Firewall transition

Desired external application surface:

```text
80/tcp  → Caddy
443/tcp → Caddy
```

Internal/non-public service ports for future/current stack:

```text
3000 backend
8001 audio service
8642 Hermes
5432 PostgreSQL
Beszel origin port (for example 8090 if that is the configured origin)
```

SSH:

- retain public SSH until Task 4 proves the Tailscale path;
- after successful proof, restrict public SSH according to the selected safe rule;
- maintain a documented recovery path.

Never alter firewall rules blindly. Record before/after state.

Explicitly verify that no public `:8642` exposure exists after the firewall transition. A loopback listener is required even when firewall rules would otherwise block the port.

## 11. Task 7 — Beszel monitoring + Telegram alerting

Deploy/configure Beszel **Hub + local Agent** using the pinned/tested release selected during P6. Keep persistent Hub/Agent data under `/opt/bmo/data/beszel` (or documented subpaths) and use `/opt/bmo/deploy/infra-compose.yml` as the long-term source of truth. Prefer the supported local Unix-socket Hub↔Agent pattern when compatible with the selected release; otherwise use an explicitly private/local Agent listener. The Agent may read `/var/run/docker.sock` read-only for container telemetry. Never expose the Agent listener or Docker socket publicly.

Target access:

```text
https://monitor.personalbmo.web.id
```

Requirements:

- HTTPS through Caddy;
- Beszel Hub is bound/published only to host loopback (baseline `127.0.0.1:8090`) or an equivalent private origin;
- Beszel Hub origin port not public; Caddy is the only public path to the Hub;
- no public Beszel Agent listener;
- authenticated login and no unintended anonymous/public dashboard access; keep auto-user creation disabled unless explicitly needed, do not enable auto-login, and do not share all systems globally by default; provision the initial Hub/admin credential out-of-band and never place it in Compose/docs/evidence;
- host/container resource monitoring from the local Agent;
- Telegram channel configured using a **fresh active** token and target chat ID/channel supplied out-of-band; never reuse a revoked/previously exposed credential;
- perform a real test alert.

Operational limitation: a Beszel Hub on the same VPS cannot guarantee notification when the entire VPS/network is unreachable. Record this limitation; external uptime monitoring is optional future scope, not something P6 should silently claim.

Baseline alert targets:

```text
RAM > 80% for 5 min   → warning
RAM > 90%             → critical
CPU > 90% for 10 min  → warning
free disk < 20 GB     → warning / block large model download
sustained high swap   → warning
backend down          → critical once backend exists (P7)
audio-service down    → critical once audio service exists (P7)
Hermes down           → critical once the P6 health-check mechanism is available
postgres down         → critical once PostgreSQL exists (P9)
```

P6 must verify the notification channel with a test alert even though some service-specific alerts become active only in later phases.

## 12. Task 8 — Logging/resource baseline

Establish/document:

- Docker bounded log rotation (baseline `10m`, `3` files/service unless justified otherwise);
- host disk/RAM/CPU/swap visibility in Beszel;
- no application secret in logs;
- future service health/restart expectations.

Do not prematurely tune hard CPU/RAM limits for the ML stack without P7/P8 measurements. Monitoring comes before aggressive limits.

## 13. Task 9 — Backup framework

P6 prepares the recovery framework. PostgreSQL itself is not deployed until P9.

Create/verify backup locations and procedures for:

```text
runtime config
Caddy config
deployment metadata/history
manifests/checksums
future database dumps
```

Locked policy once DB exists:

```text
DB daily           → retain 7–14 days
DB/config weekly   → retain 4 weeks
monthly            → manual/off-server recovery bundle
pre-deploy         → record commit + DB backup when DB is in use
```

During P6:

- activate a weekly config/manifest/deployment-metadata backup job now (default to a `systemd` timer if no existing healthy scheduler is already standard on the VPS);
- include Beszel recovery data/config when practical and treat it as sensitive;
- create at least one non-secret test backup artifact;
- prove the backup script/path/permissions work;
- document restore steps;
- document the monthly manual off-server copy workflow;
- do not fake a PostgreSQL restore before P9 exists; daily DB backup/timers activate in P9.


## 14. Task 10 — Maintenance/update/recovery baseline

Adopt [`../operations/MAINTENANCE-AND-RECOVERY.md`](../operations/MAINTENANCE-AND-RECOVERY.md) as the operational runbook and verify it against the actual VPS.

P6 must at least:

- record installed/selected versions for OS/kernel, Docker/Compose, Caddy, Tailscale, Beszel Hub/Agent;
- pin/document infra image versions/tags/digests after they pass verification instead of leaving untracked floating versions;
- document update sequencing and rollback;
- document post-reboot verification;
- document recovery for Caddy/Tailscale/Docker/Beszel/Hermes, low/full disk, config corruption, and whole-VPS replacement;
- reconcile Hermes recovery/start steps with the actual runtime user, paths, and startup/service mechanism recorded by Task 1A;
- confirm that application dependency/model updates are Git/release-managed, not ad-hoc host mutation;
- record the limitation that same-VPS Beszel is not an independent whole-host uptime monitor.

Do not perform speculative major upgrades merely to satisfy this task. The requirement is a verified maintenance baseline, not unnecessary churn.

## 15. Task 11 — P6 verification and evidence

Run an audit → fix → verify → re-audit loop.

Verify at minimum:

```text
Hermes preflight classification and branch evidence recorded
Hermes health PASS
Hermes listener is 127.0.0.1:8642 only; no public :8642 exposure
Hermes actual runtime user, install/config/data paths, and startup/service mechanism recorded
Hermes restart behavior verified; reboot behavior verified where safely possible or the deferral recorded
Hermes recovery/start procedure documented
bmo-admin login/admin path works
Tailscale admin SSH works
Docker/Compose works
/opt/bmo ownership/permissions correct
/opt/bmo/app is approved `main` checkout; origin/fetch/clean-state verified under bmo-admin
real secret files absent from Git
Caddy HTTPS works where configured
firewall public surface matches approved design
Beszel login/HTTPS works
Telegram test notification received
monitoring sees CPU/RAM/disk/swap and Docker where applicable
backup test artifact + weekly backup schedule verified
maintenance/update/recovery runbook verified
recovery/rollback notes exist
no P7 backend-public-ready claim was made
```

Reboot/restart testing should be performed where it is safe and practical; if a full VPS reboot is deferred, document exactly what was and was not proven.

## 16. Required output/evidence

Create a P6 evidence report containing:

```text
preflight summary
before/after service inventory
users/ownership changes
Hermes PRESENT/ABSENT classification + selected branch
Hermes runtime user, install/config/data paths, startup/service mechanism, listener, health, restart/reboot, and recovery evidence
filesystem tree + permissions
installed/verified versions + pinned infra image tags/digests
Codex-under-bmo-admin verification
DNS/TLS result
Tailscale/SSH result
firewall before/after summary
Beszel result
Telegram alert test result
backup/scheduler test result
maintenance/version-pin/runbook result
commands + exit codes
files/config changed (sanitized)
known limitations
rollback/recovery commands
blockers/approvals needed
```

Never include active passwords, keys, bot tokens, device tokens, or authorization headers.

## 17. P6 acceptance criteria

P6 is `VERIFIED` only if:

- [x] preflight evidence exists;
- [x] Hermes is classified `PRESENT` or `ABSENT` from recorded evidence;
- [x] if Hermes was present, its proven user/path/config/data/runtime were preserved and it was not reinstalled or migrated for cleanliness;
- [x] if Hermes was absent, Hermes was installed/configured as a host runtime during P6;
- [x] actual Hermes runtime user, install/config/data paths, and startup/service mechanism are recorded;
- [x] Hermes health check passes and its only listener is `127.0.0.1:8642`;
- [x] firewall/listener evidence proves no public `:8642` exposure;
- [x] Hermes restart behavior is verified, automatic startup is configured, and safe reboot evidence or an explicit reboot deferral is recorded;
- [x] the actual Hermes recovery/start procedure is documented;
- [x] `bmo-admin` is operational and Codex can run there without copying/exposing another account's secret config;
- [x] Docker Engine + Compose are healthy;
- [x] `/opt/bmo` layout and permissions are verified;
- [x] `/opt/bmo/app` is the approved clean `main` Git checkout, with `origin` and fetch access verified under `bmo-admin` and no credential embedded in the remote/evidence;
- [x] runtime secrets are outside Git with restricted permissions;
- [x] Tailscale admin SSH is proven before any public SSH restriction;
- [x] Caddy/TLS foundation works;
- [x] public application exposure is limited to approved reverse-proxy surface;
- [x] Beszel is reachable at its HTTPS hostname with auth;
- [x] Telegram test alert is received;
- [x] logging/monitoring baseline is active;
- [x] weekly config/manifest backup schedule is active, a test artifact is created, restore steps are documented, and monthly off-server flow is documented;
- [x] maintenance/update/recovery runbook is reconciled with actual VPS state and version inventory;
- [x] no destructive/unapproved existing-service change occurred;
- [x] P7 scope was not silently implemented;
- [x] evidence and `IMPLEMENTATION-STATUS.md` are updated.

## 18. Stop condition

After P6 becomes `VERIFIED`:

- report the evidence;
- report any residual risk;
- state that **P7 is next**;
- stop.

P7 requires a separate execution turn/context so the agent can load the P7-specific requirements cleanly.
