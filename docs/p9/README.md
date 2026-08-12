# BMO P9 — Current Architecture and Scope Authority

**Frozen:** 2026-08-11
**Current authority:** [`../integration/00-START-HERE.md`](../integration/00-START-HERE.md) and the Phase 1 freeze documents.

P9.1 source is present at the audited `main` SHA and is verified in a private candidate stack. Its auth, six-digit pairing, device, settings, Prisma, and PostgreSQL foundation is not enabled on the public production Backend API. The historical statement “no P9.1 candidate is deployed to production” remains true when “production” means the public production service; the candidate is an isolated private runtime. P9.2–P9.6 remain proposed in the historical stage model and are not implemented.

## Current classification

- Existing production: device `/ws`, raw whole WAV over HTTP, MP3 over HTTP, Hermes and Audio Service integration.
- Existing private candidate: P9.1 auth/session, pairing, devices/settings, 11-model Prisma schema, two applied migrations.
- Source/test `EXISTING_VERIFIED`: Slice 2B self-service account recovery,
  profile/avatar, personalization persistence, and the separate authenticated
  mobile realtime `/api/v1/ws` transport; the private candidate and public
  production are unchanged.
- `READY_TO_IMPLEMENT`: approved chat/memory/scheduler/integration backend scope and later personalization-to-Hermes context assembly.
- `PENDING_PHYSICAL_ESP`: all additive firmware events and physical acceptance.
- `BLOCKED`: the exact operational/provider gates in the integration status file.

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
