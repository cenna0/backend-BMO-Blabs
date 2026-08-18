# BMO P9 — Current Architecture and Scope Authority

**Frozen:** 2026-08-11; production status synchronized 2026-08-18
**Current authority:** [`../integration/00-START-HERE.md`](../integration/00-START-HERE.md), [`../integration/01-MOBILE-BACKEND-API-CONTRACT.md`](../integration/01-MOBILE-BACKEND-API-CONTRACT.md), [`../integration/05-IMPLEMENTATION-STATUS.md`](../integration/05-IMPLEMENTATION-STATUS.md), and [`../integration/09-ENDPOINT-EVENT-COVERAGE-MATRIX.md`](../integration/09-ENDPOINT-EVENT-COVERAGE-MATRIX.md).

P9.1 is implemented on `main` at `e4f87ca5faf81e1c495c2719f3bb19b056340657` and is live in the public production Backend. The production Mobile API is `https://api.personalbmo.web.id`, the Mobile WebSocket is `wss://api.personalbmo.web.id/api/v1/ws`, and the hardware WebSocket remains the separate `wss://api.personalbmo.web.id/ws` contract. Candidate-only assets, port `3010`, loopback callback URLs, and validation paths are historical and must not be used as production instructions. P9.2–P9.6 remain proposed in the historical stage model unless the current integration status says otherwise.

> **Historical isolated-candidate safety assertion — superseded for current production:** the pre-promotion record stated that no P9.1 candidate is deployed to production and that P9.2–P9.6 remain proposed and not implemented. That record is retained as historical evidence; the current production status is the statement above and the canonical integration package.

## Current classification

- Production: P9 Backend REST and authenticated Mobile `/api/v1/ws`, PostgreSQL,
  the legacy hardware `/ws` contract, Hermes, and Audio Service integration.
- `PRODUCTION_VERIFIED`: P9 production runtime, six applied Prisma migrations,
  public routing, and the production Spotify callback are operationally verified.
- `IMPLEMENTED`: the source-backed Mobile auth, profile, personalization,
  pairing, devices/settings, chat, memory, schedules, WhatsApp projections,
  Spotify lifecycle, bug-report, and Mobile WebSocket contracts documented in
  the integration package.
- `PENDING_PHYSICAL_ESP`: additive firmware behavior and physical hardware
  acceptance remain outside this Backend documentation synchronization.
- `NOT_IMPLEMENTED` / `OUT_OF_SCOPE`: capabilities explicitly marked that way
  in the canonical Mobile contract; do not infer APIs from historical plans.

The current PRD is [`../product/BMO-BY-BLABS-PRD-v1.4.0.md`](../product/BMO-BY-BLABS-PRD-v1.4.0.md). The locked v1.2.4 PRD, P9.1 evidence, and review files are historical evidence and must not be rewritten.

## Reading order

1. [`../integration/00-START-HERE.md`](../integration/00-START-HERE.md) through [`../integration/10-OPERATOR-PROMPT-RUNBOOK.md`](../integration/10-OPERATOR-PROMPT-RUNBOOK.md)
2. [`01-product-scope.md`](01-product-scope.md)
3. [`03-system-architecture.md`](03-system-architecture.md)
4. [`04-component-ownership.md`](04-component-ownership.md)
5. [`05-source-of-truth-matrix.md`](05-source-of-truth-matrix.md)
6. [`06-preliminary-prisma-schema.md`](06-preliminary-prisma-schema.md)
7. domain documents `08`–`19`
8. [`23-test-acceptance-matrix.md`](23-test-acceptance-matrix.md), [`24-decision-register.md`](24-decision-register.md), and [`25-unresolved-decisions.md`](25-unresolved-decisions.md)

The public physical voice authority remains [`../hardware-contract/BMO-MVP-HW-INTERFACE-CONTRACT-v1.0.5.md`](../hardware-contract/BMO-MVP-HW-INTERFACE-CONTRACT-v1.0.5.md). Additive device proposals do not edit or reinterpret it.
