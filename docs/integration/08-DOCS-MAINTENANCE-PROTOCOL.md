# Documentation Maintenance Protocol

**Effective:** 2026-08-11

**Current lifecycle note:** Code-only enrollment is deployed from `main` commit
`d1473d04f4b76ccb52cc8eeaff52a268504310f0` as
`bmo-p9.1:pairing-code-only-d1473d0`. Migration
`20260818110000_pairing_code_only_enrollment` is applied in production; state
is `7 completed, 0 unfinished, 0 rolled_back`. Health, Mobile REST/WS smoke,
and the six-sample soak passed. Physical firmware acceptance remains
`PENDING_PHYSICAL_ESP`. Promotion instructions in historical documents must
not be treated as current work.

## 1. Authority order

1. Registered code, Prisma migration history, and inspected runtime are evidence of the current state.
2. The hardware contract v1.0.5 owns the existing physical voice protocol.
3. `docs/integration/00-START-HERE.md`, the current integration PRD, decision register, matrix, and status file own the approved target.
4. P9 docs describe domain ownership and conceptual schema, subordinate to the frozen integration decisions.
5. Historical evidence, archived reports, and locked snapshots describe their original moment only; never rewrite them to look current.

When evidence conflicts with current prose, correct current prose and record the distinction. Never alter history to remove the conflict.

## 2. Required status vocabulary

Current integration documents use:

```text
PRODUCTION_VERIFIED
IMPLEMENTED
PARTIALLY_IMPLEMENTED
NOT_IMPLEMENTED
OUT_OF_SCOPE
BLOCKED
PENDING_PHYSICAL_ESP
```

`DEFERRED` belongs only to the historical freeze vocabulary retained in old
decision records. It is not a current status for the Mobile integration
package; use `OUT_OF_SCOPE`, `BLOCKED`, or an explicitly named implementation
gap instead.

`PRODUCTION_VERIFIED` must name the production/runtime evidence boundary when
it matters; `IMPLEMENTED` must name source/test evidence when production is not
claimed. Do not infer public availability from source existence. Do not use
`implemented`, `done`, or `live` as a standalone status.

## 3. Same-change synchronization

Any source change that changes a Mobile route or Mobile WebSocket event must
update all three of these in the same source change:

- `01-MOBILE-BACKEND-API-CONTRACT.md`;
- `05-IMPLEMENTATION-STATUS.md`;
- `09-ENDPOINT-EVENT-COVERAGE-MATRIX.md`;

The route/event source registration and relevant tests remain the validation
authority. Other implementation commits that change a model, owner, exposure,
or acceptance state must also update the relevant P9 architecture/schema/test
document, `06-DECISION-REGISTER.md` when a frozen decision changes, and
`docs/NEXT-ACTION.md` when the next executable boundary changes.
- the relevant P9 architecture/schema/security/test document;
- `06-DECISION-REGISTER.md` when a frozen decision changes;
- `docs/NEXT-ACTION.md` when the next executable boundary changes.

Documentation-only corrections must say why observed code/runtime differs. Feature code is forbidden in a documentation-freeze commit.

## 4. Endpoint/event rules

- The matrix lists a method/path or event direction, exact status, availability tier, owner, and evidence/gate.
- Aliases are not canonical routes unless registered in source.
- Device and mobile WebSockets have separate tables.
- Every additive device event stays `PENDING_PHYSICAL_ESP` until firmware code plus physical acceptance exists.
- Provider capability is not BMO integration evidence; credentials/session/callback and an acceptance result must be named.

## 5. Schema rules

- `schema.prisma` plus applied migration records describe existing storage.
- Conceptual requirements use “target” and must not claim a table exists.
- Prefer additive tables/nullable columns, explicit unique/index constraints, encrypted secret fields, bounded retention, and idempotency keys.
- Never mark a production migration applied based on a migration file or candidate database alone.

## 6. Secrets and runtime evidence

- Record variable names, owners, listeners, digests, versions, and sanitized results only.
- Never copy token/password/database URL values into docs or terminal output.
- Public/private claims require binding plus proxy/firewall evidence. If a layer cannot be inspected, record the uncertainty as a gate.

## 7. Final drift loop

Before a docs or implementation milestone is complete:

1. enumerate registered REST routes;
2. compare Prisma schema and migration history;
3. compare the device `/ws` event/auth contract;
4. verify owner/source-of-truth tables;
5. inspect public/private endpoint claims;
6. compare all integration docs to one another;
7. search stale status vocabulary and contradictory current claims;
8. correct them;
9. repeat until no known contradiction remains;
10. run repository documentation verification and a docs-only Git diff check.

## 8. Promotion evidence

Current status changes must use the vocabulary in §2 and name the evidence
that justifies the change. Historical records may contain the superseded
labels `EXISTING_VERIFIED`, `READY_TO_IMPLEMENT`, or `DEFERRED`; do not copy
those labels into current Mobile status tables. `PENDING_PHYSICAL_ESP` may
change only after firmware commit/build evidence and real-device acceptance,
not a fake client. `BLOCKED` may change only when the external/provider or
operator gate is explicitly cleared.
