# Backup, Restore, and Migration Plan

> **HISTORICAL CANDIDATE PLAN — DO NOT EXECUTE AS CURRENT OPERATIONS**
> Production backup/migration/cutover completed with seven migrations. This
> plan remains checkpoint evidence only.

**Status:** P9.1 candidate procedure `EXISTING_VERIFIED`; target integration
migration `READY_TO_IMPLEMENT`; off-VPS destination `BLOCKED` for final sign-off.

Phase 1 runs no migration or backup mutation. The candidate's two applied
P9.1 migrations are not evidence that the target integration schema is applied
to production.

## Backup policy

| Artifact | Frequency/retention | Protection |
|---|---|---|
| Scheduled `pg_dump` | seven daily backups | encrypted, checksum, outside active DB volume |
| PostgreSQL + config recovery bundle | four weekly backups | encrypted, access-restricted |
| Off-VPS recovery copy | required before final production sign-off | destination remains OPEN; separate key boundary |
| Model/cache provenance | manifest/hash, not mandatory full copy | reproducible source and revision |
| Pre-deploy snapshot | before every DB-affecting rollout | commit/image/schema/config record |

The current single-VPS `/opt/joy/backups` layout remains the target operational
shape. Checksums and encryption are mandatory. No backup is complete until an
isolated restore has been exercised and verified. An off-VPS destination is
required before final production sign-off, but its provider/location remains
OPEN.

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
