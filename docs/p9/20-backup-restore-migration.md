# Backup, Restore, and Migration Plan

**Status:** `HISTORICAL P9.1 BASELINE; DESTINATION OPEN AT DOCUMENT DATE — SUPERSEDED`

This document preserves the earlier decision state. Its `OPEN` off-VPS
destination statements are superseded for the P9.1 first canary by the current
operator decision in
[`P9.1-PRODUCTION-DECISION-REGISTER.md`](P9.1-PRODUCTION-DECISION-REGISTER.md):
Windows operator PC, PowerShell, Tailscale, Windows OpenSSH `scp.exe`, and
weekly manual pull. The current executable procedure is
[`P9.1-WINDOWS-OFF-VPS-BACKUP-GUIDE.md`](P9.1-WINDOWS-OFF-VPS-BACKUP-GUIDE.md).

## Backup policy

| Artifact | Frequency/retention | Protection |
|---|---|---|
| Scheduled `pg_dump` | seven daily backups | encrypted, checksum, outside active DB volume |
| PostgreSQL + config recovery bundle | four weekly backups | encrypted, access-restricted |
| Off-VPS recovery copy | required before final production sign-off | historical destination was OPEN; superseded for the first canary by the locked Windows operator-PC decision |
| Model/cache provenance | manifest/hash, not mandatory full copy | reproducible source and revision |
| Pre-deploy snapshot | before every DB-affecting rollout | commit/image/schema/config record |

The current single-VPS `/opt/bmo/backups` layout remains the target operational
shape. Checksums and encryption are mandatory. No backup is complete until an
isolated restore has been exercised and verified. The historical provider/location
was OPEN; the first-canary destination is now the locked Windows operator PC,
with the real Windows transfer and restore still pending.

## Restore rehearsal

1. Record source commit, schema version, backup checksum, and key version.
2. Provision an isolated private restore target; never overwrite production
   during rehearsal.
3. Restore PostgreSQL and decrypt only through the controlled operator path.
4. Run Prisma/schema consistency checks, row-count/foreign-key checks,
   application health, auth ownership, chat/memory deletion, schedule status,
   and provider-token decryptability tests.
5. Record elapsed time, failures, data-loss boundary, and sanitized evidence.
6. Destroy the rehearsal target and rotate temporary access.

## Migration discipline

- Migrations are committed, reviewed, deterministic, and forward-only in the
  normal rollout path.
- Use `prisma migrate dev` only in development and `prisma migrate deploy` for
  controlled production rollout. Never use `prisma db push` in production.
- Do not run migrations automatically during container startup and do not use
  destructive reset or blind down migration.
- Prefer expand → deploy compatible code → backfill → contract cleanup.
- No migration drops/renames data in the same release as code that still needs
  the old shape.
- Before migration: backup, lock target commit, confirm disk headroom, and
  run against a sanitized restore.
- After migration: health/readiness, representative API checks, background
  worker paused until schema compatibility is proven, then canary enablement.

## Rollback boundary

Application image/config rollback is expected to be fast. Database rollback is
not an automatic down-migration: if a migration is destructive or incompatible,
restore the last verified backup into a controlled target and obtain explicit
approval for data replacement. The rollback record must state possible data
loss and the last accepted schema version.
