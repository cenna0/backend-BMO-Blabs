# Production P9 Runtime Definition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create and statically validate a production-only P9 Compose/runtime definition for the frozen Backend image without changing runtime state.

**Architecture:** Keep `docker-compose.yml` as the existing voice Backend/Audio definition after removing its stale avatar bind. Add `ops/deploy/p9.1-production-compose.yml` containing only host-networked Backend and private PostgreSQL, with production bind paths and read-only secret sources. Add sanitized Compose/application templates, an operator runbook, and static packaging tests.

**Tech Stack:** Docker Compose v5.3.1, PostgreSQL 16.14 Alpine pinned by digest, Node/TypeScript Prisma operator scripts already in `backend/src/p9/operator`, Python `unittest`, YAML/Compose rendering.

---

### Task 1: Add failing static packaging tests

**Files:**
- Create: `tests/packaging/test_p9_production_packaging.py`

- [ ] **Step 1: Write the failing tests**

Add tests that render `ops/deploy/p9.1-production-compose.yml` with fixture
paths and a production-tag fixture image, then assert:

```python
def test_backend_is_production_loopback_only(self):
    backend = self.config["services"]["backend"]
    self.assertEqual(backend["network_mode"], "host")
    self.assertEqual(backend["environment"]["BACKEND_HOST"], "127.0.0.1")
    self.assertEqual(backend["environment"]["BACKEND_PORT"], "3000")
    self.assertNotIn("ports", backend)

def test_postgres_is_private_and_persistent(self):
    postgres = self.config["services"]["postgres"]
    self.assertNotIn("ports", postgres)
    self.assertEqual(postgres["networks"], {"p9_private": None})
    self.assertEqual(postgres["volumes"][0]["source"], str(self.data_dir))

def test_only_backend_and_postgres_are_defined(self):
    self.assertEqual(set(self.config["services"]), {"backend", "postgres"})

def test_production_secrets_are_read_only_file_mounts(self):
    backend = self.config["services"]["backend"]
    secret_names = {secret["source"] for secret in backend["secrets"]}
    self.assertEqual(secret_names, {
        "postgres_password", "wifi_encryption_key",
        "whatsapp_identity_resolver_token", "spotify_client_id",
        "spotify_client_secret", "spotify_token_encryption_key",
    })
    self.assertTrue(all(secret["mode"] == 256 for secret in backend["secrets"]))

def test_candidate_paths_and_project_names_are_absent(self):
    rendered = json.dumps(self.config)
    self.assertNotIn("/tmp/joy-p9-1-validation-20260804", rendered)
    self.assertNotIn("joy-p9-1", rendered)
    self.assertNotIn("127.0.0.1:3010", rendered)

def test_rollback_targets_backend_without_dependencies(self):
    runbook = RUNBOOK.read_text(encoding="utf-8")
    self.assertIn("up -d --no-deps backend", runbook)
```

The fixture must create only empty placeholder files and directories under a
temporary directory. It must pass all required Compose interpolation values
without placing secret contents in the repository.

- [ ] **Step 2: Run the focused test and verify the expected failure**

Run:

```bash
python3 -m unittest tests.packaging.test_p9_production_packaging -v
```

Expected: fail because the production Compose file and runbook do not yet
exist.

### Task 2: Implement the production-only Compose definition

**Files:**
- Create: `ops/deploy/p9.1-production-compose.yml`
- Modify: `docker-compose.yml`

- [ ] **Step 1: Remove only the stale voice-runtime avatar bind**

Delete the current voice `backend` environment line
`AVATAR_STORAGE_DIR: /opt/joy/data/avatars` and its corresponding bind mount.
Keep `/opt/joy/temp/audio`, the existing Backend host networking, port 3000,
and the Audio service unchanged.

- [ ] **Step 2: Add the production P9 Compose file**

Define Compose project `joy-production-p9` with exactly these services:

```yaml
name: joy-production-p9

services:
  postgres:
    image: postgres:16.14-alpine3.22@sha256:786dab398303b8ce7cb76b407bb21ef2e4dfbbbd4c6abcf3d29b3130467ffdbc
    environment:
      POSTGRES_DB: ${P9_POSTGRES_DB:-joy}
      POSTGRES_USER: ${P9_POSTGRES_USER:-joy}
      POSTGRES_PASSWORD_FILE: /run/secrets/postgres_password
    secrets:
      - source: postgres_password
        target: postgres_password
        mode: 0400
    volumes:
      - type: bind
        source: ${P9_POSTGRES_DATA_DIR:-/opt/joy/data/postgres}
        target: /var/lib/postgresql/data
        bind:
          create_host_path: false
      - type: volume
        source: p9_production_postgres_socket
        target: /var/run/postgresql
    networks: [p9_private]
    restart: unless-stopped
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U \"$${POSTGRES_USER}\" -d \"$${POSTGRES_DB}\""]
      interval: 5s
      timeout: 3s
      retries: 12

  backend:
    image: ${P9_PRODUCTION_IMAGE:?Set P9_PRODUCTION_IMAGE to the verified production image tag}
    env_file:
      - path: ${P9_PRODUCTION_BACKEND_ENV_FILE:-/opt/joy/config/p9.1/backend.env}
        required: true
    environment:
      NODE_ENV: production
      BACKEND_HOST: 127.0.0.1
      BACKEND_PORT: "3000"
      TRUST_PROXY_HOPS: "1"
      PUBLIC_BASE_URL: https://api.personaljoy.web.id
      HERMES_API_URL: http://127.0.0.1:8642
      AUDIO_SERVICE_URL: http://127.0.0.1:8001
      WHATSAPP_BRIDGE_URL: http://127.0.0.1:3001
      WHATSAPP_IDENTITY_RESOLVER_URL: http://127.0.0.1:3002
      SPOTIFY_CALLBACK_URL: https://api.personaljoy.web.id/api/v1/integrations/spotify/callback
      HARDWARE_TEST_MODE: "false"
      P9_ENABLED: "true"
      P9_DATABASE_PASSWORD_FILE: /run/secrets/postgres_password
      P9_POSTGRES_USER: ${P9_POSTGRES_USER:-joy}
      P9_POSTGRES_DB: ${P9_POSTGRES_DB:-joy}
      P9_POSTGRES_SOCKET_DIR: /var/run/postgresql
      P9_WIFI_ENCRYPTION_KEY_FILE: /run/secrets/wifi_encryption_key
      WHATSAPP_IDENTITY_RESOLVER_TOKEN_FILE: /run/secrets/whatsapp_identity_resolver_token
      SPOTIFY_CLIENT_ID_FILE: /run/secrets/spotify_client_id
      SPOTIFY_CLIENT_SECRET_FILE: /run/secrets/spotify_client_secret
      SPOTIFY_TOKEN_ENCRYPTION_KEY_FILE: /run/secrets/spotify_token_encryption_key
      AVATAR_STORAGE_DIR: /opt/joy/data/avatars
      BUG_REPORT_STORAGE_DIR: /opt/joy/data/bug-reports
    depends_on:
      postgres:
        condition: service_healthy
    network_mode: host
    secrets:
      - source: postgres_password
        target: postgres_password
        mode: 0400
      - source: wifi_encryption_key
        target: wifi_encryption_key
        mode: 0400
      - source: whatsapp_identity_resolver_token
        target: whatsapp_identity_resolver_token
        mode: 0400
      - source: spotify_client_id
        target: spotify_client_id
        mode: 0400
      - source: spotify_client_secret
        target: spotify_client_secret
        mode: 0400
      - source: spotify_token_encryption_key
        target: spotify_token_encryption_key
        mode: 0400
    volumes:
      - type: volume
        source: p9_production_postgres_socket
        target: /var/run/postgresql
        read_only: true
      - type: bind
        source: /opt/joy/temp/audio
        target: /opt/joy/temp/audio
        bind:
          create_host_path: false
      - type: bind
        source: ${P9_AVATAR_DATA_DIR:-/opt/joy/data/avatars}
        target: /opt/joy/data/avatars
        bind:
          create_host_path: false
      - type: bind
        source: ${P9_BUG_REPORT_DATA_DIR:-/opt/joy/data/bug-reports}
        target: /opt/joy/data/bug-reports
        bind:
          create_host_path: false
    restart: unless-stopped

networks:
  p9_private:
    internal: true

volumes:
  p9_production_postgres_socket:

secrets:
  postgres_password:
    file: ${P9_POSTGRES_PASSWORD_FILE:?Set P9_POSTGRES_PASSWORD_FILE outside Git}
  wifi_encryption_key:
    file: ${P9_WIFI_ENCRYPTION_KEY_FILE:?Set P9_WIFI_ENCRYPTION_KEY_FILE outside Git}
  whatsapp_identity_resolver_token:
    file: ${P9_WHATSAPP_IDENTITY_RESOLVER_TOKEN_FILE:?Set P9_WHATSAPP_IDENTITY_RESOLVER_TOKEN_FILE outside Git}
  spotify_client_id:
    file: ${SPOTIFY_CLIENT_ID_FILE:?Set SPOTIFY_CLIENT_ID_FILE outside Git}
  spotify_client_secret:
    file: ${SPOTIFY_CLIENT_SECRET_FILE:?Set SPOTIFY_CLIENT_SECRET_FILE outside Git}
  spotify_token_encryption_key:
    file: ${SPOTIFY_TOKEN_ENCRYPTION_KEY_FILE:?Set SPOTIFY_TOKEN_ENCRYPTION_KEY_FILE outside Git}
```

Keep resource limits and hardening aligned with the verified candidate where
they do not alter production topology: read-only root filesystem, 64 MiB
`/tmp` tmpfs, dropped capabilities, `no-new-privileges`, and the 512 MiB
Backend/768 MiB PostgreSQL limits. Do not add a build section or any external
service definitions.

- [ ] **Step 3: Run the focused test and verify it passes**

Run:

```bash
python3 -m unittest tests.packaging.test_p9_production_packaging -v
```

Expected: PASS.

### Task 3: Add sanitized production templates and operator runbook

**Files:**
- Create: `ops/deploy/p9.1-production.compose.env.example`
- Create: `ops/deploy/p9.1-production.backend.env.example`
- Create: `docs/operations/PRODUCTION-P9-RUNTIME-DEFINITION.md`

- [ ] **Step 1: Add the Compose-variable template**

Use these non-secret values and host paths:

```dotenv
P9_PRODUCTION_IMAGE=joy-p9.1:spotify-phase26-9819ef7
P9_PRODUCTION_BACKEND_ENV_FILE=/opt/joy/config/p9.1/backend.env
P9_POSTGRES_DB=joy
P9_POSTGRES_USER=joy
P9_POSTGRES_DATA_DIR=/opt/joy/data/postgres
P9_AVATAR_DATA_DIR=/opt/joy/data/avatars
P9_BUG_REPORT_DATA_DIR=/opt/joy/data/bug-reports
P9_POSTGRES_PASSWORD_FILE=/opt/joy/config/p9.1/postgres-password
P9_WIFI_ENCRYPTION_KEY_FILE=/opt/joy/config/p9.1/wifi-encryption-key
P9_WHATSAPP_IDENTITY_RESOLVER_TOKEN_FILE=/opt/joy/config/whatsapp/identity-resolver.token
SPOTIFY_CLIENT_ID_FILE=/opt/joy/config/p9.1/spotify-client-id
SPOTIFY_CLIENT_SECRET_FILE=/opt/joy/config/p9.1/spotify-client-secret
SPOTIFY_TOKEN_ENCRYPTION_KEY_FILE=/opt/joy/config/p9.1/spotify-token-encryption-key
P9_COMPOSE_FILE=/opt/joy/app/ops/deploy/p9.1-production-compose.yml
P9_COMPOSE_PROJECT=joy-production-p9
P9_COMPOSE_ENV_FILE=/opt/joy/config/p9.1/production.compose.env
P9_BACKUP_DIR=/opt/joy/backups/database
P9_BACKUP_PASSPHRASE_FILE=/opt/joy/config/p9.1/backup-passphrase
```

- [ ] **Step 2: Add the application env template**

Include the existing voice-required placeholders plus these production P9
values, with no real secret contents:

```dotenv
NODE_ENV=production
BACKEND_HOST=127.0.0.1
BACKEND_PORT=3000
TRUST_PROXY_HOPS=1
PUBLIC_BASE_URL=https://api.personaljoy.web.id
P9_ENABLED=true
P9_JWT_SECRET=<operator-provisioned-32-byte-or-longer-secret>
P9_PAIRING_PEPPER=<operator-provisioned-32-byte-or-longer-secret>
HERMES_API_URL=http://127.0.0.1:8642
AUDIO_SERVICE_URL=http://127.0.0.1:8001
WHATSAPP_BRIDGE_URL=http://127.0.0.1:3001
WHATSAPP_IDENTITY_RESOLVER_URL=http://127.0.0.1:3002
P9_WIFI_ENCRYPTION_KEY_FILE=/run/secrets/wifi_encryption_key
WHATSAPP_IDENTITY_RESOLVER_TOKEN_FILE=/run/secrets/whatsapp_identity_resolver_token
SPOTIFY_CLIENT_ID_FILE=/run/secrets/spotify_client_id
SPOTIFY_CLIENT_SECRET_FILE=/run/secrets/spotify_client_secret
SPOTIFY_TOKEN_ENCRYPTION_KEY_FILE=/run/secrets/spotify_token_encryption_key
SPOTIFY_CALLBACK_URL=https://api.personaljoy.web.id/api/v1/integrations/spotify/callback
AVATAR_STORAGE_DIR=/opt/joy/data/avatars
BUG_REPORT_STORAGE_DIR=/opt/joy/data/bug-reports
```

Document that the placeholder P9 JWT/pairing values and existing voice
credentials are supplied only through the protected live file, owned by the
operator, mode 0600, and never committed.

- [ ] **Step 3: Document provisioning, backup, restore, migration, rollback,
  image proof, and Caddy decisions**

The runbook must include the exact host paths, intended owner/mode, mount
destinations, RO/RW status, exact future commands, and `NOT EXECUTED` labels.
It must explicitly record `NO_CADDY_CHANGE_REQUIRED`, the six migration names,
the production callback, and the absence of Audio/Hermes/WhatsApp service
definitions.

### Task 4: Verify migration manifest and image identity without runtime mutation

**Files:**
- Modify: `tests/packaging/test_p9_production_packaging.py`

- [ ] **Step 1: Add migration and artifact assertions**

Assert the six expected directory names exactly equal
`P9_REQUIRED_MIGRATIONS` and assert the frozen image digest string appears in
the runbook while candidate image/project/path references do not appear in the
production Compose or production templates.

- [ ] **Step 2: Run read-only evidence checks**

Run:

```bash
find backend/prisma/migrations -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort
docker image inspect joy-p9.1-candidate:spotify-phase26-9819ef7 --format '{{.Id}} {{json .RepoDigests}} {{json .RepoTags}}'
```

Expected: exactly six migration directories and the frozen image ID/digest.
These commands do not rebuild or retag the image.

### Task 5: Run all static validation and repository checks

**Files:**
- Modify: `tests/packaging/test_p9_production_packaging.py` only if a failing
  assertion identifies a real definition defect.

- [ ] **Step 1: Render Compose with fixture files**

Run the focused packaging test, which invokes `docker compose config --format
json` with temporary empty fixture files. Do not point it at `/opt/joy/config`
or any candidate secret path.

- [ ] **Step 2: Validate Compose YAML without starting services**

Run:

```bash
docker compose --project-name joy-production-p9 \
  --env-file /opt/joy/app/ops/deploy/p9.1-production.compose.env.example \
  --file /opt/joy/app/ops/deploy/p9.1-production-compose.yml config -q
```

If the example’s placeholder file paths are absent, use the focused test’s
temporary fixture environment instead; never create the production paths or
secret files merely to make this command pass.

- [ ] **Step 3: Run deployment-related repository checks**

Run:

```bash
python3 -m unittest discover -s tests/packaging -p 'test_*.py' -v
cd backend
npm run prisma:validate
npm run typecheck
npm test -- --runInBand
```

The test commands must not invoke Compose `up`, `down`, `restart`, `exec`, or
Prisma migration deployment.

- [ ] **Step 4: Confirm the worktree and runtime boundary**

Run:

```bash
git status --short
git diff --check
docker compose ls --all
docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Ports}}\t{{.Status}}'
```

Report only intentional repository changes and confirm that no runtime state
was changed. Do not commit or push.
