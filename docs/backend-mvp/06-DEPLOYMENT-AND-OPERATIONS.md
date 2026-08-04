# BMO Backend MVP — Deployment and Operations

**Versi:** 1.2.0
**Status:** VERIFIED — PRODUCTION
**Last audited:** 2026-08-03

> This file records the verified P8 production runtime and ongoing operational
> rules. Piper Prudence is fixed primary TTS; Kokoro `af_heart` at `0.80` is
> automatic fallback; RVC remains disabled. P9 PostgreSQL/Prisma and P10
> physical ESP32 work remain separate phases.

## 0.1 Current P8 TTS deployment

```text
Primary        Piper en_GB-semaine-medium / prudence / speaker ID 0
Fallback       Kokoro af_heart / speed 0.80
RVC            RVC_ENABLED=false
Architecture   integrated persistent Piper worker inside Audio Service
Piper assets    /opt/bmo/models/piper (read-only, outside Git)
Voice selector not implemented
Database       not implemented; P9 is next
```

The complete source/image/canary/rollback record is
[`P8-PRODUCTION-ROLLOUT-EVIDENCE.md`](P8-PRODUCTION-ROLLOUT-EVIDENCE.md).

## 0. Current verified P7 deployment

```text
Deployment source
  4d7b472adc4c2243d8f7364032a491ad70efb6d3

Backend image
  bmo-backend@sha256:e981751498fca13bf1f1c1c046a6874a490b3e681aeef9787a53181059506fd7

Audio image
  bmo-audio@sha256:62d8b48feb978e303831e20dc558cb95d3240af9a3cf09e8dcd0c82142986e7e

Public
  HTTPS/WSS verified through Caddy on public TCP 80/443 only

Private origins
  backend       127.0.0.1:3000
  Audio Service 127.0.0.1:8001
  Hermes        127.0.0.1:8642

Administration
  SSH through the approved Tailscale-only path
```

P7 public acceptance passed `23/23`; the final 3,665-second resource soak
passed `13/13` samples with no new OOM and zero application restarts. The fresh
protected pre-cutover backup is `20260730T115645Z`. The retained P6 Caddy
rollback source SHA-256 is
`80150fb3cc50616638efdd4121a4061c18ad632e05d6e06d34448ddcf321554b`.

Full sanitized evidence:
[`P7-TEST-EVIDENCE.md`](P7-TEST-EVIDENCE.md).

## 1. Deployment principles

- Git repository is the source of code truth.
- `main` is the production deployment branch.
- Source is cloned/pulled on the VPS, but runtime code runs from built Docker images.
- Editing source on the VPS does not change the running production container until build/deploy occurs.
- Persistent data, models, secrets, and backups live outside the Git checkout.
- Hermes remains a host runtime and is never Dockerized.
- If Hermes is present, preserve its proven ownership/path/config/runtime. If Hermes is absent, P6 owns initial host bootstrap.
- Codex is an admin/development tool, not a BMO runtime dependency.
- Production public traffic uses domain + HTTPS/WSS through Caddy.
- Internal service ports are not exposed to the public internet.
- Docker Compose remains the deployment source of truth; Portainer is not required.

## 2. Agreed public names

```text
BMO API / WSS : api.personalbmo.web.id
Monitoring    : monitor.personalbmo.web.id
```

Verified public URLs:

```text
https://api.personalbmo.web.id
wss://api.personalbmo.web.id/ws
https://monitor.personalbmo.web.id
```

Beszel may be publicly reachable through HTTPS/login, but its origin port must not be public.

## 3. Host user model

Verified operational separation:

```text
root
└── emergency/system administration only

bmo-admin
├── daily SSH/admin account
├── Codex (configured for this account; do not blindly copy another user's auth state)
├── Git checkout/deployment
├── Docker Compose operations
└── sudo when required

Hermes runtime ownership
└── preserve proven ownership if present; select from actual install/runtime requirements if absent
```

Do **not** create a Linux host user named `docker` just to run containers. Docker is a daemon/service; each container runs under its own appropriate non-root runtime user where supported.

Before changing Hermes state, classify it from process, service/supervisor, listener, installation/runtime, and path evidence:

- **If Hermes is present**, audit the actual user, service definition, install/config/data paths, listener, and health; a stable installation wins over cosmetic restructuring.
- **If Hermes is absent** on a fresh/replacement host, use the recorded P6
  bootstrap procedure: install/configure the host runtime, bind it only to
  `127.0.0.1:8642`, choose ownership appropriate to the actual installation
  model, and create a maintainable startup/service mechanism.

Do not create a dedicated Hermes Linux user unless the installation/runtime model or a proven security/operational need requires one. Record the actual decision and evidence.

## 4. Current production filesystem

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
│   └── caddy/
│       └── Caddyfile
│
├── models/                   # provisioning + curated model assets
│   ├── hf-cache/             # upstream provisioning cache
│   └── runtime/              # curated read-only production mount
│       └── MODEL_MANIFEST.json
│
├── cache/
│   └── audio/                # Audio Service writable runtime cache
│       ├── huggingface/
│       ├── torch/
│       └── xdg/
│
├── data/                     # persistent writable service data
│   └── beszel/
│
├── temp/
│   ├── audio/                # backend generated audio
│   └── tts/                  # Audio Service intermediates
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

Future/unprovisioned paths are not part of the P7 runtime baseline:

```text
/opt/bmo/models/rvc/      removed from production; archived evidence is outside runtime tree
/opt/bmo/data/postgres/   P9 only
/opt/bmo/config/postgres.env  P9 only
```

## 5. Ownership and permissions

Verified P7 baseline:

```text
/opt/bmo/app               → bmo-admin managed
/opt/bmo/config            → restricted; deploy operator access only as required
/opt/bmo/config/*.env      → baseline `bmo-admin:bmo-admin`, mode 600 (or a stricter root-owned scheme only if the proven sudo deploy workflow can still read them)
/opt/bmo/config/caddy      → recoverable Caddy source; effective runtime Caddyfile must be readable by the Caddy service without granting Caddy access to secret env files
/opt/bmo/models/hf-cache   → authorized provisioning only
/opt/bmo/models/runtime    → curated production model mount, read-only
/opt/bmo/cache/audio       → Audio UID/GID `10001:10001`, mode 0750
/opt/bmo/data/beszel       → Beszel runtime ownership as required
/opt/bmo/temp/audio        → backend UID/GID `1000:1000`, mode 0750
/opt/bmo/temp/tts          → Audio UID/GID `10001:10001`, mode 0750
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
# P7 production runs without PostgreSQL.

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

HF_HOME=/opt/bmo/cache/audio/huggingface
TORCH_HOME=/opt/bmo/cache/audio/torch
XDG_CACHE_HOME=/opt/bmo/cache/audio/xdg
RUNTIME_MODELS_ROOT=/opt/bmo/models/runtime
MODEL_MANIFEST_PATH=/opt/bmo/models/runtime/MODEL_MANIFEST.json
TTS_TEMP_DIR=/opt/bmo/temp/tts
MODEL_DOWNLOAD_ALLOWED=false
HF_HUB_OFFLINE=1
TRANSFORMERS_OFFLINE=1

WHISPER_MODEL=medium
WHISPER_MODEL_REPO=Systran/faster-whisper-medium
WHISPER_MODEL_REVISION=08e178d48790749d25932bbc082711ddcfdfbc4f
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
KOKORO_MODEL_REPO=hexgrad/Kokoro-82M
KOKORO_MODEL_REVISION=f3ff3571791e39611d31c381e3a41a3af07b4987
KOKORO_SAMPLE_RATE=24000

TTS_PRIMARY_ENGINE=piper
PIPER_MODEL=en_GB-semaine-medium
PIPER_SPEAKER=prudence
PIPER_SPEAKER_ID=0
PIPER_ASSET_MANIFEST_PATH=/opt/bmo/models/piper/PIPER_ASSET_MANIFEST.json

RVC_ENABLED=false
# Archived RVC runtime settings are intentionally absent from production.

OUTPUT_MP3_SAMPLE_RATE=24000
OUTPUT_MP3_BITRATE=96k
```

RVC artifacts are not provisioned in current production. The P8 RVC branch is
archived and was not merged because its canary required a larger host. Do not
guess filenames, enable RVC, or use runtime downloads.

### `postgres.env` — P9 only

PostgreSQL/Prisma is not implemented or deployed. P9 generates the database
name/user/password and activates `DATABASE_URL`; do not create or require those
credentials before P9 authorization, and never commit them.

Real secret values must never appear in docs, Git history, logs, or deployment reports.

## 7. Current verified runtime topology

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

Verified P7 networking uses the original proven host-access model:
`bmo-backend` uses Linux `network_mode: host`, binds the production origin to
`127.0.0.1:3000`, and calls the P6-verified host-loopback Hermes at
`127.0.0.1:8642`. `bmo-audio-service` stays on normal container networking and
publishes only `127.0.0.1:8001:8001`. Caddy is the only public application
path. P9 PostgreSQL, if later authorized, must remain private and may expose
`127.0.0.1:5432` only if its reviewed topology requires it. Never expose
backend, Audio Service, Hermes, or PostgreSQL merely to simplify networking.

P7 completed backend/audio → Hermes integration only. Initial Hermes
installation remained P6 ownership when preflight proved it absent.

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

Docker logs use bounded rotation (`10m`, 3 files per service). Health checks
reflect actual readiness, not process existence; P7 verified the Audio Service
model-loading grace period and separated liveness from readiness to avoid
restart loops during mandatory model initialization.

## 9. Reverse proxy and TLS

Caddy is the verified production reverse proxy and runs as a **host system
service**. A recoverable source remains under `/opt/bmo/config/caddy/`; the
effective `/etc/caddy/Caddyfile` uses explicit Caddy-readable ownership and
mode without granting Caddy access to backend/audio secret env files.

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

Verified public exposure:

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

SSH administration is available only through the approved Tailscale path.
Public SSH is not an approved production exposure. Never change firewall or
Tailscale state in a way that closes the only working admin path.

Tailscale is for server administration; BMO devices use the public domain through HTTPS/WSS.

## 11. Beszel monitoring

Beszel is required in the infrastructure plan; Portainer is currently skipped. Deploy a pinned/tested **Hub + local Agent** pair from `/opt/bmo/deploy/infra-compose.yml`. Bind/publish the Hub only to host loopback (baseline `127.0.0.1:8090`) so Caddy is the sole public path. Prefer a supported local Unix socket between Agent and Hub when available; otherwise keep the Agent listener private/local. Docker telemetry may use a read-only Docker socket mount. Never expose the Agent listener or Docker socket publicly.

Verified public dashboard:

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

## 13. RVC deployment ownership — Archived P8 boundary

RVC belongs to Audio Service, not Express backend.

Possible future asset path, not provisioned in P7:

```text
/opt/bmo/models/rvc/bmo/
```

The following flow is retained as historical P8 planning/evidence context only;
it is not a current production deployment instruction:

```text
RVC evidence/archive boundary — no runtime artifact or enablement
```

Historical flow:

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

Current production status: `RVC_ENABLED=false`; RVC runtime and Docker
artifacts were removed after P8 cleanup. Compact evidence and Git history are
retained. The current production TTS boundary is Piper Prudence → Kokoro
fallback; no RVC provisioning or rollout is authorized by this file.

## 14. PostgreSQL readiness

PostgreSQL + Prisma are future application-data infrastructure and are intentionally separate from voice request state. The final P9 application-platform proposal is in [`../p9/README.md`](../p9/README.md); it is not implementation evidence.

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
- Hermes process/service/supervisor/listener/install/runtime/path evidence, then classify `PRESENT` or `ABSENT`;
- Codex installation/location;
- current ports/listeners;
- DNS resolution;
- CPU/RAM/disk;
- existing firewall rules;
- existing containers/images/volumes if Docker exists.

If free disk is below 20 GB, stop large model/runtime downloads and report a blocker.

## 19. Historical approval boundary during P6

This section records the completed P6 authority boundary; it is not current
execution authorization. The explicitly authorized P6 run included the
non-destructive setup described in `../roadmap/P6-EXECUTION-SPEC.md` (for
example approved filesystem/operator setup, Docker/Compose, Caddy, Tailscale,
Beszel, monitoring, safe firewall transition, and conditional Hermes host
bootstrap).

The same safety principle remains: stop and obtain approval before
destructive/high-risk changes such as:

- deleting existing data/container/image/volume;
- changing, reinstalling, or migrating a Hermes runtime/config/ownership that preflight found present;
- closing/replacing the only SSH access path;
- opening public service ports beyond the approved design;
- rotating production secrets;
- destructive database operations;
- replacing existing host services;
- using an unverified model/license.

Future executors must audit the live VPS before applying changes and preserve
the verified P7 domain/reverse-proxy/network baseline unless separately
authorized evidence requires a change.

## 20. Hardware deployment handoff

P7 deployment handoff is complete because:

- [`../hardware-handoff/DEPLOYMENT-CONFIG.md`](../hardware-handoff/DEPLOYMENT-CONFIG.md) is `VERIFIED` with evidence;
- fake ESP32 passed `23/23` through the public HTTPS/WSS hostname;
- endpoint/payload/event behavior matches the canonical hardware contract;
- no real credential is committed into docs;
- the hardware team can use `docs/hardware-handoff/` without backend source access.

This does not make physical hardware verified. `PHYSICAL_ESP32_STATUS` remains
`NOT_RUN`; `HARDWARE INTEGRATION VERIFIED` remains a P10 classification.

## 21. Current phase split

P6, P7, and P8 are complete. P8 fixed Piper Prudence as primary, retains
Kokoro fallback, and leaves real RVC inference archived and disabled. P9/P10
remain dependency-gated. Use [`../NEXT-ACTION.md`](../NEXT-ACTION.md) and the roadmap in
[`../roadmap/P6-P10-ROADMAP.md`](../roadmap/P6-P10-ROADMAP.md).
