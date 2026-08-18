# BMO Mobile Integration — Current Production Entry Point

**Audited:** 2026-08-18
**Source of truth:** Git `main` at `e4f87ca5faf81e1c495c2719f3bb19b056340657`
**Production state:** P9 Backend and PostgreSQL are live and healthy.

This is the current onboarding page for the Mobile team. Do not use old
candidate handoffs as a production guide.

## Read in this order

1. `01-MOBILE-BACKEND-API-CONTRACT.md` — the canonical Mobile API contract.
2. `05-IMPLEMENTATION-STATUS.md` — implementation and production-verification status.
3. `09-ENDPOINT-EVENT-COVERAGE-MATRIX.md` — source-derived route and event inventory.

`02-BACKEND-DEVICE-ADDITIVE-CONTRACT.md` and
`03-HARDWARE-IMPLEMENTATION-HANDOFF.md` are for the separate physical-device
contract. They do not replace the Mobile API contract.

## Production endpoints

```text
API base:       https://api.personalbmo.web.id
Mobile WS:      wss://api.personalbmo.web.id/api/v1/ws
Hardware WS:    wss://api.personalbmo.web.id/ws
```

The two WebSockets are different protocols and authentication contracts.
Mobile uses only `/api/v1/ws`; the ESP32 uses only `/ws`.

The physical Mobile app must not use VPS localhost addresses. Port `3010` is a
historical private candidate port and is not the production Mobile API.

Mobile communicates only with the BMO Backend. It must not connect directly to
Hermes, PostgreSQL, Audio Service, the WhatsApp bridge, the WhatsApp identity
resolver, Spotify Web API, or the ESP32.

## Authority and status vocabulary

When prose conflicts with source, tests, migrations, or the running production
definition, those sources win. The current status vocabulary is:

- `PRODUCTION_VERIFIED` — the route/runtime is present in the promoted production image; this does not prove provider or physical-device success.
- `IMPLEMENTED` — source and relevant tests implement the behavior, but production verification is not claimed.
- `PARTIALLY_IMPLEMENTED` — only a defined subset is implemented.
- `NOT_IMPLEMENTED` — no registered production implementation exists.
- `OUT_OF_SCOPE` — intentionally not a Mobile feature in this release.
- `BLOCKED` — an external/provider/operator gate prevents the behavior.
- `PENDING_PHYSICAL_ESP` — Backend support exists or is defined, but firmware and real-device evidence are still required.

## Current production architecture

```text
React Native Mobile
        │ HTTPS / WSS
        ▼
BMO Backend :3000
   ├── PostgreSQL :private
   ├── Hermes :8642
   ├── Audio Service :8001
   ├── WhatsApp bridge :3001
   ├── WhatsApp identity resolver :3002
   └── Spotify provider boundary
```

Only the Backend is a Mobile integration boundary. Spotify/provider access and
refresh tokens, OAuth state, resolver/provider/session internals, and internal
service keys remain server-side. The Mobile app necessarily holds the BMO
application access and refresh tokens, submits the Wi-Fi password to the
Backend, and may submit `deviceCredential` for pairing if its external
provenance is resolved. Wi-Fi passwords are never returned in Backend
responses, and pairing `deviceCredential` is never returned and is hashed
before persistence.

## Integration order

Use this order because later features depend on earlier identity and transport
state:

1. API client, `X-Request-Id`, and the common error envelope.
2. Registration, login, access/refresh session persistence, logout, and recovery.
3. `/me`, profile, avatar, user settings, and personalization.
4. Resolve `PAIRING_MOBILE_INPUT_SOURCE_NEEDS_REVIEW` before implementing the
   end-to-end six-digit BMO pairing UX. Pairing is currently
   `PARTIALLY_IMPLEMENTED` at the external input boundary because the Backend
   does not define how Mobile obtains `hardwareId`, `deviceName`, or
   `deviceCredential`; device list/detail/unpair and device settings remain
   separable work where their implemented APIs permit.
5. Mobile WebSocket authentication, heartbeat, reconnect, and event dispatch.
6. Chat sessions, history, idempotent message submission, and WebSocket updates.
7. Memory records, candidates, summaries, forget/delete/export operations.
8. Schedules, optimistic versioning, pause/resume/cancel, and run history.
9. WhatsApp application routes; provider setup remains operator-controlled.
10. Spotify server-side OAuth/status/devices/playback/actions.
11. Bug reports and diagnostics.

## Production safety boundaries

- Do not repeat production promotion, migrations, or candidate acceptance as part of Mobile integration.
- Do not use candidate Compose, candidate secrets, candidate callback URLs, or `/tmp/bmo-p9-1-validation-*` paths.
- Do not apply the candidate Caddy patch or use port `3010`.
- Do not call `/messages`, `/send`, Hermes, Spotify, PostgreSQL, or the resolver directly.
- Do not treat source/test implementation as proof of physical ESP behavior.

## Companion documents

- `06-DECISION-REGISTER.md` records non-negotiable ownership and lifecycle decisions.
- `08-DOCS-MAINTENANCE-PROTOCOL.md` requires route/event documentation to change with implementation.
- `02-BACKEND-DEVICE-ADDITIVE-CONTRACT.md` is the Backend ↔ ESP32 contract.
- `03-HARDWARE-IMPLEMENTATION-HANDOFF.md` records the remaining physical work.
- `04-VPS-IMPLEMENTATION-PLAN.md`, `07-ONE-SHOT-AGENT-PROMPT.md`, and `10-OPERATOR-PROMPT-RUNBOOK.md` are completed historical operational records, not current promotion instructions.
