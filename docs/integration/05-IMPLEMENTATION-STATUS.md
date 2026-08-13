# Phase 2 Implementation Status

**Audited:** 2026-08-11
**Last implementation checkpoint:** 2026-08-13 — Phase 2.6 candidate provider implementation
**Baseline source:** `main` / `d638b20c381c676136c94524a38a1def5d70e565`
**Documentation branch:** `docs/integration-contract-freeze`
**Authority:** Actual registered source routes, Prisma migrations, and inspected runtime override stale prose.

## Phase 2.6 candidate implementation checkpoint

This checkpoint records safe source/config-template/test work after the Phase
2.5 candidate baseline. No production migration, production deployment, active
Caddy mutation, or provider secret was performed.

| Gate | Status | Evidence |
|---|---|---|
| Spotify concrete provider client | `SOURCE_VERIFIED` | Bounded Authorization Code exchange, refresh-token exchange, normalized search/devices/playback, and explicit Web API action mapping. Focused provider/service/HTTP tests passed; full Node 22 suite: `412 passed, 1 skipped`; typecheck passed. |
| Spotify capability contract | `SOURCE_VERIFIED` | Search/resolution plus track/artist/album/playlist play, resume/pause/next/previous, queue, transfer/select device, active device, current playback, seek, volume, shuffle, and repeat are validated and mapped to Spotify Connect endpoints. |
| Spotify encrypted persistence/refresh | `SOURCE_VERIFIED` | Existing AES-256-GCM credential envelope is used; expiry-aware refresh preserves an omitted refresh token and retries one provider 401. Unit tests verify ciphertext-only persistence and owner isolation. |
| Spotify live candidate acceptance | `BLOCKED_EXTERNAL_SECRET` | Client ID/secret, provider encryption key, exact callback registration, and an authorized Spotify account/device are not provisioned. |
| Spotify callback exposure | `BLOCKED_OPERATOR` | Exact single-path diff is prepared at `ops/caddy/phase26-spotify-candidate-callback.patch` but has not been applied to active Caddy. Candidate remains loopback at `127.0.0.1:3010`. |
| Hermes WhatsApp runtime boundary | `SOURCE_VERIFIED` | Installed CLI/runtime inspection plus Hermes 0.20.0 upstream source verified the loopback `/health`, destructive `/messages`, and `/send` bridge boundary. Protected Hermes session/configuration was not read or changed; no live bridge/session exists yet. |
| WhatsApp dedicated transport runtime | `SOURCE_VERIFIED` | Repository launcher invokes the unchanged official bridge with port 3001, the verified Hermes session path, and bot mode as `User=hermes`; bounded crash restart is separate from `hermes-gateway.service`, stdout/stderr are discarded, and no unit install/start has occurred. |
| WhatsApp concrete adapter | `SOURCE_VERIFIED` | Candidate `HermesWhatsAppBridgeClient` implements bounded health, exact protected sender allowlist with fail-closed empty state, receive, send, loopback enforcement, JID validation, and sanitized errors; focused WhatsApp tests pass. Live session acceptance remains `BLOCKED_OPERATOR`. |
| WhatsApp ownership/inbound producer | `SOURCE_VERIFIED` | Candidate poller requires exactly one connected owner, drops every `isGroup=true` event before owner lookup/persistence/rules/proactive delivery, deduplicates provider message IDs, stores only routing metadata/body length, and invokes the owner boundary. Live event acceptance remains `BLOCKED_OPERATOR`. |
| Generic WhatsApp proactive speech | `PENDING_PHYSICAL_ESP` | A real inbound event can create the generic `WHATSAPP` proactive-delivery job when an enabled rule and active device match; physical synthesis/playback evidence is absent. |

## Historical Phase 2.5 candidate acceptance

The following section is retained as historical evidence and is superseded by
the Phase 2.6 checkpoint above.

**Acceptance date:** 2026-08-13
**Scope:** candidate/review runtime only. No production migration, Backend replacement,
or active Caddy change was performed.
**Requested source:** `feat/vps-mobile-device-integration` /
`437e48a70227220d1a40ad539ff09b307ef0c1ea`
**Candidate source:** `adeebca58719db4386f62330026f6c3b46a91bbe` (targeted protected-secret
startup fix on top of the requested source)
**Candidate image:** `bmo-phase25-candidate:adeebca58719db4386f62330026f6c3b46a91bbe`
(`sha256:eaa0a7a162e7cf926ddb6ac3022449671a69dae25dc94a1ab618aa3b274abecb`)

For this section, the explicit acceptance labels map to the maintenance protocol:
`SOURCE_VERIFIED` = `EXISTING_VERIFIED` in source, `CANDIDATE_VERIFIED` =
`EXISTING_VERIFIED` in the private candidate, `PRODUCTION_VERIFIED` =
`EXISTING_VERIFIED` in production, `BLOCKED_EXTERNAL_SECRET` and
`BLOCKED_OPERATOR` = named `BLOCKED` gates. These labels do not imply public
availability.

| Gate | Status | Evidence |
|---|---|---|
| Source and candidate identity | `CANDIDATE_VERIFIED` | Candidate Backend `bmo-p9-1-backend-1`, Node `22.23.1`, host bind `127.0.0.1:3010`, image digest above; candidate PostgreSQL `bmo-p9-1-postgres-1` on private `bmo-p9-1_p9_private` with no host port. Production Backend remained `bmo-production-backend-1` on `127.0.0.1:3000`. |
| Prisma Studio exposure | `CANDIDATE_VERIFIED` | No `*:5555` listener, Docker publication, or active Caddy route. UFW/nftables rule inspection requires passworded elevation and remains `BLOCKED_OPERATOR`; no workaround was used. |
| Build and generated client | `CANDIDATE_VERIFIED` | Targeted ownership repair enabled normal in-place candidate-path operation. Node `22.23.1` `npm run prisma:generate`, `npm run build`, `npm run typecheck`, and `npm run prisma:validate` passed. |
| Candidate backup/restore | `CANDIDATE_VERIFIED` | Encrypted backup `/tmp/bmo-p9-1-validation-20260804/backups/p9-daily-20260813T063419Z.dump.gpg`, mode `0600`, SHA-256 `ced83d0be911af85eb532cbf9c2bff8f67d219d6f31a1c7b53249da78a4d3525`; restored to disposable `phase25_restore_20260813`. PostgreSQL 16.14, 12 public tables, two baseline migrations, and User/Device/Session/DevicePairing counts `50/12/74/31` matched. |
| Candidate migration | `CANDIDATE_VERIFIED` | `20260811190000_phase2_application_foundation` applied once to the candidate DB; repeat deploy reported no pending migrations. Three finished migrations, 39 public tables, and the pre-existing P9.1 counts remained intact. No production DB was used. |
| Candidate health | `CANDIDATE_VERIFIED` | `/livez` 200; `/readyz` 200 with Backend, Hermes, Audio, and database `ok`; optional RVC remained unavailable as documented. No crash/restart loop. |
| Core REST and WebSocket acceptance | `CANDIDATE_VERIFIED` | Live candidate harness: `42 passed, 0 failed`, covering auth/session/DOB recovery/profile/personalization/pairing/devices/Wi-Fi/chat/history/idempotency/memory/schedules/plugins/provider boundaries, mobile `/api/v1/ws`, physical `/ws`, ownership, validation, and additive telemetry/log ingestion. Registered routes were enumerated against `09-ENDPOINT-EVENT-COVERAGE-MATRIX.md`. |
| Backend tests and voice regression | `CANDIDATE_VERIFIED` | Node `22.23.1` full suite: 72 files passed, 401 tests passed, one pre-existing DB HTTP test skipped. Candidate fake-ESP whole-WAV flow completed through STT, Hermes, Piper, MP3 storage, `audio_ready`, and playback lifecycle; candidate remained healthy. |
| Chat/Hermes and proactive server lifecycle | `CANDIDATE_VERIFIED` | Candidate chat operations/messages persisted and Hermes responses were stored; `speakOnDevice=false` was accepted without device audio. Schedule worker expiry guard produced one durable `MISSED` run for a forced expired occurrence; generic proactive queue/unit coverage passed. |
| Wi-Fi server security/lifecycle | `CANDIDATE_VERIFIED` | Candidate-only AES-256-GCM protected key file was mode `0600`, stable across restart, and never logged/returned. Password-bearing and open-network writes/read projection passed; physical apply/rollback remains hardware-gated. |
| WhatsApp live provider | `BLOCKED_EXTERNAL_SECRET` | Hermes live session/API credentials are not provisioned or verified; candidate boundary failed closed/sanitized as specified. |
| Spotify live provider | `BLOCKED_EXTERNAL_SECRET` | Client credentials, callback registration, and provider encryption secret are not provisioned or verified; candidate boundary returned sanitized `503`. |
| Physical ESP acceptance | `PENDING_PHYSICAL_ESP` | Fake-device server acceptance passed for additive event handling. Firmware, real Wi-Fi application/rollback, telemetry/log emission, settings acknowledgement, and physical proactive playback remain unverified. |
| Firewall policy inspection | `BLOCKED_OPERATOR` | `ufw status verbose` and `nft list ruleset` require passworded elevated access. Service/listener/Docker/Caddy checks independently show no port 5555 exposure. |

### Candidate rollback and production promotion boundary

Candidate rollback is limited to the review project: stop/recreate
`bmo-p9-1-backend-1` with the previous candidate image and candidate env, and
restore only the candidate PostgreSQL from the encrypted artifact to a fresh
isolated database if data rollback is required. Do not restore over production.

Production promotion is a separate operator-authorized change. It requires a
fresh production identity check and backup/restore gate, immutable image built
from the final SHA, production-only migration with exact-once verification, a
validated Caddy config, controlled production Backend recreation, and post-change
health/REST/mobile-WS/device-WS/voice/observability checks. The required Caddy
change is an explicit `/api/v1/ws` matcher proxied to `127.0.0.1:3000` before
the existing broad API proxy; Caddy's normal WebSocket upgrade handling is
sufficient. Preserve `/ws`, `/api/v1/voice`, `/audio/*`, and public health
denial. No Caddy change is active from this acceptance.

Proposed production Caddy change, to be validated and activated only during the
separately authorized promotion:

```diff
 api.personalbmo.web.id {
     encode zstd gzip
     ...
     @internal_probes path /livez /livez/* /readyz /readyz/*
     respond @internal_probes 404
+    @mobile_ws path /api/v1/ws
+    reverse_proxy @mobile_ws 127.0.0.1:3000
     reverse_proxy 127.0.0.1:3000
 }
```

The existing broad proxy already preserves the legacy `/ws`, voice, and audio
paths. The explicit matcher documents and verifies the mobile WebSocket path;
no public route is added for Hermes, Audio, PostgreSQL, or port `5555`, and no
manual upgrade headers are required by Caddy.

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
| PostgreSQL | `EXISTING_VERIFIED` | PostgreSQL 16.14, private candidate network, 39 public application tables plus migration table; three migrations finished in the Phase 2.5 candidate |
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
| P9.1 Backend | host bind `127.0.0.1:3010` | `bmo-p9-1-backend-1`, read-only, healthy, Node `22.23.1`, no public Caddy route; Phase 2.5 candidate image is recorded above |
| PostgreSQL | internal candidate network, no published port | `bmo-p9-1-postgres-1`, PostgreSQL `16.14`, persistent bind, healthy |
| Caddy | public `80/443` -> production Backend | active admin config routes `api.personalbmo.web.id` to loopback; `/livez` and `/readyz` are denied publicly |
| Monitoring | declared Beszel/relay services | hub, agent, and Telegram relay healthy |

The active Caddy behavior matches `/opt/bmo/deploy/p7-caddy-cutover.Caddyfile`; `/opt/bmo/config/caddy/Caddyfile` is a rollback/pending 503 file, not the live routing truth. The live `/etc/caddy/Caddyfile` could not be read under the audit user, so the loopback Caddy admin API supplied the sanitized active-route evidence. Secrets/config were inspected by ownership and variable name only; no value is documented.

Audio readiness is `degraded` only because optional RVC is disabled: FastAPI `0.139.2`, Uvicorn `0.51`, faster-whisper `1.2.1`, Kokoro `0.9.4`, Piper TTS `1.6`, and CPU Torch `2.13` are present. Piper is primary and Kokoro fallback.

### Candidate database snapshot

The Phase 2.5 candidate database retained the baseline aggregate counts of 50
users, 12 devices, 31 pairing records, and 74 sessions through backup, isolated
restore, and migration. The live acceptance harness then created three users,
two devices, six sessions, and three pairing records; the final diagnostic
counts were 53/14/80/34. These counts are diagnostic evidence only and do not
imply public/production data ownership.

## Existing source and availability

| Capability | Status | Availability / limitation |
|---|---|---|
| Device WSS `/ws`, raw whole WAV HTTP, MP3 HTTP | `EXISTING_VERIFIED` | Production/public contract |
| Account auth register/login/refresh/logout/logout-all/me | `EXISTING_VERIFIED` | Phase 2.5 private candidate plus Slice 2B source/tests provide self-service DOB registration and canonical `SafeUser`; public production remains unchanged |
| Six-digit pairing | `EXISTING_VERIFIED` | Source + DB-backed candidate; mobile bearer routes, 10-minute TTL, five attempts; physical pairing not proven |
| Device CRUD/settings | `EXISTING_VERIFIED` | Source + private candidate; settings are DB-only and do not sync to ESP |
| P9.1 Prisma foundation | `EXISTING_VERIFIED` | 11 models; two additive migrations; not the target integration schema |
| Phase 2 application data foundation | `EXISTING_VERIFIED` | Source schema plus Phase 2.5 candidate evidence: 27 additive models (38 total), explicit ownership/idempotency/secret-shape constraints, provider-subtype connection integrity, required bounded device-log expiry, repository delegates, and migration `20260811190000_phase2_application_foundation`. Candidate populated upgrade and exact-once repeat deploy passed; production remains unchanged. |
| Production P9.1 activation | `READY_TO_IMPLEMENT` | Existing router is disabled on production |
| Production-shaped P9.1 integration | `EXISTING_VERIFIED` | Phase 2.5 candidate: full Backend runtime registers P9 and existing voice surfaces together on host networking for loopback Hermes/Audio; PostgreSQL has no host publication. Candidate uses the migrated review DB on `127.0.0.1:3010`; public production remains unchanged. |

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

The optional `Session.clientDeviceId` issuance path is source/unit and candidate
verified with
transaction/lock ordering and active-owner validation. Integrated readiness now
requires PostgreSQL health and every migration in the source manifest to be
present and finished whenever P9 is enabled; a static test keeps that manifest
identical to the migration directories. A failed, incomplete, or stalled
database probe is bounded by the readiness timeout and sanitized as
`database: error` with HTTP 503, while `/livez` remains dependency-free and the
P9-disabled response shape is unchanged. The disposable database gate and Phase
2.5 candidate acceptance passed; public availability is not claimed.

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
| Self-service registration | `EXISTING_VERIFIED` | Source + automated route/service tests plus Phase 2.5 private candidate; optional legacy invitation compatibility retained; public production unchanged |
| DOB password recovery | `EXISTING_VERIFIED` | Source + automated enumeration/rate/TTL/hash/epoch/reuse/revocation and lock-aware concurrent issuance tests plus deterministic reset/revocation races; weak MVP factor and not deployed |
| Profile, username, avatar | `EXISTING_VERIFIED` | Source + automated independent-rate/fair pre-Multer admission/30-second receive deadline/disconnect-lifetime/image-bound/media/storage/DB-authoritative reconciliation tests; persistent mounts declared but not created/deployed |
| Personalization | `EXISTING_VERIFIED` | Source + exact bare seven-field response/defaults/strict patch/owner tests; the chat slice now consumes all seven bounded fields in server-built Hermes context |
| Mobile realtime `/api/v1/ws` | `EXISTING_VERIFIED` | Source tests plus Phase 2.5 private candidate: separate transport/auth/session/path/payload/expiry/heartbeat/fanout contract; public production unchanged |
| Chat/history and Hermes-backed send | `EXISTING_VERIFIED` | Source tests plus Phase 2.5 private candidate: owner-scoped REST routes, deterministic history, idempotent durable 202 operations, bounded Hermes scheduling/context, sanitized persistence, and `chat_thinking`/`chat_message` fanout; public production unchanged |
| Memory | `EXISTING_VERIFIED` | Source tests plus Phase 2.5 private candidate read/settings acceptance: bearer-owner routes, bounded records, privacy operations, and bounded chat context; public production unchanged |
| Schedules | `EXISTING_VERIFIED` | Source tests plus Phase 2.5 private candidate CRUD and worker expiry acceptance: strict owner scope, versioning, DB-clock occurrence/missed-run behavior, and typed lifecycle; physical delivery remains pending |
| Wi-Fi DB/API/queue | `EXISTING_VERIFIED` | Source tests plus Phase 2.5 private candidate: owner-scoped latest-write-wins state, AES-256-GCM secret at rest via protected `P9_WIFI_ENCRYPTION_KEY_FILE`, open networks, sanitized status projection, and fake-device server lifecycle; physical apply remains pending |
| Wi-Fi ESP apply/status | `PENDING_PHYSICAL_ESP` | Additive ESP events and physical proof absent; first-boot bootstrap remains a hardware decision |
| Device logs API/storage | `EXISTING_VERIFIED` | Source/test tier: bound-device additive ingestion, allowlisted metadata/redaction, 7-day expiry, per-device rate limit, and owner-scoped read API; physical emission remains pending |
| Telemetry/RSSI API/storage | `EXISTING_VERIFIED` | Source/test tier: bound-device current upsert/read, RSSI bounds, nullable capability-gated battery, and sanitized additive ingestion; physical emission remains pending |
| Telemetry/settings ESP events | `PENDING_PHYSICAL_ESP` | Firmware handlers/physical proof absent; battery value is nullable |
| Generic proactive queue/API | `EXISTING_VERIFIED` | Source tests plus Phase 2.5 private candidate schedule expiry and delivery-state acceptance: one durable CHAT/SCHEDULE/WHATSAPP enqueue/worker path, idempotency, expiry, arbitration, durable MOBILE intents, and typed device-scoped status production. Runtime has no physical sender; device delivery stays pending |
| Generic proactive playback | `PENDING_PHYSICAL_ESP` | Firmware event handling and physical playback proof absent |
| WhatsApp adapter/catalog | `SOURCE_VERIFIED` | Concrete loopback Hermes bridge adapter, owner-scoped poller, JID send boundary, metadata-only inbound persistence, and generic proactive enqueue are implemented and tested; live session remains operator-gated |
| WhatsApp live provider | `BLOCKED_OPERATOR` | Candidate bridge must be configured on loopback port 3001 and the Hermes WhatsApp session must be paired by QR; no session bytes/provider payloads are stored |
| Spotify adapter/catalog | `SOURCE_VERIFIED` | Concrete server-side Authorization Code client, exact callback URI, single-use OAuthState, encrypted token boundary, refresh lifecycle, normalized search/device/playback/action surfaces, and safe plugin status; tokens never enter mobile |
| Spotify live OAuth | `BLOCKED_EXTERNAL_SECRET` | Spotify application credentials, protected provider-key secret, and callback registration are not proven |
| Bug reports | `EXISTING_VERIFIED` | Source/test tier: authenticated multipart route, bounded description/context, max five image attachments, mode-0600 opaque storage keys, SHA-256 metadata, PostgreSQL receipt, and cleanup on transaction failure |
| Voice preview | `DEFERRED` | Last-priority optional surface |

## Tests captured at freeze

- Backend on Node `22.23.1`: 72 files passed; 401 tests passed, 1 skipped. Coverage includes account/profile/recovery/avatar, mobile realtime, chat/Hermes, memory, schedules/proactive delivery, device additions, provider boundaries, plugin catalog, bug reports, and existing voice/device regressions. The one skipped test is the pre-existing authenticated database HTTP test; live candidate HTTP acceptance was enabled separately.
- Backend typecheck, Prisma generate/validate, and in-place build passed on the
  repaired candidate path under Node `22.23.1`. The targeted ownership repair
  covered only `backend/dist` and `backend/src/generated/prisma`; no broad tree
  permission change was made.
- Integration/support source coverage: focused boundary/HTTP tests passed on pinned Node 22; the candidate harness reported 42/42 assertions passed. Spotify live calls stay `BLOCKED_EXTERNAL_SECRET`; WhatsApp source adapter/poller is verified while live bridge/session acceptance stays `BLOCKED_OPERATOR`.
- Build evidence: candidate Docker build, in-place Prisma generate, TypeScript
  build, typecheck, and Prisma validate passed after the targeted ownership fix.
- Prisma validation and generated-client typecheck/build: passed. The source manifest requires three migrations. Historical disposable PostgreSQL evidence covered empty deploy, repeat deploy, and populated two-to-three migration upgrade with P9.1 row preservation. Phase 2.5 then applied the third migration to the isolated candidate and rechecked readiness/schema state. The first post-deploy introspection diff proposed only 14 foreign-key renames; explicit Prisma relation maps now match the deployed constraint names without changing migration SQL or database constraints, and the repeated database-to-schema diff returned `No difference detected`. Transaction-rolled-back positive/negative probes also verified avatar, Wi-Fi AEAD, battery, device-log expiry, provider-subtype, Spotify refresh-secret, and WhatsApp rule constraints.
- Static/rendered packaging: 13 tests passed, 1 unrelated packaging test skipped. PostgreSQL has no host-published port, Backend uses the named Unix-socket volume, and avatar storage uses a separate writable named volume without adding public routing. The Phase 2.5 candidate image ran with application UID/GID `1000:1000` and protected candidate secrets loaded before privilege drop.
- Audio Service: 103 tests passed in the production audio image.
- Documentation verifier: 4 regression tests passed and the direct verifier returned `PASS` before this Phase 2.5 evidence update; it will be rerun after synchronization.
- Production dependency audit: 0 vulnerabilities at `high` or above (and 0 total after the pinned `nanoid` override); Multer `2.2.0` and Sharp `0.35.3` are exact lockfile dependencies.
- A host-Node test attempt failed with `ERR_IPC_CHANNEL_CLOSED`; this is an environment mismatch, not a test regression.

## Current blockers

1. `BLOCKED_OPERATOR`: review/install of the dedicated bridge, protected exact allowlist provisioning, and physical WhatsApp QR pairing are required; no session or bridge listener is currently available.
2. `BLOCKED_EXTERNAL_SECRET`: Spotify application credentials, protected provider encryption secret, and callback registration are not proven.
3. `PENDING_PHYSICAL_ESP`: first-boot Wi-Fi bootstrap, battery sensing capability, additive events, and physical playback require firmware/bench evidence.
4. Current UFW/nft rules remain unreadable without passworded elevated privileges. Listener, Docker, and Caddy evidence prove no service currently accepts port 5555; firewall-policy inspection remains an operator evidence gap for final public/private sign-off.

## Phase 2.5 completion state

The core candidate acceptance gate passed. The next boundary is production
promotion under separate explicit operator authorization. The additive migration
is applied only to the review candidate. Public activation, provider
configuration, and physical ESP work remain separately gated.
