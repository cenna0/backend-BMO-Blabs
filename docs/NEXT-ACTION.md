# BMO — Current Next Action

> **CURRENT / CANONICAL**
> Current source and the canonical integration package override dated
> plans/evidence.

**Last updated:** 2026-08-25
**Current executable boundary:** Mobile application integration against the live production P9 Backend.
**Deployed-image source revision:** `d1473d04f4b76ccb52cc8eeaff52a268504310f0` (immutable image provenance, not current Git HEAD).
**Production status:** `PRODUCTION_VERIFIED` — Backend deployed as `bmo-p9.1:pairing-code-only-d1473d0`.
**Migration #7:** `20260818110000_pairing_code_only_enrollment` is applied in production; migration state is `7 completed, 0 unfinished, 0 rolled_back`.
**Production verification:** Direct/public health and the six-sample production soak passed. Mobile REST coverage is 79 routes and Mobile WebSocket coverage is 12 events.
**Rollback anchor:** `bmo-p9.1:spotify-phase26-9819ef7` remains preserved.
**Physical status:** `PENDING_PHYSICAL_ESP`.
**Audio status:** `PRODUCTION_VERIFIED` — Piper-only production image `bmo-audio@sha256:24e1c4244ea8868f731d819ea75cb57c1e464b6df3bd9679d65fd4711643488c`; Kokoro active artifacts purged; the former fallback model is not retained on-host; final evidence is `docs/operations/2026-08-24-piper-only-purge-evidence.md`.

P9 production promotion, PostgreSQL bootstrap, the seven migrations, encrypted
backups, Backend cutover, source closure, and main fast-forward are complete.
Do not repeat promotion, production migrations, candidate acceptance, or
runtime cleanup as part of Mobile integration. The remaining pairing boundary
is physical firmware implementation and real-device acceptance.

## Mobile starting point

Start with
[`integration/MOBILE-AGENT-HANDOFF.md`](integration/MOBILE-AGENT-HANDOFF.md),
then read the linked canonical package:

Read these documents in order:

1. [`integration/00-START-HERE.md`](integration/00-START-HERE.md)
2. [`integration/01-MOBILE-BACKEND-API-CONTRACT.md`](integration/01-MOBILE-BACKEND-API-CONTRACT.md)
3. [`integration/05-IMPLEMENTATION-STATUS.md`](integration/05-IMPLEMENTATION-STATUS.md)
4. [`integration/09-ENDPOINT-EVENT-COVERAGE-MATRIX.md`](integration/09-ENDPOINT-EVENT-COVERAGE-MATRIX.md)

Production API: `https://api.personalbmo.web.id`

Mobile WebSocket: `wss://api.personalbmo.web.id/api/v1/ws`

Hardware WebSocket: `wss://api.personalbmo.web.id/ws` — separate from Mobile.

ESP/Hardware work starts at
[`integration/ESP-AGENT-HANDOFF.md`](integration/ESP-AGENT-HANDOFF.md). Its
immediate milestone is `HW_VPS_CONNECTION_STABLE`; pairing comes only after
stable WSS/auth/reconnect/voice continuity.

Current runtime context: Hermes, Audio, Backend, and PostgreSQL are healthy on private origins. Audio is Piper-only; Mobile and ESP clients never call Audio or Hermes directly. RVC is historical-only and not a production dependency.

## Current Mobile work

1. Build the API client around the common error envelope, `X-Request-Id`,
   explicit route authentication, pagination, and idempotency rules.
2. Implement registration, login, refresh, logout, recovery, profile, avatar,
   user settings, and personalization.
3. Integrate code-only six-digit pairing. The physical BMO receives
   `pairing_code` over its authenticated `/ws`; Mobile submits only `{code}` to
   `POST /api/v1/pairing/claim` and may rename the resulting Device afterward.
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

- Backend code-only pairing is deployed and production-verified; physical
  firmware display, reissue, completion handling, and real-device acceptance
  remain `PENDING_PHYSICAL_ESP`.
- Physical ESP Wi-Fi/log/telemetry/settings behavior remains
  `PENDING_PHYSICAL_ESP`. Generic proactive delivery is Backend-durable, but
  no proactive hardware event family is defined in the current `/ws` source
  schema.
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
