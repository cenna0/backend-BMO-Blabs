# Phase 1 Frozen Implementation Status

**Audited:** 2026-08-11
**Baseline source:** `main` / `d638b20c381c676136c94524a38a1def5d70e565`
**Documentation branch:** `docs/integration-contract-freeze`
**Authority:** Actual registered source routes, Prisma migrations, and inspected runtime override stale prose.

## Status vocabulary

| Status | Meaning |
|---|---|
| `EXISTING_VERIFIED` | Present and verified in the explicitly named source/runtime tier. It does not imply public availability. |
| `READY_TO_IMPLEMENT` | Approved frozen contract; implementation/acceptance is absent or incomplete. |
| `PENDING_PHYSICAL_ESP` | Backend contract may be ready, but real ESP implementation and physical evidence are absent. |
| `BLOCKED` | A named external, security, authority, or dependency gate prevents acceptance. |
| `DEFERRED` | Deliberately outside the next implementation slice. |

## Git and source baseline

| Item | Frozen fact |
|---|---|
| Production source branch/SHA at audit start | `main` / `d638b20c381c676136c94524a38a1def5d70e565` |
| Production remote | `origin/main` at the same SHA |
| P9.1 source | Present in that SHA; do not search for an older feature branch |
| Worktree before freeze | Clean except the supplied untracked `docs/integration/` pack |
| Documentation branch | `docs/integration-contract-freeze` |
| Application/runtime changes in Phase 1 | None |

## Runtime baseline

| Area | Status | Audited fact |
|---|---|---|
| Production voice Backend API | `EXISTING_VERIFIED` | Healthy immutable container; loopback `127.0.0.1:3000`; public `/health` and device WSS/voice/audio paths |
| P9.1 Backend API | `EXISTING_VERIFIED` | Private candidate container only; not routed by public Caddy |
| PostgreSQL | `EXISTING_VERIFIED` | PostgreSQL 16.14, private candidate network, 11 application tables plus migration table; two P9.1 migrations finished |
| Hermes | `EXISTING_VERIFIED` | Host systemd service, loopback `127.0.0.1:8642`, gateway `0.20.0`; `/v1/responses` is the Backend boundary |
| Audio Service | `EXISTING_VERIFIED` | Healthy container on loopback `127.0.0.1:8001`; readiness degraded only because optional RVC is disabled |
| Caddy | `EXISTING_VERIFIED` | `api.personalbmo.web.id` -> `127.0.0.1:3000`; public `/livez` and `/readyz` deliberately return 404 |
| Observability | `EXISTING_VERIFIED` | Beszel hub/agent and Telegram relay healthy |
| Physical ESP additive integration | `PENDING_PHYSICAL_ESP` | No Phase 1 physical evidence |
| Prisma Studio on `*:5555` | `BLOCKED` | Manually running, not a declared service; stop it and verify exposure before Phase 2/deploy |

Host: Ubuntu 24.04, kernel `6.8.0-124`, 4 vCPU, 7.8 GiB RAM, no swap. Docker `29.6.2`, Compose `5.3.1`, Caddy `2.11.4`, Git `2.43.0`. Host Node `18.19.1` is unsupported by the project; verified project/runtime Node is `22.23.1`. Audio runtime uses Python `3.10.20`.

### Deployment and networking detail

| Runtime | Binding/network | Image/service fact |
|---|---|---|
| Production Backend | `127.0.0.1:3000` | `bmo-production-backend-1`, read-only, healthy, restart `unless-stopped`; digest starts `e981751498` |
| Production Audio | `127.0.0.1:8001` | `bmo-production-audio-1`, read-only, healthy; digest starts `62ad9a` |
| Hermes | `127.0.0.1:8642` | host `hermes-gateway.service`, user `hermes`, version `0.20.0` |
| P9.1 Backend | internal candidate network, container port `3010` | `bmo-p9-1-backend-1`, read-only, healthy, Node `22.23.1`, no public Caddy route |
| PostgreSQL | internal candidate network, no published port | `bmo-p9-1-postgres-1`, PostgreSQL `16.14`, persistent bind, healthy |
| Caddy | public `80/443` -> production Backend | active admin config routes `api.personalbmo.web.id` to loopback; `/livez` and `/readyz` are denied publicly |
| Monitoring | declared Beszel/relay services | hub, agent, and Telegram relay healthy |

The active Caddy behavior matches `/opt/bmo/deploy/p7-caddy-cutover.Caddyfile`; `/opt/bmo/config/caddy/Caddyfile` is a rollback/pending 503 file, not the live routing truth. The live `/etc/caddy/Caddyfile` could not be read under the audit user, so the loopback Caddy admin API supplied the sanitized active-route evidence. Secrets/config were inspected by ownership and variable name only; no value is documented.

Audio readiness is `degraded` only because optional RVC is disabled: FastAPI `0.139.2`, Uvicorn `0.51`, faster-whisper `1.2.1`, Kokoro `0.9.4`, Piper TTS `1.6`, and CPU Torch `2.13` are present. Piper is primary and Kokoro fallback.

### Candidate database snapshot

At audit time the candidate database was approximately 9.3 MB with two active connections and aggregate counts of 50 users, 12 devices, 31 pairing records, and 74 sessions. These counts are diagnostic evidence only, may drift after the freeze, and do not imply public/production data ownership.

## Existing source and availability

| Capability | Status | Availability / limitation |
|---|---|---|
| Device WSS `/ws`, raw whole WAV HTTP, MP3 HTTP | `EXISTING_VERIFIED` | Production/public contract |
| P9.1 register/login/refresh/logout/logout-all/me | `EXISTING_VERIFIED` | Source + private candidate; registration still invitation-gated |
| Six-digit pairing | `EXISTING_VERIFIED` | Source + DB-backed candidate; mobile bearer routes, 10-minute TTL, five attempts; physical pairing not proven |
| Device CRUD/settings | `EXISTING_VERIFIED` | Source + private candidate; settings are DB-only and do not sync to ESP |
| P9.1 Prisma foundation | `EXISTING_VERIFIED` | 11 models; two additive migrations; not the target integration schema |
| Production P9.1 activation | `READY_TO_IMPLEMENT` | Existing router is disabled on production |

Current session gap: `Session.clientDeviceId` exists in Prisma, but the token-issuance path does not populate it. Therefore logout-all/family replay controls exist, while a claim of working per-mobile-device revocation is not yet justified.

## Approved integration scope

| Capability | Status | Exact gap / gate |
|---|---|---|
| Self-service registration | `READY_TO_IMPLEMENT` | Remove invitation dependency without weakening existing credential handling |
| DOB password recovery | `READY_TO_IMPLEMENT` | Schema, abuse controls, audit, and routes absent |
| Profile, username, avatar | `READY_TO_IMPLEMENT` | Target schema/routes absent |
| Personalization | `READY_TO_IMPLEMENT` | Existing `UserSettings` is narrower |
| Mobile realtime `/api/v1/ws` | `READY_TO_IMPLEMENT` | Separate contract absent |
| Chat/history and Hermes-backed send | `READY_TO_IMPLEMENT` | Durable chat models/routes absent |
| Memory | `READY_TO_IMPLEMENT` | Models/routes/lifecycle absent |
| Schedules | `READY_TO_IMPLEMENT` | Models, worker, routes, and delivery state absent |
| Wi-Fi DB/API/queue | `READY_TO_IMPLEMENT` | Backend data plane absent |
| Wi-Fi ESP apply/status | `PENDING_PHYSICAL_ESP` | Additive ESP events and physical proof absent; first-boot bootstrap remains a hardware decision |
| Device logs API/storage | `READY_TO_IMPLEMENT` | Backend ingestion/storage absent |
| Telemetry/RSSI API/storage | `READY_TO_IMPLEMENT` | Backend ingestion/current state absent |
| Telemetry/settings ESP events | `PENDING_PHYSICAL_ESP` | Firmware handlers/physical proof absent; battery value is nullable |
| Generic proactive queue/API | `READY_TO_IMPLEMENT` | Backend queue/delivery model absent |
| Generic proactive playback | `PENDING_PHYSICAL_ESP` | Firmware event handling and physical playback proof absent |
| WhatsApp adapter/catalog | `READY_TO_IMPLEMENT` | BMO API/data contract absent |
| WhatsApp live provider | `BLOCKED` | Hermes capability exists, but an actual BMO session/API boundary and credentials were not verified |
| Spotify adapter/catalog | `READY_TO_IMPLEMENT` | BMO API/data contract absent |
| Spotify live OAuth | `BLOCKED` | Provider application credentials and callback registration not verified |
| Bug reports | `READY_TO_IMPLEMENT` | Models/routes absent |
| Voice preview | `DEFERRED` | Last-priority optional surface |

## Tests captured at freeze

- Backend on Node `22.23.1`: 36 files passed, 1 skipped; 155 tests passed, 1 skipped. The skipped suite requires `POSTGRES_TEST_URL`.
- Backend typecheck and build: passed on Node `22.23.1`.
- Prisma validation: passed. Candidate `/ops/db/livez`, `/readyz`, and `/migrations`: healthy/private.
- Audio Service: 103 tests passed in the production audio image.
- Documentation verifier: passed before synchronization and must pass again on the final tree.
- A host-Node test attempt failed with `ERR_IPC_CHANNEL_CLOSED`; this is an environment mismatch, not a test regression.

## Current blockers

1. `BLOCKED`: Prisma Studio listens on all interfaces at port 5555; close and verify firewall/listeners before Phase 2 work proceeds.
2. `BLOCKED`: live WhatsApp session/API/provider credentials are not proven.
3. `BLOCKED`: Spotify application credentials/callback registration are not proven.
4. `PENDING_PHYSICAL_ESP`: first-boot Wi-Fi bootstrap, battery sensing capability, additive events, and physical playback require firmware/bench evidence.
5. Current UFW rules were not readable without elevated privileges; public exposure must be re-verified when closing the port-5555 gate.

## Phase 2 starting point

Use `04-VPS-IMPLEMENTATION-PLAN.md`. First close the Prisma Studio exposure, confirm drift-free source/runtime, then integrate the existing P9.1 router into the production Backend API candidate path while preserving device voice. Do not start with a production migration or physical-ESP claim.
