# BMO Repository Bootstrap

The canonical branch is `main`. Repository orientation starts at
[`docs/README.md`](docs/README.md).

## Audience entrypoints

- Mobile coding agents:
  [`docs/integration/MOBILE-AGENT-HANDOFF.md`](docs/integration/MOBILE-AGENT-HANDOFF.md)
- ESP/Hardware coding agents:
  [`docs/integration/ESP-AGENT-HANDOFF.md`](docs/integration/ESP-AGENT-HANDOFF.md)
- Current executable boundary:
  [`docs/NEXT-ACTION.md`](docs/NEXT-ACTION.md)

Mobile authority is the handoff plus integration `00`, `01`, `05`, and `09`.
ESP authority is the ESP handoff, integration `02` and `03`, source event
schemas, and the immutable existing hardware voice contract. Do not read
integration `04`, `07`, or `10`, old phase plans, candidate runbooks, or frozen
PRDs as current execution instructions.

## Current production boundary

- Backend/VPS code-only pairing is deployed and production-verified.
- Mobile API: `https://api.personalbmo.web.id`
- Mobile WSS: `wss://api.personalbmo.web.id/api/v1/ws`
- Hardware WSS: `wss://api.personalbmo.web.id/ws`
- production Backend origin: `127.0.0.1:3000`
- production migrations: `7 completed, 0 unfinished, 0 rolled_back`
- Mobile coverage: `79` REST routes and `12` WebSocket event names
- physical ESP pairing remains `PENDING_PHYSICAL_ESP`
- candidate port `3010` is historical/non-production.

The deployed image is `bmo-p9.1:pairing-code-only-d1473d0`, built from
immutable source revision `d1473d04f4b76ccb52cc8eeaff52a268504310f0`.
That provenance is not the mutable repository HEAD; inspect the checkout with
`git rev-parse HEAD`.

## Current supporting references

- physical voice contract:
  [`docs/hardware-contract/BMO-MVP-HW-INTERFACE-CONTRACT-v1.0.5.md`](docs/hardware-contract/BMO-MVP-HW-INTERFACE-CONTRACT-v1.0.5.md)
- STT/TTS runtime values:
  [`docs/backend-mvp/CURRENT-RUNTIME-CONFIG.md`](docs/backend-mvp/CURRENT-RUNTIME-CONFIG.md)
- current implementation status:
  [`docs/integration/05-IMPLEMENTATION-STATUS.md`](docs/integration/05-IMPLEMENTATION-STATUS.md)
- route/event coverage:
  [`docs/integration/09-ENDPOINT-EVENT-COVERAGE-MATRIX.md`](docs/integration/09-ENDPOINT-EVENT-COVERAGE-MATRIX.md)

Historical evidence is retained for traceability and must remain labeled as
historical. Never commit real secrets or copy protected runtime values into
Git/docs.

Legacy verifier compatibility links, in protected historical order (not an
agent onboarding chain):

1. [`docs/roadmap/P8-EXECUTION-SPEC.md`](docs/roadmap/P8-EXECUTION-SPEC.md)
2. [`docs/backend-mvp/IMPLEMENTATION-STATUS.md`](docs/backend-mvp/IMPLEMENTATION-STATUS.md)
3. [`docs/product/BMO-BY-BLABS-PRD-v1.2.4.md`](docs/product/BMO-BY-BLABS-PRD-v1.2.4.md)

These links retain verifier-protected P8/P9.1 lineage only; their old phase
status does not override the audience entrypoints above.

Repository docs verifier:

```text
python3 scripts/verify-backend-mvp-docs.py
```
