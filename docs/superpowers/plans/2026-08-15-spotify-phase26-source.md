# Spotify Phase 2.6 Source Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the server-authoritative Spotify Phase 2.6 integration, validate it with mocked provider and regression tests, prepare a loopback-only candidate configuration, and stop before real Spotify credentials or OAuth.

**Architecture:** Extend the existing `SpotifyApiClient` and `IntegrationService` rather than introducing a second provider stack. Spotify credentials remain encrypted inside the Backend, OAuth state is persisted as a hashed single-use record, semantic actions are validated against an allowlist, and device selection is resolved by the Backend. The Prisma change is additive and candidate-only; WhatsApp code, production Compose/Caddy, and production databases remain untouched.

**Tech Stack:** Node 22, TypeScript, Express, Vitest, Prisma 7/PostgreSQL, AES-256-GCM, Docker Compose candidate overlay.

---

### Task 1: Lock the Spotify contract and schema expectations in tests

**Files:**
- Modify: `backend/tests/p9/spotify-client.unit.test.ts`
- Modify: `backend/tests/p9/spotify.integration.service.unit.test.ts`
- Modify: `backend/tests/p9/integrations.boundary.unit.test.ts`
- Modify: `backend/tests/p9/integrations.http.test.ts`
- Modify: `backend/tests/p9/schema.test.ts`
- Modify: `backend/tests/p9/config.test.ts`

- [ ] **Step 1: Add failing adapter tests** for `currentUser`, market-aware search, `invalid_grant`, 403/Premium mapping, 429/5xx mapping, strict Spotify URI validation, and the exact four requested scopes.

  The tests must assert that provider response bodies are never copied into errors and that `invalid_grant` has a distinct internal provider code.

- [ ] **Step 2: Run the focused adapter test file and confirm the new assertions fail for missing behavior.**

  Run:

  ```bash
  cd backend && npm test -- tests/p9/spotify-client.unit.test.ts
  ```

  Expected: failures for the new current-user, scope, provider-error, and URI assertions; existing baseline tests may continue to pass.

- [ ] **Step 3: Add failing service tests** for authorization timestamp/Spotify identity persistence, no state returned outside the authorization URL, expired six-month refresh lifecycle, `invalid_grant` credential deletion plus `RECONNECT_REQUIRED`, replacement-token preservation, concurrent refresh single-flight, explicit/preferred/active/no-device precedence, preferred-device persistence, Premium/no-device typed results, and user ownership isolation.

- [ ] **Step 4: Run the focused service test file and confirm those assertions fail for the current implementation.**

  Run:

  ```bash
  cd backend && npm test -- tests/p9/spotify.integration.service.unit.test.ts
  ```

- [ ] **Step 5: Add failing boundary/HTTP/schema/config assertions** for the dedicated encryption key, `RECONNECT_REQUIRED` public status/event, preferred-device route, removal of `QUEUE`, bounded query/device arguments, callback auth independence, and the additive SpotifyCredential columns/migration.

- [ ] **Step 6: Run the boundary, HTTP, schema, and config tests to confirm red state.**

  ```bash
  cd backend && npm test -- tests/p9/integrations.boundary.unit.test.ts tests/p9/integrations.http.test.ts tests/p9/schema.test.ts tests/p9/config.test.ts
  ```

### Task 2: Harden the Spotify provider adapter

**Files:**
- Modify: `backend/src/p9/providers/spotify.client.ts`
- Test: `backend/tests/p9/spotify-client.unit.test.ts`

- [ ] **Step 1: Implement the minimum provider error taxonomy.**

  Preserve sanitized errors only and add internal codes for `INVALID_GRANT` and `PREMIUM_REQUIRED`. Map token-endpoint `invalid_grant` to `INVALID_GRANT`, 401 API responses to authorization revocation, 403 playback failures to Premium-required, 429 to rate-limited, and 5xx/timeouts to provider-unavailable. Never include the provider body, token, client ID, or secret in an error message.

- [ ] **Step 2: Implement OAuth/current-user and market-aware adapter methods.**

  Keep Authorization Code exchange and refresh token calls server-side. Add a normalized `/me` method returning only Spotify user ID, country/market, and product. Add an optional `market` query to `/search`, bounded to a two-letter account market. Keep normalized result shapes only.

- [ ] **Step 3: Restrict semantic playback mapping.**

  Keep only `PLAY`, `PLAY_TRACK`, `PLAY_ARTIST`, `PLAY_ALBUM`, `PLAY_PLAYLIST`, `PAUSE`, `RESUME`, `NEXT`, `PREVIOUS`, `TRANSFER`, `SEEK`, `VOLUME`, `SHUFFLE`, and `REPEAT`. Validate Spotify URIs against the expected resource type before constructing request bodies. Never accept a provider URL, HTTP method, or endpoint from a caller.

- [ ] **Step 4: Run the adapter tests and confirm green.**

  ```bash
  cd backend && npm test -- tests/p9/spotify-client.unit.test.ts
  ```

### Task 3: Add Spotify lifecycle fields and dedicated secret configuration

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/20260815120000_spotify_phase26_lifecycle/migration.sql`
- Modify: `backend/src/p9/config.ts`
- Modify: `backend/src/p9/candidate-server.ts`
- Modify: `backend/src/server.ts`
- Modify: `backend/src/p9/index.ts`
- Modify: `.env.backend.example`
- Modify: `p9.1-phase26-provider.compose.yml`
- Modify: `backend/tests/p9/schema.test.ts`
- Modify: `backend/tests/p9/config.test.ts`

- [ ] **Step 1: Add the schema test expectations before editing Prisma.**

  Require `SpotifyCredential.spotifyUserId`, `authorizedAt`, `market`, and `preferredDeviceId`; require `IntegrationStatus.RECONNECT_REQUIRED`; require additive, non-destructive SQL with nullable preferred-device/market values and a non-null authorization timestamp for existing rows using their current creation time.

- [ ] **Step 2: Add the migration and schema changes.**

  Add the four credential columns, an index only where useful for owner lookups, and the enum value. Do not alter existing WhatsApp tables, constraints, or migration SQL. The migration must use `ALTER TYPE ... ADD VALUE IF NOT EXISTS` and nullable/backfilled additions that preserve existing Spotify rows.

- [ ] **Step 3: Add the dedicated `SPOTIFY_TOKEN_ENCRYPTION_KEY` config path.**

  Load `SPOTIFY_TOKEN_ENCRYPTION_KEY_FILE` in candidate and normal server startup, expose it as `spotifyTokenEncryptionKey`, require a 32-byte base64url-decoded key only when Spotify credentials are used, and do not reuse `P9_PROVIDER_ENCRYPTION_KEY` for new Spotify writes. Keep no secret values in examples or Compose; examples contain only protected file paths.

- [ ] **Step 4: Update the candidate overlay to use the dedicated key and configurable loopback callback.**

  The overlay must read `SPOTIFY_TOKEN_ENCRYPTION_KEY_FILE`, `SPOTIFY_CLIENT_ID_FILE`, `SPOTIFY_CLIENT_SECRET_FILE`, and `SPOTIFY_CALLBACK_URL` from operator-provided environment/file paths. It must not hardcode a public callback and must not add any Caddy route.

- [ ] **Step 5: Run Prisma schema/config tests and validation.**

  ```bash
  cd backend && npm test -- tests/p9/schema.test.ts tests/p9/config.test.ts
  npm run prisma:validate
  ```

### Task 4: Implement OAuth persistence, token encryption, and refresh lifecycle

**Files:**
- Modify: `backend/src/p9/services/integration.service.ts`
- Modify: `backend/src/p9/integrations.crypto.ts`
- Modify: `backend/src/p9/db/repositories.ts` only if a transaction-safe Spotify helper is required
- Modify: `backend/tests/p9/spotify.integration.service.unit.test.ts`
- Modify: `backend/tests/p9/integrations.boundary.unit.test.ts`

- [ ] **Step 1: Make OAuth connect return only the authorization URL.**

  Generate 32 random bytes, store only a SHA-256 verifier in `OAuthState`, bind it to the authenticated user and exact configured redirect, expire it after ten minutes, and remove the separate state field from the Mobile response. The state remains inside the provider authorization URL.

- [ ] **Step 2: Persist callback ownership and account metadata atomically.**

  Validate state format, expiry, redirect, and single-use claim before exchanging the code. Fetch normalized `/me`, encrypt access/refresh tokens with AES-256-GCM using the dedicated key, preserve any existing refresh token if the provider omits a replacement, and atomically upsert SpotifyCredential plus the connected IntegrationConnection with `spotifyUserId`, `authorizedAt`, `market`, and scopes. Do not log code or provider response.

- [ ] **Step 3: Implement refresh single-flight and re-read behavior.**

  For each user, use a keyed in-process refresh promise and a database transaction/advisory lock where available. Re-read the credential after acquiring the lock; if another caller already refreshed it, reuse the still-valid ciphertext. Refresh only within the skew window, write new access ciphertext atomically, replace the refresh ciphertext only when a new refresh token exists, and retain the old token otherwise.

- [ ] **Step 4: Implement six-month authorization lifecycle.**

  Treat `authorizedAt + six calendar months` as the refresh-token deadline. Before refresh, if the deadline has passed, delete the SpotifyCredential and set the connection to `RECONNECT_REQUIRED`. On provider `INVALID_GRANT`, delete credential state, clear provider metadata, set `RECONNECT_REQUIRED`, and return only the stable BMO-safe error. Never retry a failed refresh indefinitely.

- [ ] **Step 5: Run the service and crypto tests through the red/green cycle.**

  ```bash
  cd backend && npm test -- tests/p9/spotify.integration.service.unit.test.ts tests/p9/integrations.boundary.unit.test.ts
  ```

### Task 5: Implement device resolution, playback behavior, and strict action boundary

**Files:**
- Modify: `backend/src/p9/services/integration.service.ts`
- Modify: `backend/src/p9/integrations.validation.ts`
- Modify: `backend/src/p9/http/integration.route.ts`
- Modify: `backend/src/p9/errors.ts`
- Modify: `backend/src/p9/websocket/mobile-events.ts`
- Modify: `backend/tests/p9/spotify.integration.service.unit.test.ts`
- Modify: `backend/tests/p9/integrations.boundary.unit.test.ts`
- Modify: `backend/tests/p9/integrations.http.test.ts`
- Modify: `backend/tests/p9/mobile-events.unit.test.ts`

- [ ] **Step 1: Add explicit stable BMO error codes.**

  Add `RECONNECT_REQUIRED`, `NO_ACTIVE_DEVICE`, `PREMIUM_REQUIRED`, and a Spotify provider-rate-limit code where needed. Map 401/invalid-grant, 403, 429, 5xx/timeouts, and no-device outcomes without returning raw provider text.

- [ ] **Step 2: Implement deterministic device resolution.**

  Validate explicit device IDs/names against the user’s safe device list, then use a valid stored preferred device, then the provider’s active device. If none exists, return `NO_ACTIVE_DEVICE`. Do not claim a playback action succeeded when no device is usable. Persist preferred selection only through the canonical preferred-device operation and clear an unavailable preference safely.

- [ ] **Step 3: Add the additive preferred-device route.**

  Implement `PUT /integrations/spotify/preferred-device` with `{ deviceId: string | null }`, authenticated ownership, safe device validation, and a response containing only the selected safe device projection. Keep existing connect/status/disconnect/devices/active-device/playback/actions/callback routes unchanged in meaning.

- [ ] **Step 4: Tighten action validation and execution.**

  Remove `QUEUE` from the public allowlist, bound query/text/device arguments, validate target type and URI shape, and route both Mobile actions and future Hermes semantic actions through the same parsed allowlist. A semantic action may contain command, query, URI, device selector, seek position, volume, shuffle state, repeat state, and transfer play flag only; it may not contain URL, HTTP method, endpoint, headers, token, secret, SQL, or raw provider JSON.

- [ ] **Step 5: Run focused HTTP, boundary, event, and service tests.**

  ```bash
  cd backend && npm test -- tests/p9/spotify.integration.service.unit.test.ts tests/p9/integrations.boundary.unit.test.ts tests/p9/integrations.http.test.ts tests/p9/mobile-events.unit.test.ts
  ```

### Task 6: Synchronize canonical Mobile/Hermes/operator documentation

**Files:**
- Modify: `docs/integration/01-MOBILE-BACKEND-API-CONTRACT.md`
- Modify: `docs/integration/05-IMPLEMENTATION-STATUS.md`
- Modify: `docs/integration/06-DECISION-REGISTER.md`
- Modify: `docs/integration/09-ENDPOINT-EVENT-COVERAGE-MATRIX.md`
- Modify: `docs/integration/10-OPERATOR-PROMPT-RUNBOOK.md`
- Modify: `docs/p9/18-action-intent-schema.md`
- Modify: `docs/p9/16-spotify-integration.md`

- [ ] **Step 1: Document one canonical Mobile contract.**

  Include exact request/response shapes for connect/auth URL, status including `RECONNECT_REQUIRED`, disconnect, search, devices, active device, playback, preferred-device, and allowlisted actions. State that device IDs are the only provider identifiers returned when needed and tokens/secrets/raw provider bodies never cross the API.

- [ ] **Step 2: Document exact scopes and behavior.**

  Record only `user-read-private`, `user-read-playback-state`, `user-modify-playback-state`, and `playlist-read-private`, with the reason for each. Record Premium requirement, no-device behavior, market-aware search, six-month reauthorization, and deterministic resolution.

- [ ] **Step 3: Document the Hermes boundary.**

  Hermes may request only the semantic Spotify action envelope. Backend supplies the authenticated user, validates the envelope, resolves devices/search, owns provider execution, and emits safe results. Hermes never receives credentials or provider request material and never calls Spotify directly.

- [ ] **Step 4: Document candidate-only OAuth operations.**

  Use an exact loopback redirect such as `http://127.0.0.1:<operator-port>/api/v1/integrations/spotify/callback`, an SSH local tunnel to VPS `127.0.0.1:3010`, Spotify Development Mode allowlisting, protected file delivery, candidate-only migration/recreation, and explicit prohibitions on Caddy/production/WhatsApp restarts. Mark Spotify `SOURCE_READY` or `CANDIDATE_RUNTIME_READY` only; never `CANDIDATE_VERIFIED`.

### Task 7: Verify, build, commit, and push without live provider access

**Files:**
- Modify: no additional source files unless verification exposes a test-backed defect

- [ ] **Step 1: Run focused Spotify tests and capture counts.**

  ```bash
  cd backend && npm test -- tests/p9/spotify-client.unit.test.ts tests/p9/spotify.integration.service.unit.test.ts tests/p9/integrations.boundary.unit.test.ts tests/p9/integrations.http.test.ts
  ```

- [ ] **Step 2: Run the full Backend and P9 suites.**

  ```bash
  cd backend && npm test
  npm run test:p9
  ```

- [ ] **Step 3: Run static and schema verification.**

  ```bash
  cd backend && npm run typecheck && npm run build && npm run prisma:generate && npm run prisma:validate
  cd .. && python3 scripts/verify-backend-mvp-docs.py
  ```

- [ ] **Step 4: Run the repository packaging/P9 regression checks and dependency audit if available in the current gate.**

  ```bash
  pytest -q tests/verification tests/packaging
  cd backend && npm audit --omit=dev
  ```

  Report any pre-existing or environment-specific failure exactly; do not weaken tests or mutate production state to make a check pass.

- [ ] **Step 5: Build a new immutable candidate image only.**

  ```bash
  git rev-parse HEAD
  docker build --file backend/Dockerfile.p9.1 --build-arg VCS_REF="$(git rev-parse HEAD)" --tag "bmo-p9.1-candidate:spotify-phase26-$(git rev-parse --short HEAD)" backend
  ```

  Do not start/recreate containers, run migrations against production, invoke OAuth, expose ports, modify Caddy, restart Hermes/WhatsApp services, or use real Spotify credentials.

- [ ] **Step 6: Commit source/docs/migration changes and push the implementation branch.**

  ```bash
  git status --short
  git diff --check
  git add backend docs/integration docs/p9 .env.backend.example p9.1-phase26-provider.compose.yml
  git commit -m "feat(spotify): complete phase26 source integration"
  git push origin feat/vps-mobile-device-integration
  git rev-parse HEAD
  git rev-parse origin/feat/vps-mobile-device-integration
  git status --short --branch
  ```

  The final report must distinguish source readiness from candidate runtime readiness and external-provider/operator blocking. It must state `production changed=no` and must not claim live Spotify verification.

