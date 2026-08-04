# Backup, Restore, and Migration Plan

**Status:** `PROPOSED`

## Backup policy

| Artifact | Frequency/retention | Protection |
|---|---|---|
| PostgreSQL logical backup | daily; retain 7–14 days after P9 activation | encrypted, checksum, outside active DB volume |
| PostgreSQL + config recovery bundle | weekly; retain 4 weeks | encrypted, access-restricted |
| Off-server recovery copy | monthly/manual | separate storage and key boundary |
| Model/cache provenance | manifest/hash, not mandatory full copy | reproducible source and revision |
| Pre-deploy snapshot | before every DB-affecting rollout | commit/image/schema/config record |

The current single-VPS `/opt/bmo/backups` layout remains the target operational
shape. No backup is complete until a restore has been exercised.

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
