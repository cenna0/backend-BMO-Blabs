# Production P9 Runtime Definition

**Status:** `PRODUCTION_P9_RUNTIME_DEFINITION_EXECUTED`

The rollout described by this historical preparation runbook completed on
2026-08-19. The future-command sections below are retained as an audit trail;
they are not current deployment instructions or evidence that production is
still pending.

## Frozen artifact and boundary

```text
commit: d1473d04f4b76ccb52cc8eeaff52a268504310f0
image:  joy-p9.1:pairing-code-only-d1473d0
digest: sha256:203817f83a023f730ed5dfd71be8bc96d127001a727c5ebc3d8999e945769973
```

The current production Compose reference uses the immutable deployed image
above. The rollback image `joy-p9.1:spotify-phase26-9819ef7` remains preserved
at digest `sha256:047301dd3ff0f16812d163455fd4f2fe6f12238435651e4f286cf305cc919241`.
Production migration state is `7 completed, 0 unfinished, 0 rolled_back`.

The executed production mutation was limited to migration #7 and Backend-only
cutover. PostgreSQL, Audio, Hermes, WhatsApp, Spotify configuration, Caddy,
firewall, and secrets were preserved; no Docker cleanup or prune was performed.

## Compose structure

```text
/opt/joy/app/ops/deploy/p9.1-production-compose.yml
project: joy-production-p9
services: backend, postgres
```

The Backend uses host networking and remains on `127.0.0.1:3000`. It reaches
the existing runtime dependencies without recreating them:

```text
Hermes                     http://127.0.0.1:8642
Audio Service              http://127.0.0.1:8001
WhatsApp bridge            http://127.0.0.1:3001
WhatsApp identity resolver http://127.0.0.1:3002
```

The production P9 Compose file deliberately does not define Audio, Hermes,
the WhatsApp bridge, or the WhatsApp identity resolver. Their existing
runtime ownership and state remain unchanged.

The current voice-only `docker-compose.yml` had a stale bind for
`/opt/joy/data/avatars`. Read-only runtime evidence showed that the running
voice Backend mounts only `/opt/joy/temp/audio`, and the host avatar path is
absent. The stale voice bind is removed. The frozen P9 Backend does use avatar
storage and bug-report storage, so the P9 definition declares these future
paths separately with `create_host_path: false`.

## Production PostgreSQL

| Property | Production definition |
|---|---|
| Service | `postgres` |
| Compose project | `joy-production-p9` |
| Generated container | `joy-production-p9-postgres-1`; no `container_name` is forced |
| Image | `postgres:16.14-alpine3.22@sha256:786dab398303b8ce7cb76b407bb21ef2e4dfbbbd4c6abcf3d29b3130467ffdbc` |
| Database/user | `bmo` / `bmo` |
| Persistent data | host bind `/opt/joy/data/postgres` → `/var/lib/postgresql/data` |
| Socket | named volume `p9_production_postgres_socket` → `/var/run/postgresql` |
| Network | internal Compose network `p9_private`; no host `ports` entry |
| Backend connection | PostgreSQL Unix socket at `/var/run/postgresql`, with password loaded from `/run/secrets/postgres_password` |
| Healthcheck | `pg_isready` against the configured database/user; 5s interval, 3s timeout, 12 retries |
| Restart | `unless-stopped` after future authorization |
| Limits | 768 MiB memory/swap, 1 CPU, 128 PIDs, max 20 connections |
| Backup identity | encrypted `p9-daily-<UTC>.dump.gpg` / `p9-weekly-<UTC>.dump.gpg` in `/opt/joy/backups/database` |

The data directory is not created by preparation. The host path must be
provisioned with PostgreSQL image UID/GID `70:70`, mode `0700`, after the
operator confirms the pinned image identity. The current same-digest
PostgreSQL runtime reports `uid=70(postgres) gid=70(postgres)`; no production
container was created for this definition.

## Configuration layers

| Layer | Future live path/value | Meaning |
|---|---|---|
| Compose env file | `/opt/joy/config/p9.1/production.compose.env` | Host-side interpolation: image tag, project, storage paths, and host secret source paths |
| Backend env file | `/opt/joy/config/p9.1/backend.env` | Protected application env values, including existing voice credentials plus P9 JWT/pairing values |
| Database password source | `/opt/joy/config/p9.1/postgres-password` | Host secret source; mounted RO as `/run/secrets/postgres_password` to PostgreSQL and Backend |
| Wi-Fi key source | `/opt/joy/config/p9.1/wifi-encryption-key` | Host secret source; mounted RO as `/run/secrets/wifi_encryption_key` |
| Resolver token source | `/opt/joy/config/whatsapp/identity-resolver.token` | Host secret source; mounted RO as `/run/secrets/whatsapp_identity_resolver_token` |
| Spotify client ID source | `/opt/joy/config/p9.1/spotify-client-id` | Host secret source; mounted RO as `/run/secrets/spotify_client_id` |
| Spotify client secret source | `/opt/joy/config/p9.1/spotify-client-secret` | Host secret source; mounted RO as `/run/secrets/spotify_client_secret` |
| Spotify token key source | `/opt/joy/config/p9.1/spotify-token-encryption-key` | Host secret source; mounted RO as `/run/secrets/spotify_token_encryption_key` |
| Backup passphrase | `/opt/joy/config/p9.1/backup-passphrase` | Host-only input to the existing backup/restore operator scripts; not mounted into the long-running Backend |

Required application values include:

```text
NODE_ENV=production
BACKEND_HOST=127.0.0.1
BACKEND_PORT=3000
PUBLIC_BASE_URL=https://api.personaljoy.web.id
P9_ENABLED=true
P9_DATABASE_PASSWORD_FILE=/run/secrets/postgres_password
P9_POSTGRES_SOCKET_DIR=/var/run/postgresql
HERMES_API_URL=http://127.0.0.1:8642
AUDIO_SERVICE_URL=http://127.0.0.1:8001
WHATSAPP_BRIDGE_URL=http://127.0.0.1:3001
WHATSAPP_IDENTITY_RESOLVER_URL=http://127.0.0.1:3002
SPOTIFY_CALLBACK_URL=https://api.personaljoy.web.id/api/v1/integrations/spotify/callback
```

## Secret and storage provisioning contract

Secret files are provisioned out-of-band only. The intended owner/group is
`joy-admin:joy-admin`, mode `0600`; the Docker daemon mounts them read-only,
and the P9 entrypoint reads file-backed values before dropping the Backend
process to runtime UID/GID `1000:1000`. No secret contents are present in the
repository or this document.

| Host path | Intended owner/mode | Container destination | Access |
|---|---|---|---|
| `/opt/joy/config/p9.1/postgres-password` | `joy-admin:joy-admin`, `0600` | `/run/secrets/postgres_password` in PostgreSQL and Backend | RO |
| `/opt/joy/config/p9.1/wifi-encryption-key` | `joy-admin:joy-admin`, `0600` | `/run/secrets/wifi_encryption_key` in Backend | RO |
| `/opt/joy/config/whatsapp/identity-resolver.token` | `joy-admin:joy-admin`, `0600` | `/run/secrets/whatsapp_identity_resolver_token` in Backend | RO |
| `/opt/joy/config/p9.1/spotify-client-id` | `joy-admin:joy-admin`, `0600` | `/run/secrets/spotify_client_id` in Backend | RO |
| `/opt/joy/config/p9.1/spotify-client-secret` | `joy-admin:joy-admin`, `0600` | `/run/secrets/spotify_client_secret` in Backend | RO |
| `/opt/joy/config/p9.1/spotify-token-encryption-key` | `joy-admin:joy-admin`, `0600` | `/run/secrets/spotify_token_encryption_key` in Backend | RO |
| `/opt/joy/config/p9.1/backup-passphrase` | `joy-admin:joy-admin`, `0600` | none; host-only operator input | host read only |
| `/opt/joy/config/p9.1/backend.env` | `joy-admin:joy-admin`, `0600` | Compose `env_file`; not a bind mount | Compose read |
| `/opt/joy/data/postgres` | numeric `70:70`, `0700` | `/var/lib/postgresql/data` | PostgreSQL RW |
| `/opt/joy/data/avatars` | numeric `1000:1000`, `0700` | `/opt/joy/data/avatars` | Backend RW |
| `/opt/joy/data/bug-reports` | numeric `1000:1000`, `0700` | `/opt/joy/data/bug-reports` | Backend RW |
| `/opt/joy/temp/audio` | existing production ownership/policy | `/opt/joy/temp/audio` | Backend RW; unchanged |
| `/opt/joy/backups/database` | `joy-admin:joy-admin`, `0700` | none; host-side backup output | host tool RW |

If host policy disallows numeric UID/GID ownership for the data paths, the
operator must provision equivalent ownership verified against the pinned
images; this definition does not guess or alter that policy.

## Image promotion and proof

The local frozen artifact currently has image ID and repo digest equal to:

```text
sha256:047301dd3ff0f16812d163455fd4f2fe6f12238435651e4f286cf305cc919241
```

Future operator command, **NOT EXECUTED**:

```bash
docker image tag joy-p9.1-candidate:spotify-phase26-9819ef7 joy-p9.1:spotify-phase26-9819ef7
test "$(docker image inspect joy-p9.1:spotify-phase26-9819ef7 --format '{{.Id}}')" = 'sha256:047301dd3ff0f16812d163455fd4f2fe6f12238435651e4f286cf305cc919241'
```

The command is a local metadata retag, not a rebuild, but remains outside
this preparation authorization. Deployment must stop if the ID comparison
fails.

## Future migration runbook

The frozen SHA contains exactly these six migration directories and no others:

```text
20260804110000_p9_1_foundation
20260804123000_p9_1_integrity_constraints
20260811190000_phase2_application_foundation
20260814120000_whatsapp_conversations
20260814210000_whatsapp_identity_aliases
20260815120000_spotify_phase26_lifecycle
```

Future migration command, **NOT EXECUTED**:

```bash
docker compose --project-name joy-production-p9 --env-file /opt/joy/config/p9.1/production.compose.env --file /opt/joy/app/ops/deploy/p9.1-production-compose.yml run --rm --no-deps backend npm run prisma:migrate:deploy
```

Post-migration verification, **NOT EXECUTED**:

```bash
curl --fail --silent --show-error http://127.0.0.1:3000/livez
curl --fail --silent --show-error http://127.0.0.1:3000/readyz
curl --fail --silent --show-error http://127.0.0.1:3000/api/v1/ops/db/livez
curl --fail --silent --show-error http://127.0.0.1:3000/api/v1/ops/db/readyz
curl --fail --silent --show-error http://127.0.0.1:3000/api/v1/ops/db/migrations
```

The migration response must report all six names as finished and
`migration_count` must be `6`. A database rollback is not an automatic down
migration; it requires a separately authorized isolated restore/data-replacement
decision.

## Backup and restore runbook

The existing `backend/src/p9/operator/backup.ts` produces encrypted custom
format PostgreSQL dumps and a sidecar checksum manifest:

```text
/opt/joy/backups/database/p9-daily-<UTC>.dump.gpg
/opt/joy/backups/database/p9-daily-<UTC>.dump.gpg.sha256
```

Retention is seven daily backups and four weekly backups. The off-VPS copy
point remains an operator-selected encrypted destination outside this VPS.

Future production backup command, **NOT EXECUTED**:

```bash
cd /opt/joy/app/backend
P9_COMPOSE_FILE=/opt/joy/app/ops/deploy/p9.1-production-compose.yml P9_COMPOSE_PROJECT=joy-production-p9 P9_COMPOSE_ENV_FILE=/opt/joy/config/p9.1/production.compose.env P9_BACKUP_DIR=/opt/joy/backups/database P9_BACKUP_PASSPHRASE_FILE=/opt/joy/config/p9.1/backup-passphrase npm run p9:backup
```

Future checksum verification, **NOT EXECUTED**:

```bash
cd /opt/joy/backups/database
backup_file="$(find . -maxdepth 1 -type f -name 'p9-daily-*.dump.gpg' -printf '%T@ %f\n' | sort -nr | head -n 1 | cut -d' ' -f2-)"
test -n "${backup_file}"
sha256sum --check "${backup_file}.sha256"
```

Future isolated restore uses a separate Compose project, data directory, and
database. The bootstrap database must differ from the restore target because
the verified restore tool refuses to restore into its primary database. Every
command in this sequence is **NOT EXECUTED**:

```bash
restore_stamp=<operator-chosen-UTC-stamp>
restore_project="joy-production-p9-restore-${restore_stamp}"
restore_root="/opt/joy/restore/p9/${restore_stamp}"
restore_bootstrap_db=bmo_restore_bootstrap
restore_database="bmo_restore_${restore_stamp}"
backup_path=/opt/joy/backups/database/p9-daily-<UTC>.dump.gpg
sudo install -d -o 70 -g 70 -m 0700 "${restore_root}/postgres"
P9_POSTGRES_DATA_DIR="${restore_root}/postgres" P9_POSTGRES_DB="${restore_bootstrap_db}" docker compose --project-name "${restore_project}" --env-file /opt/joy/config/p9.1/production.compose.env --file /opt/joy/app/ops/deploy/p9.1-production-compose.yml up -d postgres
cd /opt/joy/app/backend
P9_COMPOSE_FILE=/opt/joy/app/ops/deploy/p9.1-production-compose.yml P9_COMPOSE_PROJECT="${restore_project}" P9_COMPOSE_ENV_FILE=/opt/joy/config/p9.1/production.compose.env P9_POSTGRES_DB="${restore_bootstrap_db}" P9_RESTORE_DATABASE="${restore_database}" P9_BACKUP_PASSPHRASE_FILE=/opt/joy/config/p9.1/backup-passphrase npm run p9:restore -- "${backup_path}"
```

Future isolated restore integrity verification, **NOT EXECUTED**:

```bash
docker compose --project-name "${restore_project}" --env-file /opt/joy/config/p9.1/production.compose.env --file /opt/joy/app/ops/deploy/p9.1-production-compose.yml exec -T -e RESTORE_DATABASE="${restore_database}" postgres sh -ceu 'export PGPASSWORD="$(cat /run/secrets/postgres_password)"; test "$(psql -Atqc "SELECT 1" -U "$POSTGRES_USER" -d "$POSTGRES_DB")" = 1; test "$(psql -Atqc "SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL" -U "$POSTGRES_USER" -d "$RESTORE_DATABASE")" = 6; psql -Atqc "SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY started_at" -U "$POSTGRES_USER" -d "$RESTORE_DATABASE"'
```

After evidence is recorded, the isolated project and data directory may be
removed by the operator under separate cleanup authorization; no cleanup was
performed by this task.

## Backend-only rollback

Future application rollback, **NOT EXECUTED**:

```bash
docker compose --project-name joy-production-p9 --env-file /opt/joy/config/p9.1/production.compose.env --file /opt/joy/app/ops/deploy/p9.1-production-compose.yml up -d --no-deps backend
```

This does not recreate Audio, Hermes, WhatsApp, or PostgreSQL, and it does not
run a migration.

## Caddy

`NO_CADDY_CHANGE_REQUIRED`.

```text
https://api.personaljoy.web.id -> 127.0.0.1:3000
```

No candidate `:3010` callback patch is installed or referenced. The Spotify
production callback is the HTTPS URL declared above.

## Future host provisioning commands

The following path commands are future operator actions, **NOT EXECUTED**:

```bash
sudo install -d -o 70 -g 70 -m 0700 /opt/joy/data/postgres
sudo install -d -o 1000 -g 1000 -m 0700 /opt/joy/data/avatars
sudo install -d -o 1000 -g 1000 -m 0700 /opt/joy/data/bug-reports
sudo install -d -o joy-admin -g joy-admin -m 0700 /opt/joy/backups/database
sudo chown joy-admin:joy-admin /opt/joy/config/p9.1/backend.env
sudo chmod 0600 /opt/joy/config/p9.1/backend.env
sudo chown joy-admin:joy-admin /opt/joy/config/p9.1/postgres-password /opt/joy/config/p9.1/wifi-encryption-key /opt/joy/config/p9.1/spotify-client-id /opt/joy/config/p9.1/spotify-client-secret /opt/joy/config/p9.1/spotify-token-encryption-key /opt/joy/config/p9.1/backup-passphrase /opt/joy/config/whatsapp/identity-resolver.token
sudo chmod 0600 /opt/joy/config/p9.1/postgres-password /opt/joy/config/p9.1/wifi-encryption-key /opt/joy/config/p9.1/spotify-client-id /opt/joy/config/p9.1/spotify-client-secret /opt/joy/config/p9.1/spotify-token-encryption-key /opt/joy/config/p9.1/backup-passphrase /opt/joy/config/whatsapp/identity-resolver.token
```

These commands do not create or populate secret files. Secret delivery,
provider credential registration, OAuth, WhatsApp pairing, and rotation remain
outside this task.

## Final future promotion sequence

This is the complete future promotion runbook. Every phase below is
**NOT EXECUTED** by this preflight.

### PHASE A — provision production paths/config/secrets

Provision the directories and protected files using the commands above. The
operator must deliver the real values out-of-band into the exact paths and
verify metadata without printing file contents:

```bash
stat -c 'mode=%a owner=%U:%G path=%n' \
  /opt/joy/config/p9.1/production.compose.env \
  /opt/joy/config/p9.1/backend.env \
  /opt/joy/config/p9.1/postgres-password \
  /opt/joy/config/p9.1/wifi-encryption-key \
  /opt/joy/config/whatsapp/identity-resolver.token \
  /opt/joy/config/p9.1/spotify-client-id \
  /opt/joy/config/p9.1/spotify-client-secret \
  /opt/joy/config/p9.1/spotify-token-encryption-key \
  /opt/joy/config/p9.1/backup-passphrase
```

### PHASE B — verify and promote the frozen image tag

```bash
candidate_id="$(docker image inspect joy-p9.1-candidate:spotify-phase26-9819ef7 --format '{{.Id}}')"
test "$candidate_id" = 'sha256:047301dd3ff0f16812d163455fd4f2fe6f12238435651e4f286cf305cc919241'
docker image tag joy-p9.1-candidate:spotify-phase26-9819ef7 joy-p9.1:spotify-phase26-9819ef7
production_id="$(docker image inspect joy-p9.1:spotify-phase26-9819ef7 --format '{{.Id}}')"
test "$production_id" = "$candidate_id"
test "$production_id" = 'sha256:047301dd3ff0f16812d163455fd4f2fe6f12238435651e4f286cf305cc919241'
```

Stop if any check fails. This is a local metadata retag, never a rebuild.

### PHASE C — start only production PostgreSQL

```bash
docker compose --project-name joy-production-p9 \
  --env-file /opt/joy/config/p9.1/production.compose.env \
  --file /opt/joy/app/ops/deploy/p9.1-production-compose.yml \
  up -d postgres
```

### PHASE D — verify PostgreSQL health and private exposure

```bash
docker compose --project-name joy-production-p9 \
  --env-file /opt/joy/config/p9.1/production.compose.env \
  --file /opt/joy/app/ops/deploy/p9.1-production-compose.yml ps postgres
docker inspect joy-production-p9-postgres-1 \
  --format 'ports={{json .NetworkSettings.Ports}} health={{.State.Health.Status}}'
docker compose --project-name joy-production-p9 \
  --env-file /opt/joy/config/p9.1/production.compose.env \
  --file /opt/joy/app/ops/deploy/p9.1-production-compose.yml \
  exec -T postgres sh -ceu 'export PGPASSWORD="$(cat /run/secrets/postgres_password)"; pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"; test "$(psql -Atqc "SELECT to_regclass(\$\$public._prisma_migrations\$\$)" -U "$POSTGRES_USER" -d "$POSTGRES_DB")" = ""'
```

The empty migration-state check is expected to return no migration table before
the first migration.

### PHASE E — encrypted backup checkpoints

After PostgreSQL is healthy and before migrations, create the empty encrypted
baseline backup to prove the production backup path. After migrations and
before Backend cutover, create a second schema-bearing backup. The first
meaningful data-bearing checkpoint is the latter because the new database is
otherwise empty.

```bash
cd /opt/joy/app/backend
P9_COMPOSE_FILE=/opt/joy/app/ops/deploy/p9.1-production-compose.yml \
P9_COMPOSE_PROJECT=joy-production-p9 \
P9_COMPOSE_ENV_FILE=/opt/joy/config/p9.1/production.compose.env \
P9_BACKUP_DIR=/opt/joy/backups/database \
P9_BACKUP_PASSPHRASE_FILE=/opt/joy/config/p9.1/backup-passphrase \
npm run p9:backup
```

Verify the generated `.sha256` sidecar before proceeding. Repeat the same
command after Phase G, optionally with `P9_BACKUP_KIND=weekly` for the
schema-bearing pre-cutover checkpoint.

### PHASE F — deploy exactly six migrations

```bash
docker compose --project-name joy-production-p9 \
  --env-file /opt/joy/config/p9.1/production.compose.env \
  --file /opt/joy/app/ops/deploy/p9.1-production-compose.yml \
  run --rm --no-deps backend npm run prisma:migrate:deploy
```

### PHASE G — verify migration history, schema, and integrity

```bash
docker compose --project-name joy-production-p9 \
  --env-file /opt/joy/config/p9.1/production.compose.env \
  --file /opt/joy/app/ops/deploy/p9.1-production-compose.yml \
  exec -T postgres sh -ceu 'export PGPASSWORD="$(cat /run/secrets/postgres_password)"; test "$(psql -Atqc "SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL" -U "$POSTGRES_USER" -d "$POSTGRES_DB")" = 6; psql -Atqc "SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY started_at" -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
```

The output must contain exactly the six names listed above, with no seventh
migration. Run the second encrypted backup checkpoint here before cutover.

### PHASE H — replace only the production Backend

Record the old Backend image digest and health first. Stop only the old
production Backend so the new project can bind port 3000; do not stop Audio.
Then start only the new Backend with `--no-deps`:

```bash
BACKEND_IMAGE=joy-backend@sha256:e981751498fca13bf1f1c1c046a6874a490b3e681aeef9787a53181059506fd7 \
AUDIO_IMAGE=joy-audio@sha256:62ad9adead83d863ab2bf28a2ac75e5a116dc68bab8ff06eec81b7a0407ddb34 \
BACKEND_ENV_FILE=/opt/joy/config/backend.env \
AUDIO_ENV_FILE=/opt/joy/config/audio.env \
docker compose --project-name joy-production --file /opt/joy/app/docker-compose.yml stop backend

docker compose --project-name joy-production-p9 \
  --env-file /opt/joy/config/p9.1/production.compose.env \
  --file /opt/joy/app/ops/deploy/p9.1-production-compose.yml \
  up -d --no-deps backend
```

### PHASE I — verify internal Backend health

```bash
curl --fail --silent --show-error http://127.0.0.1:3000/livez >/dev/null
curl --fail --silent --show-error http://127.0.0.1:3000/readyz >/dev/null
curl --fail --silent --show-error http://127.0.0.1:3000/api/v1/ops/db/livez >/dev/null
curl --fail --silent --show-error http://127.0.0.1:3000/api/v1/ops/db/readyz >/dev/null
```

### PHASE J — verify public health

```bash
curl --fail --silent --show-error https://api.personaljoy.web.id/health >/dev/null
```

### PHASE K — minimal mobile auth and DB-backed reads

Use an already authorized test account and keep its access token only in the
operator shell. Do not print response bodies or the token:

```bash
: "${JOY_ACCESS_TOKEN:?set an operator-held access token without printing it}"
curl --fail --silent --show-error -H "Authorization: Bearer ${JOY_ACCESS_TOKEN}" https://api.personaljoy.web.id/api/v1/me | jq -e '.user.id != null' >/dev/null
curl --fail --silent --show-error -H "Authorization: Bearer ${JOY_ACCESS_TOKEN}" https://api.personaljoy.web.id/api/v1/devices | jq -e '.devices | type == "array"' >/dev/null
curl --fail --silent --show-error -H "Authorization: Bearer ${JOY_ACCESS_TOKEN}" https://api.personaljoy.web.id/api/v1/chat/sessions | jq -e 'type == "array"' >/dev/null
```

### PHASE L — verify mobile WebSocket upgrade/auth

Send only the protocol authentication event; do not send chat or provider
actions:

```bash
: "${JOY_ACCESS_TOKEN:?set an operator-held access token without printing it}"
node --input-type=module <<'NODE'
import WebSocket from "/opt/joy/app/backend/node_modules/ws/index.js";
const socket = new WebSocket("wss://api.personaljoy.web.id/api/v1/ws");
const timer = setTimeout(() => { socket.terminate(); process.exit(1); }, 10000);
socket.on("open", () => socket.send(JSON.stringify({ event: "authenticate", accessToken: process.env.JOY_ACCESS_TOKEN })));
socket.on("message", (data) => {
  const value = JSON.parse(data.toString());
  if (value.event !== "authenticated" || value.status !== "ok") process.exit(1);
  clearTimeout(timer);
  socket.close();
  console.log("mobile_ws_auth=ok");
});
socket.on("error", () => process.exit(1));
NODE
```

### PHASE M — verify WhatsApp health/status without `/messages`

```bash
curl --fail --silent --show-error http://127.0.0.1:3001/health >/dev/null
curl --fail --silent --show-error http://127.0.0.1:3002/health >/dev/null
curl --fail --silent --show-error -H "Authorization: Bearer ${JOY_ACCESS_TOKEN}" https://api.personaljoy.web.id/api/v1/integrations/whatsapp/status >/dev/null
```

Do not call the bridge `/messages` endpoint and do not send or receive a
WhatsApp message during this phase.

### PHASE N — verify Spotify read-only status

```bash
curl --fail --silent --show-error -H "Authorization: Bearer ${JOY_ACCESS_TOKEN}" https://api.personaljoy.web.id/api/v1/integrations/spotify/status >/dev/null
```

Do not start OAuth, playback, action, refresh, or disconnect flows.

### PHASE O — minimal safe voice smoke

Use the existing operator-held device credential, an already authenticated
device WebSocket, and one short known-good canonical WAV fixture. Send one
request only, verify one `202 processing` response and one `audio_ready` event,
then acknowledge playback. Do not run the full P7 acceptance loop, duplicate
request checks, failure probes, or long-form voice acceptance.

### PHASE P — observe stability and record the checkpoint

For the agreed observation window, record Backend/PostgreSQL health, restart
counts, OOM flags, disk/RAM, and sanitized error counts without printing logs
that may contain credentials. Keep the promotion checkpoint only if there is
no restart loop, OOM, secret exposure, database error, or dependency
regression.

## Promotion rollback checkpoints

- Before Phase H: old Backend remains serving; abort without touching it if
  PostgreSQL, backup, migration, or schema verification fails.
- After old Backend stop but before P9 health passes: stop only the new P9
  Backend and restore the old Backend with its pinned image/config using
  `docker compose ... up -d --no-deps backend`; leave PostgreSQL data intact.
- After P9 health passes but during observation: perform the same Backend-only
  rollback; do not run a down migration or delete PostgreSQL data.
- A database restore is a separate controlled decision using the isolated
  restore procedure above, never an automatic application rollback.

## Static validation record

The static suite confirms YAML/Compose rendering with temporary fixture files,
production callback/ports/private database, read-only secret mounts, absence
of external service definitions, production-only paths, the stale avatar-mount
resolution, the exact six migrations, and the Backend-only `--no-deps`
rollback command. It does not start or inspect the production P9 runtime.

## Operator state confirmation

No runtime/service/database/provider/Caddy/firewall/secret state changed while
preparing this definition. No commit or push was performed.
