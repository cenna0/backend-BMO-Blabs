# Spotify Candidate Secret Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a candidate-only Spotify Compose secret overlay and regression coverage without creating secrets or recreating the candidate.

**Architecture:** The operator supplies only protected host-file paths through environment variables. Compose maps those files to read-only `/run/secrets/*` mounts, clears any plaintext Spotify variables inherited from the base env file, and fixes the callback to the locked loopback URI. The existing root entrypoint loads the files while privileged, then drops to the application UID.

**Tech Stack:** Docker Compose secrets, Bash operator guard, Node/Vitest, existing P9 entrypoint secret loader, Markdown runbook.

---

### Task 1: Specify the candidate wiring and loading contract

**Files:**
- Create: `backend/tests/p9/spotify-candidate-secret-wiring.unit.test.ts`
- Modify: `backend/tests/p9/entrypoint-secrets.unit.test.ts`

- [ ] **Step 1: Write failing overlay and permission-contract tests**

  Assert that `ops/spotify/p9.1-secrets.override.yml` contains the three file variables, the exact `/run/secrets/spotify_*` targets, read-only secret mode `0400`, the fixed callback URL, and empty plaintext Spotify environment values. Assert that `ops/spotify/verify-secret-files.sh` checks mode bits no broader than `0600` and exact callback equality without printing secret contents.

- [ ] **Step 2: Extend the protected-loader test**

  Add temporary client-ID and client-secret files and require the spawned child to observe `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET` after the entrypoint loads them.

- [ ] **Step 3: Run the focused tests and confirm the overlay test fails**

  Run `npm exec vitest run tests/p9/spotify-candidate-secret-wiring.unit.test.ts tests/p9/entrypoint-secrets.unit.test.ts` from `backend/`. Expected: the loader test passes and the new overlay test fails because the canonical `ops/spotify` files do not exist yet.

### Task 2: Add the candidate-only protected secret overlay

**Files:**
- Create: `ops/spotify/p9.1-secrets.override.yml`
- Delete: `p9.1-phase26-provider.compose.yml`

- [ ] **Step 1: Add the canonical overlay**

  Use Compose top-level `secrets` with host paths from `SPOTIFY_CLIENT_ID_FILE`, `SPOTIFY_CLIENT_SECRET_FILE`, and `SPOTIFY_TOKEN_ENCRYPTION_KEY_FILE`. Mount each at `/run/secrets/spotify_client_id`, `/run/secrets/spotify_client_secret`, and `/run/secrets/spotify_token_encryption_key` with mode `0400`. Set the corresponding `_FILE` variables, clear plaintext Spotify variables, and set `SPOTIFY_CALLBACK_URL` to `http://127.0.0.1:4310/api/v1/integrations/spotify/callback`.

### Task 3: Add the permission guard and operator commands

**Files:**
- Create: `ops/spotify/verify-secret-files.sh`
- Modify: `docs/integration/10-OPERATOR-PROMPT-RUNBOOK.md`

- [ ] **Step 1: Implement the guard**

  Require the three host path variables and the exact callback, reject missing, symlinked, non-regular, unreadable, empty, or mode-broader-than-`0600` files, and emit only sanitized PASS/error labels.

- [ ] **Step 2: Document safe candidate order**

  Document protected path exports, the guard, `docker compose config`, candidate-only migration order, immutable-image Backend recreation command, and the SSH tunnel. State that these commands remain blocked until explicit operator authorization and never include secret contents.

### Task 4: Verify, commit, and push

- [ ] **Step 1: Run focused tests, full Backend/P9, typecheck, build, Prisma validate, and docs verification**
- [ ] **Step 2: Run `git diff --check`, inspect status, and confirm no candidate/production runtime action occurred**
- [ ] **Step 3: Commit and push**
