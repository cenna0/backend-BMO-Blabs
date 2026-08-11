# Documentation Maintenance Protocol

**Effective:** 2026-08-11

## 1. Authority order

1. Registered code, Prisma migration history, and inspected runtime are evidence of the current state.
2. The hardware contract v1.0.5 owns the existing physical voice protocol.
3. `docs/integration/00-START-HERE.md`, the current integration PRD, decision register, matrix, and status file own the approved target.
4. P9 docs describe domain ownership and conceptual schema, subordinate to the frozen integration decisions.
5. Historical evidence, archived reports, and locked snapshots describe their original moment only; never rewrite them to look current.

When evidence conflicts with current prose, correct current prose and record the distinction. Never alter history to remove the conflict.

## 2. Required status vocabulary

Use only:

```text
EXISTING_VERIFIED
READY_TO_IMPLEMENT
PENDING_PHYSICAL_ESP
BLOCKED
DEFERRED
```

`EXISTING_VERIFIED` must name its tier: source, private candidate, loopback production, public production, or physical. Do not infer public availability from source existence. Do not use `implemented`, `done`, or `live` as a standalone status.

## 3. Same-change synchronization

Any implementation commit that changes an endpoint, event, model, owner, exposure, or acceptance state must update at least:

- `05-IMPLEMENTATION-STATUS.md`;
- `09-ENDPOINT-EVENT-COVERAGE-MATRIX.md`;
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

- `READY_TO_IMPLEMENT` -> `EXISTING_VERIFIED`: code plus relevant test/runtime evidence and an explicit tier.
- `PENDING_PHYSICAL_ESP` -> `EXISTING_VERIFIED`: firmware commit/build and real-device acceptance, not a fake client.
- `BLOCKED` -> another state: name the evidence that removed the blocker.
- `DEFERRED` -> active: record an approved scope/priority decision first.
