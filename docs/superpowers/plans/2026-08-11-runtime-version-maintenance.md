# Joy Runtime Version Maintenance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task with verification checkpoints.

**Goal:** Audit and safely update only the live VPS runtime components whose stable versions are newer, preserving healthy Joy production and recording evidence for every component.

**Architecture:** Work in the requested order: Codex CLI, Hermes Agent, Docker Engine, then the private PostgreSQL 16 candidate. Each component gets an official-source check, compatibility decision, one bounded update, immediate version/health/regression verification, and documentation synchronization before the next component. Historical evidence remains unchanged.

**Tech Stack:** Ubuntu 24.04, systemd, Docker Engine/Compose, Hermes systemd service, PostgreSQL 16 Alpine container, Joy Backend/Audio containers, Caddy, Beszel, Codex CLI, Git.

---

### Task 1: Establish live baseline and official targets

**Files:**
- Read: `docs/operations/MAINTENANCE-AND-RECOVERY.md`
- Read: `docker-compose.yml`
- Read: `p9.1-compose.yml`
- Read: `.env.*.example` without printing secret values

- [ ] Record live versions, service/container identities, image digests, health states, branch, commit, and clean/dirty status.
- [ ] Verify current stable releases using official project sources only: Codex release/update documentation, Hermes upstream release notes, Docker Engine release notes, and PostgreSQL official release notes/images.
- [ ] Record a compatibility decision and rollback anchor for each target before changing anything.

### Task 2: Codex CLI

**Files:**
- Modify: documentation runtime inventory only if the observed version changes

- [ ] Identify the installed binary and its official update mechanism.
- [ ] Update only when the official stable target is newer and the mechanism is non-destructive.
- [ ] Run `codex --version` and record the result; do not restart Joy services.

### Task 3: Hermes Agent

**Files:**
- Read: `/etc/systemd/system/hermes-gateway.service`
- Modify: documentation runtime inventory only if the upgrade succeeds

- [ ] Capture service unit, executable/venv path, owner, health endpoint, and version without printing credentials.
- [ ] Read official release notes from the observed version to the target and identify configuration/API breaking changes.
- [ ] Update using the existing installation method only if compatibility is safe.
- [ ] Verify version, `/health`, backend-to-Hermes connectivity, and one fake-device voice regression before proceeding.

### Task 4: Docker Engine

**Files:**
- Read: `docker-compose.yml`
- Read: `p9.1-compose.yml`
- Modify: documentation runtime inventory only if the upgrade succeeds

- [ ] Verify official Docker Engine target and Compose compatibility with the current daemon and Compose files.
- [ ] Use the existing package/repository installation method, without pruning, broad deletion, firewall changes, or unnecessary container recreation.
- [ ] Verify `docker version`, `docker compose version`, `docker ps`, Backend, Audio, Hermes, Caddy, and Beszel health.
- [ ] Run the available server/fake-device regression before proceeding.

### Task 5: PostgreSQL 16 candidate

**Files:**
- Read: `p9.1-compose.yml`
- Read: `backend/prisma/schema.prisma`
- Read: `backend/prisma/migrations/migration_lock.toml`
- Modify: `p9.1-compose.yml` only if the verified PostgreSQL 16 image is compatible and the update is non-destructive
- Modify: runtime documentation only for current/live claims

- [ ] Identify only the P9.1 candidate container, private network, data bind, DB name/user, migrations, and existing backup/restore path.
- [ ] Verify a PostgreSQL 16.x Alpine target from official PostgreSQL sources and confirm no major-version change.
- [ ] Validate the existing data and backup/restore path before replacement; do not touch unrelated databases or volumes.
- [ ] Update the candidate with a bounded restart/recreate only if safe; never delete the data bind or run destructive migrations.
- [ ] Verify container health, `SELECT version()`, migration state, DB connectivity, Prisma connectivity, and P9 auth/API tests.

### Task 6: Final regression and documentation

**Files:**
- Modify: `docs/backend-mvp/CURRENT-RUNTIME-CONFIG.md` if its runtime inventory is in scope
- Modify: `docs/backend-mvp/IMPLEMENTATION-STATUS.md` for current runtime claims if needed
- Modify: `docs/NEXT-ACTION.md` for current runtime claims if needed
- Modify: `docs/operations/MAINTENANCE-AND-RECOVERY.md` with observed/verified timestamps

- [ ] Run the complete Joy health and fake-device regression: health, WSS/auth, pairing path, voice STT, Hermes, Piper, `audio_ready`, MP3 serving, Backend, Audio, Caddy, and Beszel.
- [ ] Scan tracked files for stale current-version claims while preserving historical evidence.
- [ ] Review `git diff` and ensure only runtime maintenance documentation/config changes are present.
- [ ] Commit and push only after fresh verification; report exact before/after versions, skipped/blocked components, tests, changed files, branch, commit SHA, status, and next action.
