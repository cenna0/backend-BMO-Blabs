# Operator Runbook After Documentation Freeze

**Use after:** the Phase 1 branch/commit is reviewed and Phase 2 is explicitly authorized.

## 1. Start a clean implementation session

Provide the Phase 1 final commit SHA and ask the agent to use `07-ONE-SHOT-AGENT-PROMPT.md`. The first response must confirm:

- the checked-out source includes the freeze commit;
- production source/runtime has not drifted;
- no secrets were printed;
- Prisma Studio `*:5555` is closed or the session is stopped for missing runtime authority;
- no production migration/deployment will occur without its explicit gate.

## 2. Manual gates

Only the operator may supply or authorize:

- production maintenance/deployment window;
- privileged firewall/runtime changes when not already authorized;
- production backup and migration execution;
- Spotify application credentials/callback registration;
- WhatsApp session/provider credentials;
- physical ESP firmware/bench access.

Send secrets out-of-band. Never paste them into chat, Git, logs, or documentation.

## 3. Spotify Phase 2.6 candidate checkpoint

The source/candidate implementation may be built and the candidate migration
may be applied only to the isolated candidate project. Live OAuth is blocked
until the operator completes these steps one at a time:

1. Create/configure a Spotify Developer Dashboard application in Development
   Mode with the exact scopes recorded in `docs/p9/16-spotify-integration.md`.
2. Register exactly:
   `http://127.0.0.1:4310/api/v1/integrations/spotify/callback`.
   Do not register a guessed path, public VPS URL, or production redirect.
3. Add the intended Spotify account to the Development Mode user allowlist if
   the Dashboard requires it. Playback acceptance requires Spotify Premium.
4. Use these protected host paths outside Git:

   ```text
   /opt/bmo/config/p9.1/spotify-client-id
   /opt/bmo/config/p9.1/spotify-client-secret
   /opt/bmo/config/p9.1/spotify-token-encryption-key
   ```

   After a separate authorization to provision secrets, create the directory
   and empty mode-0600 files without putting values in shell arguments or
   history:

   ```bash
   umask 077
   install -d -m 0700 /opt/bmo/config/p9.1
   install -m 0600 /dev/null /opt/bmo/config/p9.1/spotify-client-id
   install -m 0600 /dev/null /opt/bmo/config/p9.1/spotify-client-secret
   install -m 0600 /dev/null /opt/bmo/config/p9.1/spotify-token-encryption-key
   ```

   Populate the files only through the protected operator secret-delivery
   mechanism. Never paste their contents into chat, Git, Compose, an env file,
   or a command line.
5. Export paths, not secret values, and verify the exact callback and file
   permissions:

   ```bash
   export SPOTIFY_CLIENT_ID_FILE=/opt/bmo/config/p9.1/spotify-client-id
   export SPOTIFY_CLIENT_SECRET_FILE=/opt/bmo/config/p9.1/spotify-client-secret
   export SPOTIFY_TOKEN_ENCRYPTION_KEY_FILE=/opt/bmo/config/p9.1/spotify-token-encryption-key
   export SPOTIFY_CALLBACK_URL=http://127.0.0.1:4310/api/v1/integrations/spotify/callback
   /opt/bmo/app/ops/spotify/verify-secret-files.sh
   ```

6. Before any candidate change, render the candidate-only Compose files and
   inspect only sanitized configuration:

   ```bash
   export P9_COMPOSE_ENV_FILE=/opt/bmo/config/p9.1/compose.env
   export P9_CANDIDATE_IMAGE=bmo-p9.1-candidate:spotify-phase26-<final-sha>
   docker compose --project-name bmo-p9-1 \
     --env-file "$P9_COMPOSE_ENV_FILE" \
     -f /opt/bmo/app/p9.1-compose.yml \
     -f /opt/bmo/app/ops/spotify/p9.1-secrets.override.yml \
     config
   ```

7. After a separate explicit authorization, start only the isolated candidate
   PostgreSQL service, apply the candidate migration, then recreate only its
   Backend from the immutable image:

   ```bash
   docker compose --project-name bmo-p9-1 \
     --env-file "$P9_COMPOSE_ENV_FILE" \
     -f /opt/bmo/app/p9.1-compose.yml \
     -f /opt/bmo/app/ops/spotify/p9.1-secrets.override.yml \
     up -d postgres
   docker compose --project-name bmo-p9-1 \
     --env-file "$P9_COMPOSE_ENV_FILE" \
     -f /opt/bmo/app/p9.1-compose.yml \
     -f /opt/bmo/app/ops/spotify/p9.1-secrets.override.yml \
     run --rm --no-deps backend npm run prisma:migrate:deploy
   docker compose --project-name bmo-p9-1 \
     --env-file "$P9_COMPOSE_ENV_FILE" \
     -f /opt/bmo/app/p9.1-compose.yml \
     -f /opt/bmo/app/ops/spotify/p9.1-secrets.override.yml \
     up -d --no-build --force-recreate backend
   ```

8. Start the operator-side tunnel from laptop port `4310` to the candidate
   Backend loopback port `3010`:

   ```bash
   ssh -N -T -o ExitOnForwardFailure=yes \
     -L 4310:127.0.0.1:3010 <operator>@<vps-host>
   ```

   Do not expose PostgreSQL, Hermes, Audio Service, Spotify secrets, or the
   Backend listener publicly. Perform live OAuth and playback acceptance only
   after recording the candidate image SHA, migration state, exact redirect,
   allowlist state, and protected-file permission result. Return sanitized
   results only.

Never send or record the client secret, encryption key, OAuth code, access
token, refresh token, provider error body, or secret file contents.

## 4. Resume prompt after a proven gate

```text
Gate yang dicatat sudah diselesaikan. Verifikasi bukti tanpa menampilkan secret, lanjutkan dari slice/checkpoint yang sama di docs/integration/04-VPS-IMPLEMENTATION-PLAN.md, dan jangan ulangi langkah yang sudah PASS. Update status serta coverage matrix bersama perubahan implementasinya. Jangan deploy atau menjalankan migration production kecuali gate tersebut memang yang baru saya otorisasi.
```

## 5. Independent completion audit

Use a fresh session after the implementation branch is pushed:

```text
Audit implementasi terhadap commit freeze Phase 1 dan seluruh docs/integration/00-10. Enumerasi route terdaftar, schema/migration, device /ws, mobile /api/v1/ws, source-of-truth, Caddy/public-private exposure, tests, dan Git diff. Verifikasi raw-WAV/MP3/device WSS tidak regress. Jangan promosikan PENDING_PHYSICAL_ESP tanpa real-device evidence. Fix drift yang aman dalam scope, update status/matrix, lalu commit/push. Laporkan blocker eksternal secara exact.
```

## 6. Stop rules

Stop and return evidence when authority is missing for a destructive/runtime action, a production migration/deploy, provider secrets, or physical firmware. A backend implementation may continue around an external provider or physical blocker only if its tests are isolated and its status remains honest.

Phase 1 itself ends at the documentation commit. It must not flow automatically into this runbook.
