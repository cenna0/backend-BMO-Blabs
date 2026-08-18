# BMO — Current Next Action

**Last updated:** 2026-08-18
**Current executable boundary:** Mobile application integration against the live production P9 Backend.
**Canonical source:** Git `main` at `e4f87ca5faf81e1c495c2719f3bb19b056340657`.

P9 production promotion, PostgreSQL bootstrap, the six migrations, backups,
Backend cutover, source closure, and main fast-forward are complete. Do not
repeat promotion, migrations, candidate acceptance, or runtime cleanup as part
of Mobile integration.

## Mobile starting point

Read these documents in order:

1. [`integration/00-START-HERE.md`](integration/00-START-HERE.md)
2. [`integration/01-MOBILE-BACKEND-API-CONTRACT.md`](integration/01-MOBILE-BACKEND-API-CONTRACT.md)
3. [`integration/05-IMPLEMENTATION-STATUS.md`](integration/05-IMPLEMENTATION-STATUS.md)
4. [`integration/09-ENDPOINT-EVENT-COVERAGE-MATRIX.md`](integration/09-ENDPOINT-EVENT-COVERAGE-MATRIX.md)

Production API: `https://api.personalbmo.web.id`

Mobile WebSocket: `wss://api.personalbmo.web.id/api/v1/ws`

Hardware WebSocket: `wss://api.personalbmo.web.id/ws` — separate from Mobile.

Current runtime context: production Hermes integration is verified on the
private origins only boundary `127.0.0.1:8642`; Audio and Backend remain
private dependencies. Real RVC inference is not verified.

## Current Mobile work

1. Build the API client around the common error envelope, `X-Request-Id`,
   explicit route authentication, pagination, and idempotency rules.
2. Implement registration, login, refresh, logout, recovery, profile, avatar,
   user settings, and personalization.
3. Integrate six-digit pairing only after the unresolved provenance of
   `hardwareId`, `deviceName`, and `deviceCredential` is defined. The current
   Backend does not provide a Mobile discovery/BLE/QR handoff for those values.
4. Implement device list/detail/unpair, both device-settings PATCH aliases,
   Wi-Fi desired-state UI, and REST diagnostics.
5. Add `/api/v1/ws` lifecycle handling, including `authenticate`, reconnect,
   heartbeat, runtime-emitted events, and forward-compatible schema-only event
   handlers with REST fallback.
6. Add chat/history, memory, schedules, WhatsApp projections, Spotify browser
   OAuth plus REST status polling, and bug reports in the dependency order
   defined by `00-START-HERE.md`.

Mobile calls only the Backend. It must not call Hermes, PostgreSQL, Audio,
WhatsApp bridge/resolver, Spotify Web API, or the hardware `/ws` protocol.

## Explicit remaining boundaries

- `PAIRING_MOBILE_INPUT_SOURCE_NEEDS_REVIEW` blocks a fully specified pairing
  UX until hardware input provenance is defined.
- Physical ESP Wi-Fi/log/telemetry/settings/proactive behavior remains
  `PENDING_PHYSICAL_ESP`.
- WhatsApp provider send/inbound acceptance and Spotify provider action/OAuth
  acceptance remain separately controlled; route registration is not provider
  acceptance.
- `integration_status`, `device_status`, `voice_processing_status`,
  `wifi_configuration_status`, and `notification` are schema-defined without
  direct current emitters. They are not required current runtime signals.

## Historical/operator evidence

These records are useful for audit history only and are not current Mobile
instructions:

- [`integration/04-VPS-IMPLEMENTATION-PLAN.md`](integration/04-VPS-IMPLEMENTATION-PLAN.md)
- [`integration/07-ONE-SHOT-AGENT-PROMPT.md`](integration/07-ONE-SHOT-AGENT-PROMPT.md)
- [`integration/10-OPERATOR-PROMPT-RUNBOOK.md`](integration/10-OPERATOR-PROMPT-RUNBOOK.md)
- historical roadmap, P9 evidence, and deployment records

## Historical verifier control record

The following predecessor declaration is retained solely because the legacy
repository verifier protects the historical P9 control record. It is not a
current action, status, authorization, or production claim:

> Historical predecessor: the exact legacy declaration was:
>
> Historical verifier evidence follows; it is fenced so it cannot be read as
> current executable state:

```text
Current next phase: P9.1 — PostgreSQL, auth, pairing, and settings foundation
**Phase state:** `P8_PIPER_PRODUCTION_VERIFIED; P9.1 ARCHITECTURE LOCKED; isolated P9.1 candidate implemented; production activation not authorized`
```

>
> Historical control text: P7 is `VERIFIED — PRODUCTION`; P8 is `P8_PIPER_PRODUCTION_VERIFIED`; P8 completion does **not** authorize P9; `execute P9` and `Do not execute P10` were historical gate language only.
