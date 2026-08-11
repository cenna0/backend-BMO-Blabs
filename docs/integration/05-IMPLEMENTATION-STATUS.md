# Phase 2 Implementation Status

**Audited:** 2026-08-11
**Last implementation checkpoint:** 2026-08-11 — Slice 2A additive application data foundation and disposable migration gate
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
| Prisma Studio public listener | `EXISTING_VERIFIED` | Remediated on the Phase 2 implementation host: the manual user process was terminated and no TCP listener remains on port 5555. Docker publishes no port 5555 and active Caddy config contains no 5555 route. UFW/nft inspection remains unavailable without passworded sudo. |

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
| Phase 2 application data foundation | `EXISTING_VERIFIED` | Source schema plus disposable PostgreSQL evidence: 27 additive models (38 total), explicit ownership/idempotency/secret-shape constraints, provider-subtype connection integrity, required bounded device-log expiry, repository delegates, and migration `20260811190000_phase2_application_foundation`. Empty three-migration deploy, repeat deploy with no pending migration, and populated two-to-three migration upgrade all passed. The migration has not been applied to the running private `bmo` candidate or public production. |
| Production P9.1 activation | `READY_TO_IMPLEMENT` | Existing router is disabled on production |
| Production-shaped P9.1 integration | `EXISTING_VERIFIED` | Source + automated review-runtime packaging: the full Backend runtime registers P9 and existing voice surfaces together. Review Compose keeps Backend on host networking for loopback Hermes/Audio, removes PostgreSQL host publication, and connects Backend to PostgreSQL through a shared Unix-socket volume. The running private candidate has not been recreated and public production remains unchanged. |

Session issuance now accepts an optional `clientDeviceId` only after querying an
active `Device` owned by the authenticated user. Pre-pairing sessions remain
valid with a null binding; refresh rotation retains the binding on the same
session. Default issuance opens a transaction and takes the same per-user
advisory lock as unpair before validation and token/session writes; registration
reuses its existing transaction without nesting. Client-supplied user ownership
is never used.

The device `/ws` now performs an asynchronous application binding after the
unchanged runtime credential succeeds. It resolves only an active matching
hardware ID and SHA-256 token verifier. Cached owner identity is never exposed
directly: the only server accessor asynchronously revalidates the exact device,
user, hardware ID, and `ACTIVE` status, and clears a revoked or stale binding.
A missing/mismatched row emits the safe `DEVICE_NOT_BOUND` diagnostic while
legacy voice remains connected; callback rejection is contained.

The optional `Session.clientDeviceId` issuance path is source/unit verified with
transaction/lock ordering and active-owner validation. Integrated readiness now
requires PostgreSQL health and every migration in the source manifest to be
present and finished whenever P9 is enabled; a static test keeps that manifest
identical to the migration directories. A failed, incomplete, or stalled
database probe is bounded by the readiness timeout and sanitized as
`database: error` with HTTP 503, while `/livez` remains dependency-free and the
P9-disabled response shape is unchanged. The disposable database gate passed;
running private-candidate and public-production acceptance remain pending, and
no public availability is claimed.

One-hop Express/Supertest coverage verifies that Caddy's rightmost forwarded
client address owns the auth rate-limit bucket: attacker-controlled earlier
`X-Forwarded-For` entries do not reset it, while distinct rightmost clients use
distinct buckets. Candidate packaging tests verify PostgreSQL has no published
host port and that the socket-aware entrypoint retains hostname/port fallback.
The candidate image healthcheck intentionally probes dependency-free `/livez`
only; candidate acceptance must separately query `/readyz`, so container health
is liveness evidence and never substitutes for integrated readiness.

## Approved integration scope

| Capability | Status | Exact gap / gate |
|---|---|---|
| Self-service registration | `READY_TO_IMPLEMENT` | Remove invitation dependency without weakening existing credential handling |
| DOB password recovery | `READY_TO_IMPLEMENT` | Nullable DOB and verifier-only bounded recovery storage are source-verified; service abuse controls and routes remain absent |
| Profile, username, avatar | `READY_TO_IMPLEMENT` | Nullable normalized username and opaque avatar metadata are source-verified; application validation/media/routes remain absent |
| Personalization | `READY_TO_IMPLEMENT` | One-to-one source model is verified; service/routes remain absent |
| Mobile realtime `/api/v1/ws` | `READY_TO_IMPLEMENT` | Separate contract absent |
| Chat/history and Hermes-backed send | `READY_TO_IMPLEMENT` | Durable source models/cursors/idempotency/202-operation state are verified; services/routes/Hermes orchestration remain absent |
| Memory | `READY_TO_IMPLEMENT` | Durable record/candidate/action/topic-forget/summary source models are verified; gateway/routes/lifecycle runtime remain absent |
| Schedules | `READY_TO_IMPLEMENT` | Durable schedule/run/delivery source models are verified; worker/routes/runtime remain absent |
| Wi-Fi DB/API/queue | `READY_TO_IMPLEMENT` | Versioned encrypted desired-state source model is verified; encryption service/API/queue remain absent |
| Wi-Fi ESP apply/status | `PENDING_PHYSICAL_ESP` | Additive ESP events and physical proof absent; first-boot bootstrap remains a hardware decision |
| Device logs API/storage | `READY_TO_IMPLEMENT` | Bounded expiring log source model is verified; ingestion/API remain absent |
| Telemetry/RSSI API/storage | `READY_TO_IMPLEMENT` | Current telemetry source model and battery/RSSI checks are verified; ingestion/API remain absent |
| Telemetry/settings ESP events | `PENDING_PHYSICAL_ESP` | Firmware handlers/physical proof absent; battery value is nullable |
| Generic proactive queue/API | `READY_TO_IMPLEMENT` | User/device-owned delivery and attempt source models are verified; queue/API runtime remains absent |
| Generic proactive playback | `PENDING_PHYSICAL_ESP` | Firmware event handling and physical playback proof absent |
| WhatsApp adapter/catalog | `READY_TO_IMPLEMENT` | Connection/rule/send/delivery source records exist without provider session bytes; adapter/routes remain absent |
| WhatsApp live provider | `BLOCKED` | Hermes capability exists, but an actual BMO session/API boundary and credentials were not verified |
| Spotify adapter/catalog | `READY_TO_IMPLEMENT` | OAuth state, encrypted credential, and action source records exist; adapter/routes remain absent |
| Spotify live OAuth | `BLOCKED` | Provider application credentials and callback registration not verified |
| Bug reports | `READY_TO_IMPLEMENT` | Report/attachment source models exist; storage service and route remain absent |
| Voice preview | `DEFERRED` | Last-priority optional surface |

## Tests captured at freeze

- Backend on Node `22.23.1`: 42 files passed, 1 skipped; 200 tests passed, 1 skipped. The skipped suite requires `P9_INTEGRATION=true` and disposable candidate credentials/database inputs. Slice 2A focused schema/repository coverage passed 18 tests.
- Backend typecheck and build: passed on Node `22.23.1`.
- Prisma validation and generated-client typecheck/build: passed. The source manifest requires three migrations. On disposable PostgreSQL, an empty three-migration deploy passed, repeat deploy reported no pending migrations, and a populated two-to-three migration upgrade preserved seeded rows in all 11 P9.1 models. The first post-deploy introspection diff proposed only 14 foreign-key renames; explicit Prisma relation maps now match the deployed constraint names without changing migration SQL or database constraints, and the repeated database-to-schema diff returned `No difference detected`. Transaction-rolled-back positive/negative probes also verified avatar, Wi-Fi AEAD, battery, device-log expiry, provider-subtype, Spotify refresh-secret, and WhatsApp rule constraints. The disposable databases and review images were removed after verification. Candidate `/ops/db/livez`, `/readyz`, and `/migrations` were not re-probed or changed in Slice 2A; the running `bmo` database still has only the two P9.1 migrations.
- Static/rendered integrated-candidate packaging: passed; PostgreSQL has no host-published port and Backend uses the named Unix-socket volume. The live candidate was not recreated.
- Audio Service: 103 tests passed in the production audio image.
- Documentation verifier: passed before synchronization and must pass again on the final tree.
- A host-Node test attempt failed with `ERR_IPC_CHANNEL_CLOSED`; this is an environment mismatch, not a test regression.

## Current blockers

1. `BLOCKED`: live WhatsApp session/API/provider credentials are not proven.
2. `BLOCKED`: Spotify application credentials/callback registration are not proven.
3. `PENDING_PHYSICAL_ESP`: first-boot Wi-Fi bootstrap, battery sensing capability, additive events, and physical playback require firmware/bench evidence.
4. Current UFW/nft rules remain unreadable without passworded elevated privileges. Listener, Docker, and Caddy evidence prove no service currently accepts port 5555; firewall-policy inspection remains an operator evidence gap for final public/private sign-off.

## Phase 2 next source slice

Use `04-VPS-IMPLEMENTATION-PLAN.md`. Build account/profile/recovery and personalization services/routes against the reviewed additive source schema, preserving `SafeUser` DOB exclusion and existing P9.1 behavior. The disposable migration gate is complete; execute against the running candidate or production only under separate authorization.
