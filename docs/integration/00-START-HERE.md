# BMO Integration Pack — Canonical Contract Freeze

**Version:** 2.0.0
**Frozen:** 2026-08-11
**Phase:** Phase 1 — VPS Audit + Documentation Freeze
**Implementation authority:** none; Phase 2 starts only from the checkpoint in `docs/NEXT-ACTION.md`.

**Current source checkpoint:** Phase 2 Slice 2B account/profile/recovery/avatar
and personalization is source/test verified, including serialized recovery
epochs and bounded avatar multipart/image-processing admission. This does not
alter the frozen Phase 1 runtime facts below: the running private candidate is
still invitation-era/unmigrated and public production is unchanged.

## 1. Terminology and authority

For this project, **backend** means the complete BMO VPS platform:

```text
Caddy + public TLS/routing
Docker Engine + Compose/runtime
Backend API service (Express/Node)
PostgreSQL + Prisma
Hermes Agent
Audio Service
Beszel/observability
secrets/config
internal networking + deployment state
```

Use **Backend API service** only for the Express/Node component.

Authority order for the integration release:

1. existing physical voice wire contract: `docs/hardware-contract/BMO-MVP-HW-INTERFACE-CONTRACT-v1.0.5.md`;
2. approved integration REST/mobile/device targets: `01-MOBILE-BACKEND-API-CONTRACT.md` and `02-BACKEND-DEVICE-ADDITIVE-CONTRACT.md`;
3. locked decisions: `06-DECISION-REGISTER.md`;
4. actual baseline and availability: `05-IMPLEMENTATION-STATUS.md`;
5. per-surface readiness/evidence: `09-ENDPOINT-EVENT-COVERAGE-MATRIX.md`;
6. concern-specific P9 and backend-MVP documents linked from `docs/README.md`.

If documentation and code/runtime disagree, code/runtime determines the current implementation claim and the target contract remains explicitly `READY_TO_IMPLEMENT`, `PENDING_PHYSICAL_ESP`, `BLOCKED`, or `DEFERRED`.

## 2. Frozen baseline

Audit base:

```text
source branch before freeze: main
source SHA: d638b20c381c676136c94524a38a1def5d70e565
documentation branch: docs/integration-contract-freeze
production voice image source: 4d7b472adc4c2243d8f7364032a491ad70efb6d3
```

Verified current boundaries:

- production public voice remains `WSS /ws`, raw whole-WAV `POST /api/v1/voice`, and MP3 `GET /audio/:audioId.mp3`;
- production Backend API service does not enable P9 and public auth/device/settings/mobile-WS routes return `404`;
- current repository contains the implemented P9.1 invitation-auth, session, six-digit pairing, device, and settings source;
- a private P9.1 candidate and PostgreSQL 16.14 run on an internal Docker network with two applied migrations and no host-published port;
- the P9.1 candidate is not the production Backend API service;
- mobile `WSS /api/v1/ws`, chat/history, memory, scheduler, integration adapters, Wi-Fi DB/API, telemetry/log storage, proactive queue, plugins, and bug reports remain `READY_TO_IMPLEMENT`; Slice 2B account/profile/recovery/avatar and personalization are `EXISTING_VERIFIED` at source/test tier only;
- the existing device identity remains runtime `DEVICE_ID`/`DEVICE_TOKEN`; Slice 1 resolves an optional active P9.1 application row after legacy authentication and revalidates it before any owner-specific use;
- Hermes 0.20.0 is healthy on loopback; Audio Service is healthy/degraded only because RVC is intentionally disabled; Caddy exposes the public API through port 443;
- physical ESP32 acceptance and every new additive firmware capability remain unverified.
- at the Phase 1 freeze, a manual Prisma Studio process listened on `*:5555`; Phase 2 stopped it and verified no listener, Docker publication, or Caddy route remains. Privileged firewall-policy visibility is still an operator evidence gap.

Exact route, schema, runtime, test, and blocker evidence is in `05-IMPLEMENTATION-STATUS.md`.

## 3. Approved Phase 2 scope

The following target scope is frozen and must not be re-inferred from older UI or architecture drafts:

```text
self-service registration
DOB password recovery
profile + unique username + avatar
personalization
existing 6-digit pairing
device APIs/settings
Wi-Fi configuration via VPS DB → ESP
mobile chat/history
separate mobile realtime WebSocket
memory
schedules
WhatsApp
Spotify
plugin catalog limited to WhatsApp + Spotify
bug reports
device logs
telemetry/RSSI
generic proactive audio
device settings sync
```

Voice preview remains `DEFERRED` unless separately prioritized after the required scope.

## 4. Compatibility locks

The physical voice transport is unchanged:

```text
device WSS /ws
authentication message uses device_id + device_token
raw whole WAV via HTTP
MP3 via HTTP
device JSON remains snake_case
```

The mobile realtime contract is separate:

```text
mobile WSS /api/v1/ws
access token sent after socket open
mobile JSON uses camelCase
REST submits commands; WS delivers realtime status/results
no token streaming, microphone streaming, or audio streaming
```

Never expose a device credential to mobile or allow a mobile access token to authenticate `/ws`.

## 5. Locked ownership

```text
Mobile              presentation, local drafts/session storage, user intent
Caddy               public TLS and reverse proxy only
Backend API service authz, APIs, idempotency, orchestration, policy, adapters
PostgreSQL          durable application state and audit
Hermes              reasoning/personality and Hermes-owned WhatsApp session
Audio Service       STT/TTS/FFmpeg only
ESP32               recording, playback, local display/Wi-Fi/telemetry capabilities
External providers  provider-side account/playback/messaging state
```

Mobile never calls PostgreSQL, Hermes, Audio Service, Spotify, WhatsApp, or ESP32 directly. Hermes and Audio Service remain private. Backend is the only application authority crossing those boundaries.

## 6. Device identity lock

Current production voice authentication and P9.1 application identity are separate implementations. Phase 2 must preserve the current physical credential and add a resolver after successful `/ws` authentication:

```text
authenticated device_id
→ active Device.hardwareId equality
→ SHA-256(authenticated device_token) equals Device.tokenHash
→ resolve owning User/Device
```

If no active matching row exists, existing voice remains available but owner-specific Wi-Fi, settings, telemetry ownership, logs, and proactive content are denied with a safe diagnostic. No implicit credential rotation is allowed.

## 7. Hardware status rule

Every new ESP behavior is `PENDING_PHYSICAL_ESP` until real firmware/device evidence exists. This includes Wi-Fi apply/rollback, RSSI/log emission, proactive playback/deduplication, and playback-volume settings application. Backend code or simulated tests cannot upgrade that classification.

## 8. Phase 1 stop condition

This freeze authorizes documentation changes only. It does not authorize:

- feature implementation;
- production migration;
- application/container/Caddy restart or deployment;
- firewall changes;
- device credential rotation;
- physical firmware claims.

Phase 2 starts exactly at `docs/NEXT-ACTION.md` and must treat the matrix/status files as the pre-implementation baseline.
