# BMO Documentation — Current Entry Point

> **CURRENT / CANONICAL**
> This page routes Mobile and ESP/Hardware agents to the current production
> contract. If it conflicts with dated plans/evidence, current source and the
> canonical integration package win.

**Last audited:** 2026-08-20
**Backend/VPS status:** code-only pairing is deployed and production-verified.
**Physical pairing status:** `PENDING_PHYSICAL_ESP`.

## Mobile agent start

Start at [`integration/MOBILE-AGENT-HANDOFF.md`](integration/MOBILE-AGENT-HANDOFF.md),
then follow its short reading order:

1. [`integration/00-START-HERE.md`](integration/00-START-HERE.md)
2. [`integration/01-MOBILE-BACKEND-API-CONTRACT.md`](integration/01-MOBILE-BACKEND-API-CONTRACT.md)
3. [`integration/05-IMPLEMENTATION-STATUS.md`](integration/05-IMPLEMENTATION-STATUS.md)
4. [`integration/09-ENDPOINT-EVENT-COVERAGE-MATRIX.md`](integration/09-ENDPOINT-EVENT-COVERAGE-MATRIX.md)

Current Mobile boundary:

- API: `https://api.personalbmo.web.id`
- WebSocket: `wss://api.personalbmo.web.id/api/v1/ws`
- registered Mobile REST routes: `79`
- Mobile WebSocket event names: `12`
- ordinary pairing: authenticated `POST /api/v1/pairing/claim` with
  `{ "code": "123456" }` only
- Mobile communicates only with Backend; it never receives the hardware
  `DEVICE_TOKEN` or calls hardware `/ws`.

## ESP/Hardware agent start

Start at [`integration/ESP-AGENT-HANDOFF.md`](integration/ESP-AGENT-HANDOFF.md).
It routes to the exact current `/ws` event contract, the immutable existing
voice contract, and the physical acceptance boundary.

Current Hardware boundary:

- WebSocket: `wss://api.personalbmo.web.id/ws`
- immediate milestone: `HW_VPS_CONNECTION_STABLE`
- stabilize Wi-Fi, DNS, time, TLS, WSS, authentication, ping/pong, reconnect,
  and existing voice continuity before implementing physical pairing
- Backend pairing support is deployed; firmware/real-device acceptance remains
  `PENDING_PHYSICAL_ESP`
- this Backend repository is not the ESP firmware repository.

## Production facts

- Backend origin: `127.0.0.1:3000`
- immutable deployed image: `bmo-p9.1:pairing-code-only-d1473d0`
- deployed-image source revision: `d1473d04f4b76ccb52cc8eeaff52a268504310f0`
- production has exactly seven completed P9 migrations, including
  `20260818110000_pairing_code_only_enrollment`
- production migration state: `7 completed, 0 unfinished, 0 rolled_back`
- candidate port `3010` is historical/non-production
- health and the six-sample production soak passed; the rollback image remains
  preserved.
- real RVC inference is not verified; `rvc=unavailable` is an accepted
  readiness limitation, not a Mobile/ESP outage
- physical ESP32 integration is not verified; current firmware pairing status
  remains `PENDING_PHYSICAL_ESP`.

Discover the current repository revision with `git rev-parse HEAD`. Do not
confuse mutable Git HEAD with the immutable source revision of the deployed
image.

## Current authority and historical records

Current integration authority is the Mobile/ESP entrypoints plus integration
documents `00`, `01`, `02`, `03`, `05`, `06`, `08`, and `09`.

The physical voice authority remains
[`hardware-contract/BMO-MVP-HW-INTERFACE-CONTRACT-v1.0.5.md`](hardware-contract/BMO-MVP-HW-INTERFACE-CONTRACT-v1.0.5.md).
Current STT/TTS values are in
[`backend-mvp/CURRENT-RUNTIME-CONFIG.md`](backend-mvp/CURRENT-RUNTIME-CONFIG.md).

Dated plans, specs, PRDs, acceptance evidence, audit reports, candidate
runbooks, and old phase prompts record their checkpoint only. They are not
current Mobile or ESP implementation instructions. In particular, do not read
every integration file `00` through `10` as an onboarding sequence: `04`, `07`,
and `10` are completed historical operator records.

Legacy verifier compatibility links (historical only):

- [`NEXT-ACTION.md`](NEXT-ACTION.md)
- [`roadmap/P8-EXECUTION-SPEC.md`](roadmap/P8-EXECUTION-SPEC.md)
- [`roadmap/P6-EXECUTION-SPEC.md`](roadmap/P6-EXECUTION-SPEC.md)
- [`product/BMO-BY-BLABS-PRD-v1.2.4.md`](product/BMO-BY-BLABS-PRD-v1.2.4.md)

The protected lineage statement “P7 is `VERIFIED — PRODUCTION`” remains true
for its voice rollout checkpoint, but current production authority is the P9
integration status above.

### Hermes host bootstrap clarification

The historical production VPS preflight reported Hermes absent. P6 re-confirmed
the `ABSENT` branch and created the maintained loopback host service; P7 later
verified production integration. This does not modify the locked PRD snapshot or hardware contract. Current Hermes remains a private Backend dependency.

## Secrets and verification

Never store credentials, database URLs, Wi-Fi passwords, provider
tokens/session bytes, recovery/pairing values, or hardware tokens in Git/docs.

Repository docs verifier:

```text
python3 scripts/verify-backend-mvp-docs.py
```
