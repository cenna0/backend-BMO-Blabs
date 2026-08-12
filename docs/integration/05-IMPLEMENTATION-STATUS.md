# Phase 2 Implementation Status

**Audited:** 2026-08-11
**Last implementation checkpoint:** 2026-08-12 — Slice 5A durable chat/history/idempotency and internal Hermes orchestration source candidate
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
| Account auth register/login/refresh/logout/logout-all/me | `EXISTING_VERIFIED` | Slice 2B source/tests provide self-service DOB registration and canonical `SafeUser`; the running private candidate remains on the invitation-era image and public production remains unchanged |
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

Slice 2B source removes the mobile invitation requirement while retaining
optional legacy invitation consumption and operator tooling. Registration
strictly normalizes email, requires a valid non-future calendar DOB, preserves
Argon2id/session issuance, and returns `username`/`avatarUrl` without DOB. The
DOB future boundary uses the fixed `Asia/Jakarta` calendar day. Login discovers
the account, enters one transaction, takes either the real per-user advisory
lock or a namespaced stable SHA-256-derived dummy lock for a miss, performs an
authoritative post-lock lookup, then performs exactly one Argon2 verification.
If registration appears between discovery and that lookup, login takes the new
real-user lock and refetches the current credential before verification and
session issuance. This keeps known-invalid and unknown work shapes comparable
while preventing an old-password verification from issuing after a completed
reset.
Profile updates bind only to bearer ownership, normalize username to the
database-enforced lowercase form, sanitize uniqueness conflicts, and prevent
mass assignment.

DOB recovery uses identical public failure envelopes for unknown email and
wrong DOB, independent one-hop-proxy-aware IP and normalized-email limiters, a
fixed 600-second token lifetime, SHA-256 verifier-only storage, atomic single
use, Argon2id credential replacement, and transaction-scoped revocation of all
sessions and refresh families. DOB is explicitly a weak MVP recovery factor;
raw DOB and recovery tokens are absent from `SafeUser`, persistence fields, and
audit metadata. Successful verify issuance takes the per-user advisory lock,
uses a post-lock database clock, invalidates every earlier live recovery epoch,
and creates exactly one replacement epoch. Reset takes that same lock before
its post-lock database clock, refetch, atomic claim, sibling-epoch
invalidation, password replacement, and revocation. Lock-aware concurrent
tests prove two verify requests serialize and only the newer token survives.
Refresh likewise discovers its owner, locks, and refetches the token/session
before validation and rotation, retaining replay-family revocation semantics.
Recovery limiter responses receive the same idempotent request context and
`X-Request-Id` as handler responses.

Avatar upload applies independent authenticated-user and proxy-aware IP rate
limits, then globally admits at most two active and four waiting multipart
bodies before Multer can buffer the bounded 5 MiB JPEG/PNG/WebP input. Admission
also enforces one active/two waiting leases per owner and proxy-normalized IP,
dispatches eligible waiters without allowing a new request to bypass them, and
expires queued or pre-parse requests after a bounded 30-second receive deadline
with a sanitized 408. A lease released on an early parser/transport failure
transfers to operation ownership after successful parsing and remains held until
the avatar handler settles, even if the client disconnects. Sharp processing
independently admits two active and four waiting jobs, rejects images beyond 8 million decoded pixels,
4096 pixels per dimension, a 4:1 aspect ratio, or one page, and re-encodes to a
stripped WebP. Storage generates a UUID key and serves only the exact opaque
`.webp` path with `nosniff` and immutable caching. It requires an absolute,
non-symlink, runtime-UID-owned directory with owner-only mode; writes use a
private temporary file followed by atomic rename and failure cleanup.
Upload/database commits are coordinated with aged, bounded, paginated,
DB-rechecked orphan reconciliation so exact unreferenced UUID WebP files are
removed while referenced and in-flight files are preserved; failure to delete
a superseded file after commit does not turn the successful request into HTTP
500. The public base URL is restricted to a normalized HTTP(S) origin, URL
projection uses the URL API, and corrupt stored avatar keys project as null.
Candidate and production-shaped Compose source provide a dedicated writable
persistent mount within the otherwise read-only Backend container; no host
directory was created. Personalization GET safe-upserts defaults and PATCH
accepts only the seven bounded canonical owner-scoped fields; both return the
bare seven-field object. Persistence is verified; Hermes context consumption
is deliberately deferred to a later slice.

## Approved integration scope

| Capability | Status | Exact gap / gate |
|---|---|---|
| Self-service registration | `EXISTING_VERIFIED` | Source + automated route/service tests; optional legacy invitation compatibility retained; running candidate/public production unchanged |
| DOB password recovery | `EXISTING_VERIFIED` | Source + automated enumeration/rate/TTL/hash/epoch/reuse/revocation and lock-aware concurrent issuance tests plus deterministic reset/revocation races; weak MVP factor and not deployed |
| Profile, username, avatar | `EXISTING_VERIFIED` | Source + automated independent-rate/fair pre-Multer admission/30-second receive deadline/disconnect-lifetime/image-bound/media/storage/DB-authoritative reconciliation tests; persistent mounts declared but not created/deployed |
| Personalization | `EXISTING_VERIFIED` | Source + exact bare seven-field response/defaults/strict patch/owner tests; the chat slice now consumes all seven bounded fields in server-built Hermes context |
| Mobile realtime `/api/v1/ws` | `EXISTING_VERIFIED` | Source + automated transport/auth/session/path/payload/expiry/heartbeat/fanout tests; enabled only with the P9 runtime and not deployed to candidate/public production |
| Chat/history and Hermes-backed send | `EXISTING_VERIFIED` | Source/test tier: six owner-scoped REST routes, deterministic cursor history, transactional user-scoped idempotency, durable 202 operations, globally bounded local scheduling plus DB-enforced lower-cursor session ordering across runtimes, atomic DB-clock leases renewed immediately before Hermes, post-listen bounded recovery whose SQL selects claimable session heads before `LIMIT`, counts durable claims, stops on zero-progress pages, advances unrelated session heads beyond 64+ blocked upper rows, and coalesces overlapping startup/maintenance calls, delete preflight/active abort and cancellation-guarded persistence, server-built personalization + explicit empty-memory + recent-history context, isolated per-user/session internal Hermes conversation, sanitized assistant/error persistence, and per-user `chat_thinking`/`chat_message` fanout. Not migrated/deployed to the running candidate or public production |
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

- Backend on Node `22.23.2`: 57 files passed, 1 skipped; 322 tests passed, 1 skipped. The skipped suite requires `P9_INTEGRATION=true` and disposable candidate credentials/database inputs and was not run. Chat coverage includes ownership, strict request bodies, durable 202 acceptance, same-key/concurrent deduplication, conflict detection, cursor bounds/order, soft deletion, feedback, bounded fair scheduling, distributed lower-cursor session ordering, DB-clock lease renewal after slow context, cross-worker takeover exclusion, active delete abort/no persistence, post-listen startup recovery, SQL claimable-head discovery beyond 64+ blocked upper rows, multi-page durable-claim accounting, zero-progress termination, unrelated-session progress, single-flight recovery, periodic transient-error retry, bounded context, per-user/session Hermes isolation, hard timeout, safe provider failure/audit, and realtime fanout.
- Backend typecheck and build: passed on Node `22.23.2`.
- Prisma validation and generated-client typecheck/build: passed. The source manifest requires three migrations. On disposable PostgreSQL, an empty three-migration deploy passed, repeat deploy reported no pending migrations, and a populated two-to-three migration upgrade preserved seeded rows in all 11 P9.1 models. The first post-deploy introspection diff proposed only 14 foreign-key renames; explicit Prisma relation maps now match the deployed constraint names without changing migration SQL or database constraints, and the repeated database-to-schema diff returned `No difference detected`. Transaction-rolled-back positive/negative probes also verified avatar, Wi-Fi AEAD, battery, device-log expiry, provider-subtype, Spotify refresh-secret, and WhatsApp rule constraints. The disposable databases and review images were removed after verification. Candidate `/ops/db/livez`, `/readyz`, and `/migrations` were not re-probed or changed in Slice 2A; the running `bmo` database still has only the two P9.1 migrations.
- Static/rendered packaging: 13 tests passed, 1 unrelated packaging test skipped. PostgreSQL has no host-published port, Backend uses the named Unix-socket volume, and avatar storage uses a separate writable named volume without adding public routing. Fresh production Backend and P9 review-candidate image builds passed; ephemeral command-only probes verified application UID/GID `1000:1000` and avatar-directory ownership/mode `1000:1000`/`0700`. No service container was started and the live candidate was not recreated.
- Audio Service: 103 tests passed in the production audio image.
- Documentation verifier: 4 regression tests passed and the direct verifier returned `PASS` on the synchronized tree.
- Production dependency audit: 0 vulnerabilities at `high` or above (and 0 total after the pinned `nanoid` override); Multer `2.2.0` and Sharp `0.35.3` are exact lockfile dependencies.
- A host-Node test attempt failed with `ERR_IPC_CHANNEL_CLOSED`; this is an environment mismatch, not a test regression.

## Current blockers

1. `BLOCKED`: live WhatsApp session/API/provider credentials are not proven.
2. `BLOCKED`: Spotify application credentials/callback registration are not proven.
3. `PENDING_PHYSICAL_ESP`: first-boot Wi-Fi bootstrap, battery sensing capability, additive events, and physical playback require firmware/bench evidence.
4. Current UFW/nft rules remain unreadable without passworded elevated privileges. Listener, Docker, and Caddy evidence prove no service currently accepts port 5555; firewall-policy inspection remains an operator evidence gap for final public/private sign-off.

## Phase 2 next source slice

Use `04-VPS-IMPLEMENTATION-PLAN.md`. The next source boundary is memory lifecycle,
followed by schedules and generic proactive delivery. Slice 2A remains unapplied to the
running candidate and production; candidate recreation, migration execution,
public activation, provider configuration, and physical ESP work all require
separate authorization/evidence.
