# BMO P9 — Final Architecture and Product Lock

**Status:** `P9.1 ARCHITECTURE LOCKED; IMPLEMENTATION MERGED; PRODUCTION READINESS IN PROGRESS; P9.2–P9.6 PROPOSED`
**Architecture branch:** `docs/p9-final-architecture`
**Base main:** `159ce6d9081928eca6d68921c3f64cdb36fce5bb`
**Date:** 2026-08-04

This directory is the P9 application-platform architecture set. P9.1 has been
implemented, independently reviewed, and merged into main, but it is not
deployed. Production PostgreSQL is not installed and no production migration
has run. Its authentication, timezone, pairing, database, settings, migration,
backup, and audit decisions are locked. P9.2–P9.6 remain proposed execution
stages and are not implemented. The historical P9.1 implementation and review
evidence are recorded in [`P9.1-IMPLEMENTATION-EVIDENCE.md`](P9.1-IMPLEMENTATION-EVIDENCE.md)
and [`P9.1-FOUNDATION-REVIEW.md`](P9.1-FOUNDATION-REVIEW.md); the readiness
package is [`P9.1-PRODUCTION-READINESS.md`](P9.1-PRODUCTION-READINESS.md).

## Start here for P9.1 production operations

These documents are the operator handoff. They describe approved future
procedures; they do not mean secrets are provisioned, PostgreSQL is active, or
P9.1 is deployed.

1. [`P9.1-PRODUCTION-READINESS.md`](P9.1-PRODUCTION-READINESS.md) — readiness
   state and remaining gates.
2. [`P9.1-PRODUCTION-SECRETS-OPERATOR-GUIDE.md`](P9.1-PRODUCTION-SECRETS-OPERATOR-GUIDE.md)
   — plain-language provisioning, validation, rotation, recovery, and
   emergency checklists.
3. [`P9.1-PRODUCTION-SECRET-MATRIX.md`](P9.1-PRODUCTION-SECRET-MATRIX.md) —
   ownership, file, mount, and service-isolation source of truth.
4. [`P9.1-BACKUP-MONITORING-AND-RESTORE.md`](P9.1-BACKUP-MONITORING-AND-RESTORE.md)
   — local backup, manual PC pull, monitoring, and restore policy.
5. [`P9.1-PRODUCTION-MIGRATION-PLAN.md`](P9.1-PRODUCTION-MIGRATION-PLAN.md) —
   private initialization and migration sequence.
6. [`P9.1-PRODUCTION-CANARY-PLAN.md`](P9.1-PRODUCTION-CANARY-PLAN.md) — future
   staged canary topology.
7. [`P9.1-PRODUCTION-ROLLBACK-RUNBOOK.md`](P9.1-PRODUCTION-ROLLBACK-RUNBOOK.md)
   — rollback and failure matrix.
8. [`P9.1-PRODUCTION-OBSERVABILITY.md`](P9.1-PRODUCTION-OBSERVABILITY.md) —
   private operational signals.
9. [`P9.1-PRODUCTION-ACCEPTANCE-MATRIX.md`](P9.1-PRODUCTION-ACCEPTANCE-MATRIX.md)
   — command-level future acceptance gates.

The deep secret reference is [`P9.1-PRODUCTION-SECRET-AND-KEY-MANAGEMENT.md`](P9.1-PRODUCTION-SECRET-AND-KEY-MANAGEMENT.md),
and individual compromise procedures are in
[`P9.1-PRODUCTION-SECRET-INCIDENT-RUNBOOKS.md`](P9.1-PRODUCTION-SECRET-INCIDENT-RUNBOOKS.md).

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
