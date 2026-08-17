# Production P9 Runtime Definition Design

**Status:** Approved for preparation and static validation only

**Frozen application artifact:**

- Commit: `9819ef7c05bd9c71ea153feffc41ca8f96695287`
- Image: `bmo-p9.1-candidate:spotify-phase26-9819ef7`
- Image ID/digest: `sha256:047301dd3ff0f16812d163455fd4f2fe6f12238435651e4f286cf305cc919241`

## Goal

Define a deterministic production P9 runtime without deploying it, starting
PostgreSQL, running migrations or backups, changing Caddy, or recreating the
existing Audio, Hermes, WhatsApp bridge, or WhatsApp identity resolver
runtime.

## Architecture

The production definition is a separate Compose file containing only
`backend` and `postgres`. The Backend uses host networking and binds
`127.0.0.1:3000`, so it retains the existing Caddy origin and can reach the
existing loopback dependencies. PostgreSQL uses PostgreSQL 16.14 at the
verified digest, an internal Compose network, a shared Unix-socket volume, and
the production bind path `/opt/bmo/data/postgres`; it has no published host
port.

The existing `docker-compose.yml` remains the voice runtime definition. Its
stale `/opt/bmo/data/avatars` bind is removed because the current voice-only
Backend does not mount or use it and the host path does not exist. The P9
Compose definition separately declares `/opt/bmo/data/avatars` and
`/opt/bmo/data/bug-reports` as required future writable production paths with
`create_host_path: false`. This makes the path required for P9 without
creating it during preparation.

## Configuration and secrets

Two sanitized templates separate Compose interpolation from application
configuration:

- `ops/deploy/p9.1-production.compose.env.example` contains production image,
  project, host path, and host secret-file path variables only.
- `ops/deploy/p9.1-production.backend.env.example` contains application
  values and placeholders for values that must be supplied out-of-band.

The Compose file maps host secret sources to read-only `/run/secrets/*`
destinations for PostgreSQL, Wi-Fi encryption, WhatsApp resolver, and Spotify
credentials. JWT and pairing secrets remain application env values because the
frozen Backend supports those as values rather than `_FILE` settings; the
protected Backend env file is therefore owner-readable and never committed.
The backup passphrase remains host-side for the existing host operator tool
and is not mounted into the long-running Backend.

## Image identity

The production Compose file accepts only an explicit production image
reference and contains no build section. The current local candidate image is
tagged under a candidate repository name, so preparation does not retag it.
Future provisioning may perform a metadata-only local retag to
`bmo-p9.1:spotify-phase26-9819ef7`, then must compare the production tag's
image ID to the frozen digest before any deployment. The production Compose
never refers to the candidate project or candidate validation paths.

## Backup and restore

The production backup directory is `/opt/bmo/backups/database`, separate from
candidate backup directories. Existing `p9:backup` writes AES-256 encrypted
custom-format dumps and `.sha256` sidecars with seven daily/four weekly
retention. Existing `p9:restore` is used against a fresh isolated Compose
project, fresh PostgreSQL data directory, and fresh restore database. All
backup, restore, checksum, and teardown commands are documented as future
commands and marked not executed.

## Migration and rollback boundary

The frozen SHA contains exactly six migration directories, matching
`P9_REQUIRED_MIGRATIONS`. The future migration command is
`docker compose ... run --rm --no-deps backend npm run prisma:migrate:deploy`.
Application rollback remains Backend-only with
`docker compose ... up -d --no-deps backend`; no automatic database down
migration is defined.

## Caddy and external dependencies

`NO_CADDY_CHANGE_REQUIRED`. The existing route remains
`https://api.personalbmo.web.id` to `127.0.0.1:3000`. The candidate `:3010`
callback patch is not used. Audio `:8001`, Hermes `:8642`, WhatsApp bridge
`:3001`, and WhatsApp resolver `:3002` remain external existing runtime
dependencies and are absent from the production P9 Compose service list.

## Validation

Static tests render the production Compose file with fixture paths and assert
the production callback, loopback Backend port, private PostgreSQL, read-only
secret mounts, production-only paths, absent external services, no candidate
validation references, independent Backend targeting, and the six migration
names. Docker Compose validation uses fixture secret files only and never
reads or writes live secret contents.
