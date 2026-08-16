# Spotify Combined Candidate Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct the Spotify candidate runbook and tests so the persistent Compose environment and verified WhatsApp resolver survive Spotify candidate preparation.

**Architecture:** Keep `p9.1-compose.yml` as the base. Use the WhatsApp resolver and Spotify secret overrides together only for combined Backend render/recreation; use the base alone for PostgreSQL and Prisma migration. Add a read-only canonical-env guard and static regression tests over the runbook/overrides.

**Tech Stack:** Docker Compose, Bash, Vitest, Markdown, existing P9 candidate entrypoint.

---

### Task 1: Add failing combined-runtime regression tests

**Files:**
- Modify: `backend/tests/p9/spotify-candidate-secret-wiring.unit.test.ts`

- [ ] **Step 1: Assert the canonical env seed contract**

  Require `/opt/bmo/config/p9.1/compose.env`, the exact source `/tmp/bmo-p9-1-validation-20260804/compose.env`, `install -m 0600`, and no content-printing command.

- [ ] **Step 2: Assert the Compose command matrix**

  Require both overrides in sanitized render and Backend recreation, require the base-only file list in PostgreSQL/migration commands, and require the exact callback/loopback values.

- [ ] **Step 3: Assert WhatsApp wiring survives combined composition**

  Read `ops/whatsapp/p9.1-identity-resolver.override.yml` and require its URL, token-file variable, and secret name to remain unchanged.

- [ ] **Step 4: Run the focused test and confirm red**

  Run `npm exec vitest run tests/p9/spotify-candidate-secret-wiring.unit.test.ts`; expected failure is the missing canonical env/combined runbook contract.

### Task 2: Add canonical candidate-env verification

**Files:**
- Create: `ops/spotify/verify-candidate-env.sh`

- [ ] **Step 1: Implement read-only path/mode checks**

  Require `P9_COMPOSE_ENV_FILE` to equal `/opt/bmo/config/p9.1/compose.env`, require a non-empty regular non-symlink file, reject permissions broader than `0600`, and print only sanitized status.

### Task 3: Correct the operator runbook

**Files:**
- Modify: `docs/integration/10-OPERATOR-PROMPT-RUNBOOK.md`

- [ ] **Step 1: Document the non-executed env seed**

  Use `install` from the existing temporary source, preserve `bmo-admin:bmo-admin` ownership and `0700`/`0600` modes, and explicitly state the command is not executed by this task.

- [ ] **Step 2: Document the exact file matrix**

  Use base + both overrides for render/recreation, base only for PostgreSQL/migration, and retain the exact callback and SSH tunnel.

- [ ] **Step 3: Add the canonical-env guard command**

  Run `verify-candidate-env.sh` before Compose render, without reading or printing env contents.

### Task 4: Verify, commit, and push

- [ ] **Step 1: Run focused/full Backend/P9 tests, typecheck, Dockerized build, Prisma validate, docs verification, and shell checks.**
- [ ] **Step 2: Confirm no runtime action occurred; run `git diff --check`.**
- [ ] **Step 3: Commit and push.**
