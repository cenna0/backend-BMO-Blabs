# BMO P9 — Current Architecture and Scope Authority

> **CURRENT / CANONICAL NAVIGATION**
> Current runtime/API/status authority is source plus the canonical integration
> package. Numbered P9 files retain domain design and checkpoint context; follow
> their status banners and never let a frozen candidate statement override the
> current integration docs.

**Audited:** 2026-08-20

P9 Backend and PostgreSQL are live in production. Code-only pairing is deployed
in `bmo-p9.1:pairing-code-only-d1473d0`; production has seven completed
migrations, including `20260818110000_pairing_code_only_enrollment`. Mobile has
79 registered REST routes and 12 Mobile WebSocket event names. Production uses
Backend port `3000`; candidate port `3010` is historical/non-production.

The immutable deployed image was built from source revision
`d1473d04f4b76ccb52cc8eeaff52a268504310f0`. That is not a claim about current
Git HEAD. Use `git rev-parse HEAD` to discover the repository revision.

Physical ESP pairing, display, completion handling, and real-device acceptance
remain `PENDING_PHYSICAL_ESP`. Backend deployment is not pending.

## Current integration authority

For Mobile, start at
[`../integration/MOBILE-AGENT-HANDOFF.md`](../integration/MOBILE-AGENT-HANDOFF.md).
For ESP/Hardware, start at
[`../integration/ESP-AGENT-HANDOFF.md`](../integration/ESP-AGENT-HANDOFF.md).

Primary current contracts:

1. [`../integration/00-START-HERE.md`](../integration/00-START-HERE.md)
2. [`../integration/01-MOBILE-BACKEND-API-CONTRACT.md`](../integration/01-MOBILE-BACKEND-API-CONTRACT.md)
3. [`../integration/02-BACKEND-DEVICE-ADDITIVE-CONTRACT.md`](../integration/02-BACKEND-DEVICE-ADDITIVE-CONTRACT.md)
4. [`../integration/03-HARDWARE-IMPLEMENTATION-HANDOFF.md`](../integration/03-HARDWARE-IMPLEMENTATION-HANDOFF.md)
5. [`../integration/05-IMPLEMENTATION-STATUS.md`](../integration/05-IMPLEMENTATION-STATUS.md)
6. [`../integration/06-DECISION-REGISTER.md`](../integration/06-DECISION-REGISTER.md)
7. [`../integration/08-DOCS-MAINTENANCE-PROTOCOL.md`](../integration/08-DOCS-MAINTENANCE-PROTOCOL.md)
8. [`../integration/09-ENDPOINT-EVENT-COVERAGE-MATRIX.md`](../integration/09-ENDPOINT-EVENT-COVERAGE-MATRIX.md)

Do not read integration `04`, `07`, or `10` as current execution instructions;
they are completed historical operator records.

## Domain references

- [`04-component-ownership.md`](04-component-ownership.md) and
  [`05-source-of-truth-matrix.md`](05-source-of-truth-matrix.md) retain useful
  ownership boundaries.
- [`08-auth-device-pairing.md`](08-auth-device-pairing.md) describes the
  current code-only enrollment model.
- [`14-additive-hardware-events.md`](14-additive-hardware-events.md) records the
  exact current source event inventory and physical acceptance boundary.
- Other numbered P9 documents are frozen design/checkpoint records unless their
  banner explicitly says current. Their candidate ports, old migration counts,
  old route shapes, `READY_TO_IMPLEMENT` labels, and deployment assertions are
  historical only.

The existing physical voice authority remains
[`../hardware-contract/BMO-MVP-HW-INTERFACE-CONTRACT-v1.0.5.md`](../hardware-contract/BMO-MVP-HW-INTERFACE-CONTRACT-v1.0.5.md).

## Legacy verifier control text

> **HISTORICAL PREDECESSOR — NOT CURRENT STATUS**
> The following strings are retained only for the legacy P9.1 verifier. They
> describe the isolated-candidate checkpoint before production promotion.

```text
no P9.1 candidate is deployed to production
P9.2–P9.6 remain proposed and not implemented
```

They are superseded by the production status at the top of this page.
