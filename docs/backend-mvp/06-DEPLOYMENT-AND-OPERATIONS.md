# BMO Backend MVP — Deployment and Operations

**Versi:** 1.1.0  
**Status:** CURRENT DEPLOYMENT TARGET — NOT YET DEPLOYMENT VERIFIED  
**Last audited:** 2026-07-26

> This file defines the agreed VPS target and operational rules. It does not claim the stack is already deployed. Public hardware endpoints become usable only after the deployment handoff is marked `VERIFIED`.

## 1. Deployment principles

- Git repository is the source of code truth.
- `main` is the production deployment branch.
- Source is cloned/pulled on the VPS, but runtime code runs from built Docker images.
- Editing source on the VPS does not change the running production container until build/deploy occurs.
- Persistent data, models, secrets, and backups live outside the Git checkout.
- Hermes remains a host service and must not be moved into Docker merely for cleanup.
- Codex is an admin/development tool, not a BMO runtime dependency.
- Production public traffic uses domain + HTTPS/WSS through Caddy.
- Internal service ports are not exposed to the public internet.
- Docker Compose remains the deployment source of truth; Portainer is not required.

## 2. Agreed public names

```text
BMO API / WSS : api.personalbmo.web.id
Monitoring    : monitor.personalbmo.web.id
```

Target public URLs after verification:

```text
https://api.personalbmo.web.id
wss://api.personalbmo.web.id/ws
https://monitor.personalbmo.web.id
```

Beszel may be publicly reachable through HTTPS/login, but its origin port must not be public.

## 3. Host user model

Target separation:

```text
root
└── emergency/system administration only

bmo-admin
├── daily SSH/admin account
├── Codex (configured for this account; do not blindly copy another user's auth state)
├── Git checkout/deployment
├── Docker Compose operations
└── sudo when required

Hermes runtime user
└── preserve existing Hermes ownership/user unless migration is proven necessary and approved
```

Do **not** create a Linux host user named `docker` just to run containers. Docker is a daemon/service; each container runs under its own appropriate non-root runtime user where supported.

Before changing Hermes ownership/path, audit the actual existing Hermes user, service definition, config path, and data path. A stable existing installation wins over cosmetic restructuring.

## 4. Target filesystem

```text
/opt/bmo/
├── app/                      # Git repository checkout; main = production source
│   ├── backend/
│   ├── audio-service/
│   ├── tests/
│   ├── scripts/
│   └── docker-compose.yml
│
├── config/                   # runtime config; not Git
│   ├── backend.env
│   ├── audio.env
│   ├── postgres.env
│   └── caddy/
│       └── Caddyfile
│
├── models/                   # persistent model/cache assets
│   ├── hf-cache/
│   ├── torch-cache/
│   ├── kokoro/
│   ├── rvc/
│   │   └── bmo/
│   └── MODEL_MANIFEST.md
│
├── data/                     # persistent writable service data
│   ├── postgres/
│   └── beszel/
│
├── temp/
│   └── audio/
│
├── backups/
│   ├── database/
│   ├── config/
│   └── manifests/
│
└── deploy/
    ├── infra-compose.yml      # P6 infra-only Compose source (Beszel)
    ├── current
    ├── previous
    └── history/
```

Meaning:

```text
app      = replaceable from Git/build
config   = persistent + secret/config
models   = persistent; runtime read-only where possible
data     = persistent + writable
temp     = disposable
backups  = recovery material
deploy   = release/rollback metadata
```

## 5. Ownership and permissions

Baseline target:

```text
/opt/bmo/app               → bmo-admin managed
/opt/bmo/config            → restricted; deploy operator access only as required
/opt/bmo/config/*.env      → baseline `bmo-admin:bmo-admin`, mode 600 (or a stricter root-owned scheme only if the proven sudo deploy workflow can still read them)
/opt/bmo/config/caddy      → recoverable Caddy source; effective runtime Caddyfile must be readable by the Caddy service without granting Caddy access to secret env files
/opt/bmo/models            → admin/bootstrap writable; runtime read-only where possible
/opt/bmo/data/postgres     → PostgreSQL container runtime UID/GID
/opt/bmo/data/beszel       → Beszel runtime ownership as required
/opt/bmo/temp/audio        → backend runtime writable
/opt/bmo/backups           → restricted admin/recovery access
```

Container images for backend/audio service must run as non-root unless a proven dependency prevents it and the exception is documented.

## 6. Config and secret separation

Only templates belong in Git:

```text
.env.backend.example
.env.audio.example
.env.postgres.example
```

Real values live on the VPS under `/opt/bmo/config/`.

### `backend.env`

Contains backend runtime values such as:

```env
NODE_ENV=production
BACKEND_HOST=127.0.0.1
BACKEND_PORT=3000
PUBLIC_BASE_URL=https://api.personalbmo.web.id

DEVICE_ID=bmo-001
DEVICE_TOKEN=<secret>

HERMES_API_URL=http://127.0.0.1:8642
HERMES_API_KEY=<secret>
HERMES_MODEL=hermes-agent
HERMES_CONVERSATION=bmo-001
HERMES_SOFT_TIMEOUT_MS=30000
HERMES_HARD_TIMEOUT_MS=180000

AUDIO_SERVICE_URL=http://127.0.0.1:8001
INTERNAL_SERVICE_TOKEN=<shared-secret>

# DATABASE_URL is intentionally absent until P9 activates PostgreSQL/Prisma.
# Voice MVP P7 must run without PostgreSQL.

TEMP_AUDIO_DIR=/opt/bmo/temp/audio
TEMP_AUDIO_TTL_SECONDS=300
TEMP_AUDIO_CLEANUP_INTERVAL_SECONDS=30
REQUEST_TOMBSTONE_TTL_SECONDS=600
MAX_REQUEST_STORE_ENTRIES=1000
MAX_AUDIO_BYTES=3145728
MAX_AUDIO_DURATION_SECONDS=60
TOTAL_PIPELINE_TIMEOUT_MS=300000

HARDWARE_TEST_MODE=false
```

### `audio.env`

Audio Service receives only the secrets/config it requires:

```env
AUDIO_SERVICE_HOST=0.0.0.0
AUDIO_SERVICE_PORT=8001
INTERNAL_SERVICE_TOKEN=<same shared-secret as backend>

HF_HOME=/opt/bmo/models/hf-cache
TORCH_HOME=/opt/bmo/models/torch-cache
MODEL_DOWNLOAD_ALLOWED=false

WHISPER_MODEL=medium
WHISPER_HOTWORDS=BMO
WHISPER_DEVICE=cpu
WHISPER_COMPUTE_TYPE=int8
WHISPER_CPU_THREADS=4
WHISPER_WORKERS=1
WHISPER_BEAM_SIZE=5
WHISPER_VAD=true

KOKORO_LANG_CODE=a
KOKORO_VOICE=af_heart
KOKORO_SPEED=0.80

RVC_ENABLED=true
RVC_MODEL_PATH=/opt/bmo/models/rvc/bmo/<actual-model-file>.pth
RVC_INDEX_PATH=/opt/bmo/models/rvc/bmo/<actual-index-file>.index
RVC_F0_UP_KEY=0
RVC_F0_METHOD=rmvpe

OUTPUT_MP3_SAMPLE_RATE=24000
OUTPUT_MP3_BITRATE=96k
```

Do not guess RVC filenames. Bootstrap/inspect the verified archive, then set paths to the actual extracted files.

### `postgres.env` — P9 only

The path may be reserved during P6, but do **not** create/require real database credentials during P6/P7. P9 generates the database name/user/password and activates `DATABASE_URL`. Do not commit it.

Real secret values must never appear in docs, Git history, logs, or deployment reports.

## 7. Target runtime topology

```text
Internet
   │
   │ 80 / 443
   ▼
Caddy (host system service)
   ├── api.personalbmo.web.id
   │      ↓
   │   BMO backend origin :3000
   │
   └── monitor.personalbmo.web.id
          ↓
       Beszel Hub origin

BMO backend
   ├── Hermes host service        127.0.0.1:8642
   ├── Audio Service              127.0.0.1:8001
   └── PostgreSQL (P9)            private only when activated
```

### 7.1 P7 application container networking

P7 target networking keeps the original proven host-access model: `bmo-backend` uses Linux `network_mode: host`, binds the production origin to `127.0.0.1:3000`, and therefore can call the existing host-loopback Hermes at `127.0.0.1:8642`. `bmo-audio-service` stays on normal container networking and publishes only `127.0.0.1:8001:8001`; P9 PostgreSQL, when activated, is private and may expose `127.0.0.1:5432` only for the host-network backend if required by the final Compose topology. Caddy is the only public path. If the P7 source audit proves a different host-access mechanism is already implemented and safer, document/test it before changing this target; never expose Hermes or change the public hardware contract merely to solve container networking.

Audio Service does not receive `HERMES_API_KEY` or device token.

## 8. Docker runtime model

Source checkout:

```text
/opt/bmo/app
```

Production flow:

```text
Git main / selected commit
→ build Docker image tagged with the Git commit SHA
→ record current + previous image tags in `/opt/bmo/deploy/current` and `/opt/bmo/deploy/previous`
→ include commit SHA, image tag(s), deployment timestamp, and relevant sanitized config checksum/identifier
→ run/recreate container from the selected immutable image tag
```

Use deterministic release identity (for example `bmo-backend:<git-sha>` and `bmo-audio-service:<git-sha>` or an equivalent Compose `IMAGE_TAG=<git-sha>` mechanism). Do not overwrite the only known-good image tag before the new release passes verification.

Do not bind-mount the live backend/audio source directory into production containers merely to make edits live automatically.

A source change becomes production only after explicit build + deploy + verification.

P6 infrastructure-only containers such as Beszel use `/opt/bmo/deploy/infra-compose.yml` as their Compose source of truth. Baseline restart policy is `unless-stopped` for long-running infra/application containers unless a service has a documented reason otherwise. Application Compose remains in the Git checkout for P7+.

Persistent mounts are reserved for items such as:

- model/cache data;
- temp audio directory;
- PostgreSQL data;
- Beszel data;
- explicitly required configuration.

Docker logs must use bounded rotation (baseline `10m`, 3 files per service unless measurement justifies change). Health checks must reflect actual readiness, not process existence; P7 Audio Service health must allow a model-loading grace period (historical baseline up to ~300 s, then tune from VPS measurements).

## 9. Reverse proxy and TLS

Caddy is the selected reverse proxy for this deployment target and runs as a **host system service**. Keep a recoverable source under `/opt/bmo/config/caddy/`, but deploy the effective runtime file with explicit Caddy-readable ownership/permissions. Baseline: `/etc/caddy/Caddyfile` owned `root:caddy` mode `640`, installed from the recoverable source via an auditable `sudo` step. An equivalent proven layout is allowed, but Caddy must never need read access to backend/audio secret env files.

Requirements:

- terminate HTTPS for `api.personalbmo.web.id`;
- support WebSocket upgrade on `/ws`;
- proxy voice uploads and audio downloads;
- expose only necessary public ports;
- redirect HTTP to HTTPS;
- preserve upload/pipeline timeouts appropriate for long voice processing;
- never expose Hermes or Audio Service directly.

Public hardware routes remain:

```text
WS   /ws
POST /api/v1/voice
GET  /audio/:audioId.mp3
```

## 10. Firewall and admin network

Target public exposure:

```text
80/tcp   public → Caddy
443/tcp  public → Caddy
```

Private/internal only:

```text
3000 backend
8001 Audio Service
8642 Hermes
5432 PostgreSQL
Beszel origin port
```

Current SSH access starts via public IP. Migration procedure:

```text
install/configure Tailscale on VPS
→ configure admin device
→ verify SSH through Tailscale in a second session
→ only then restrict public SSH
```

Never close the only working SSH path before private admin access is proven.

Tailscale is for server administration; BMO devices use the public domain through HTTPS/WSS.

## 11. Beszel monitoring

Beszel is required in the infrastructure plan; Portainer is currently skipped. Deploy a pinned/tested **Hub + local Agent** pair from `/opt/bmo/deploy/infra-compose.yml`. Bind/publish the Hub only to host loopback (baseline `127.0.0.1:8090`) so Caddy is the sole public path. Prefer a supported local Unix socket between Agent and Hub when available; otherwise keep the Agent listener private/local. Docker telemetry may use a read-only Docker socket mount. Never expose the Agent listener or Docker socket publicly.

Target public dashboard:

```text
https://monitor.personalbmo.web.id
```

Requirements:

- HTTPS through Caddy;
- authenticated access;
- Hub origin port not publicly exposed;
- Agent listener/socket not public;
- persistent Beszel Hub/Agent data as required;
- monitor host and container resources;
- Telegram notification destination configured with a fresh active bot credential + target chat ID/channel stored outside Git.

Because Beszel is on the monitored VPS, it is not an independent detector for total VPS/network loss. Document that limitation instead of claiming full-outage alert coverage.

Baseline alerts:

```text
RAM > 80% for 5 min       → warning
RAM > 90%                 → critical
CPU > 90% for 10 min      → warning
free disk < 20 GB         → warning / block model download
sustained high swap       → warning
backend down              → critical
audio-service down        → critical
postgres down             → critical once PostgreSQL exists (P9)
```

Never store the Telegram bot token in documentation or Git.

## 12. Backup and restore policy

### Scheduled local backups

```text
PostgreSQL daily      → retain 7–14 days
DB/config weekly      → retain 4 weeks
```

### Pre-deployment backup

Before significant deploy/migration:

```text
record current deployed commit
→ database backup
→ validate backup artifact
→ deploy
```

### Monthly off-server copy

Once per month, copy a recovery bundle outside the VPS.

Suggested bundle contents:

```text
database dump
runtime config (encrypted/protected)
deployment history
migration metadata
model manifest/checksums
```

Large reproducible model/cache files and Docker images do not need to be copied monthly when their exact source/revision/hash is recorded and they can be restored safely. Beszel recovery data/config should be included in protected weekly/monthly recovery material when practical; it may contain sensitive notification/account configuration.

A backup does not count as verified until a restore test has been performed.

## 13. RVC deployment ownership

RVC belongs to Audio Service, not Express backend.

Target asset path:

```text
/opt/bmo/models/rvc/bmo/
```

Flow:

```text
download exact model asset
→ verify source/revision/size/SHA-256
→ inspect archive before extraction
→ extract accepted .pth / optional .index
→ install/pin compatible inference runtime
→ configure actual path in audio.env
→ real Kokoro → RVC → FFmpeg test
→ record latency/resource/output metadata
→ verify forced RVC failure still falls back to Kokoro-only
```

Express backend only calls Audio Service `/tts/synthesize`; it does not load RVC files directly.

Current status at documentation audit: model asset/fallback orchestration exists, but real RVC inference is not yet verified.

## 14. PostgreSQL readiness

PostgreSQL + Prisma are future application-data infrastructure and are intentionally separate from voice request state.

PostgreSQL will hold future data such as user/device ownership/settings/integrations. Voice request state remains in-memory for this MVP.

Database readiness requires:

- persistent data;
- healthcheck;
- migration procedure;
- database backup;
- restore test;
- database port private only.

## 15. Deployment procedure

`main` is production source.

Baseline release flow:

```text
confirm working tree / target main commit
→ audit actual source routes/events/env expectations against the canonical HW contract + current runtime docs
→ BLOCK/document conflicts before public deployment
→ fetch/pull selected commit
→ derive immutable image tag from target commit SHA
→ record previous deployed commit/image tag
→ pre-deploy DB backup when DB is in use
→ build images
→ run tests
→ run migration when applicable
→ docker compose up/recreate
→ healthchecks
→ internal smoke test
→ public HTTPS/WSS smoke test
→ fake ESP32 public E2E
→ record deployment history
```

A short deployment interruption around 10–30 seconds is acceptable for the current MVP. Blue/green deployment is not required yet.

## 16. Rollback

If release verification fails:

```text
stop failed release
→ select previous known-good commit-tagged image(s) / commit
→ restore database only when a migration/data change requires it
→ restart services
→ healthcheck
→ public smoke test
→ record failure and rollback evidence
```

Do not improvise destructive database rollback without a verified backup and migration plan.


## 17. Maintenance and recovery

The detailed runbook is [`../operations/MAINTENANCE-AND-RECOVERY.md`](../operations/MAINTENANCE-AND-RECOVERY.md).

Baseline rules:

- record/pin the versions actually verified for host/infra services; avoid untracked floating production state;
- update one layer at a time with backup/rollback anchor and post-update verification;
- application dependency changes come from Git and immutable image rebuilds, not ad-hoc production installs;
- model updates require exact revision/hash and inference/regression verification;
- weekly config/manifest backup is active from P6; DB daily/pre-deploy backup activates in P9; monthly off-server copy remains manual;
- maintain deterministic procedures for reboot, low/full disk, service crash, config corruption, bad deploy, and whole-VPS replacement.

## 18. Preflight audit before first VPS change

Collect at least:

```bash
uname -a
cat /etc/os-release
nproc
free -h
df -h
docker --version
docker compose version
ss -lntp
```

If Docker is not installed, record that fact; do not assume the historical document statement “VPS already has Docker” is still true.

Inspect:

- current users and sudo access;
- existing Hermes user/service/path;
- Codex installation/location;
- current ports/listeners;
- DNS resolution;
- CPU/RAM/disk;
- existing firewall rules;
- existing containers/images/volumes if Docker exists.

If free disk is below 20 GB, stop large model/runtime downloads and report a blocker.

## 19. Approval boundary during P6

The architecture choices in this file are already selected. When the user explicitly authorizes **P6**, that authorization includes the non-destructive P6 setup described in `../roadmap/P6-EXECUTION-SPEC.md` (for example creating the approved filesystem/operator account, installing/configuring Docker/Compose, Caddy, Tailscale, Beszel, monitoring, and applying the safe firewall transition after alternate SSH is proven).

Even with P6 authorized, stop and obtain approval before destructive/high-risk changes such as:

- deleting existing data/container/image/volume;
- changing or migrating Hermes runtime/config/ownership;
- closing/replacing the only SSH access path;
- opening public service ports beyond the approved design;
- rotating production secrets;
- destructive database operations;
- replacing existing host services;
- using an unverified model/license.

The current conversation has already selected the target domain/reverse proxy/network model, but the executor still must audit the VPS before applying changes.

## 20. Hardware handoff requirement

Final deployment is not complete until:

- [`../hardware-handoff/DEPLOYMENT-CONFIG.md`](../hardware-handoff/DEPLOYMENT-CONFIG.md) is updated from `NOT_VERIFIED` to `VERIFIED` with evidence;
- fake ESP32 passes through the public HTTPS/WSS hostname;
- endpoint/payload/event behavior matches the canonical hardware contract;
- no real credential is committed into docs;
- the hardware team can use `docs/hardware-handoff/` without backend source access.

## 21. Current phase split

The former single P6 deployment scope is now too broad. Use the dependency-based plan in [`../roadmap/P6-P10-ROADMAP.md`](../roadmap/P6-P10-ROADMAP.md).
