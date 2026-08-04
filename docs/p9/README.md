# BMO P9 — Final Architecture and Product Lock

**Status:** `P9.1 ARCHITECTURE LOCKED; ISOLATED P9.1 CANDIDATE READY FOR REVIEW; P9.2–P9.6 PROPOSED`
**Architecture branch:** `docs/p9-final-architecture`
**Base main:** `159ce6d9081928eca6d68921c3f64cdb36fce5bb`
**Date:** 2026-08-04

This directory is the P9 application-platform architecture set. P9.1 has been
approved and its authentication, timezone, pairing, database, settings,
migration, backup, and audit decisions are locked. P9.2–P9.6 remain proposed
execution stages and are not implemented. The isolated P9.1 implementation
evidence is recorded in [`P9.1-IMPLEMENTATION-EVIDENCE.md`](P9.1-IMPLEMENTATION-EVIDENCE.md);
no P9.1 candidate is deployed to production.

## Status vocabulary

- **LOCKED** — supplied by the product direction or a previous verified
  contract; implementation must preserve it.
- **PROPOSED** — architecture selected for review and later implementation.
- **OPEN** — an explicit decision still required before the affected phase.
- **DEFERRED** — intentionally excluded from the current phase or foundation.
- **IMPLEMENTED / VERIFIED** — used only by implementation evidence; the
  architecture documents remain the source of locked decisions.

## Reading order

0. [`00-repository-audit.md`](00-repository-audit.md)
1. [`01-product-scope.md`](01-product-scope.md)
2. [`02-phased-execution-plan.md`](02-phased-execution-plan.md)
3. [`03-system-architecture.md`](03-system-architecture.md)
4. [`04-component-ownership.md`](04-component-ownership.md)
5. [`05-source-of-truth-matrix.md`](05-source-of-truth-matrix.md)
6. [`06-preliminary-prisma-schema.md`](06-preliminary-prisma-schema.md)
7. [`07-entity-relationships.md`](07-entity-relationships.md)
8. [`08-auth-device-pairing.md`](08-auth-device-pairing.md)
9. [`09-mobile-chat-architecture.md`](09-mobile-chat-architecture.md)
10. [`10-memory-lifecycle-privacy.md`](10-memory-lifecycle-privacy.md)
11. [`11-memory-gateway-contract.md`](11-memory-gateway-contract.md)
12. [`12-chat-retention-deletion.md`](12-chat-retention-deletion.md)
13. [`13-scheduler-proactive-speech.md`](13-scheduler-proactive-speech.md)
14. [`14-additive-hardware-events.md`](14-additive-hardware-events.md)
15. [`15-voice-settings.md`](15-voice-settings.md)
16. [`16-spotify-integration.md`](16-spotify-integration.md)
17. [`17-whatsapp-integration.md`](17-whatsapp-integration.md)
18. [`18-action-intent-schema.md`](18-action-intent-schema.md)
19. [`19-security-encryption.md`](19-security-encryption.md)
20. [`20-backup-restore-migration.md`](20-backup-restore-migration.md)
21. [`21-resource-budget.md`](21-resource-budget.md)
22. [`22-rollout-canary-rollback.md`](22-rollout-canary-rollback.md)
23. [`23-test-acceptance-matrix.md`](23-test-acceptance-matrix.md)
24. [`24-decision-register.md`](24-decision-register.md)
25. [`25-unresolved-decisions.md`](25-unresolved-decisions.md)

The immutable public firmware/backend source of truth remains
[`../hardware-contract/BMO-MVP-HW-INTERFACE-CONTRACT-v1.0.5.md`](../hardware-contract/BMO-MVP-HW-INTERFACE-CONTRACT-v1.0.5.md).
P9 proposals may add a future contract version, but they do not edit v1.0.5.
