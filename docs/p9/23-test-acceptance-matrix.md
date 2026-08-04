# P9 Test and Acceptance Matrix

**Status:** `PROPOSED`

| Area | Required proof | Acceptance owner |
|---|---|---|
| Repository/docs | verifier, links/path scan, status labels, `git diff --check`, no secrets | SW/Codex |
| Contract preservation | v1.0.5 hash/content unchanged; existing voice routes/events unchanged | SW + HW |
| Auth | provider assertion, session expiry/revoke, ownership isolation, rate limits | SW |
| Pairing | single-use challenge, replay/expiry, wrong-owner rejection, credential rotation | SW + HW |
| Settings/voice | Prudence-only catalog, safe speed/volume/length validation, preview/reset | SW |
| Chat | text/voice transcript persistence, order/cursors, idempotent retry, safe errors | SW/mobile |
| Retention | chat delete, memory delete, forget topic, clear all, export, audit | SW/privacy owner |
| MemoryGateway | structured filters, importance/recency/FTS, expiry, tenant isolation, adapter contract | SW |
| Scheduler | timezone/DST, recurrence, due-claim idempotency, retries, missed-run policy | SW |
| Proactive delivery | dedicated events, TTL, acknowledgement, offline target, no v1.0.5 regression | SW + HW |
| Spotify | OAuth state, token encryption/refresh, no-device result, action confirmation | SW |
| WhatsApp | QR/session recovery, rules, confirmation replay, no-memory-ingestion | SW |
| Security | TLS, secret scans, authz matrix, log redaction, key rotation, dependency audit | security owner |
| Database | migration from empty, repeat, restart persistence, backup/restore, private port | SW/operations |
| Resource | single-VPS mixed load, reserve, OOM/restart/backlog/latency evidence | operations |
| Rollout | canary, flag disable, app rollback, data-safe recovery | release owner |

## Acceptance classification

- **PASS:** command/evidence directly proves the gate.
- **DEFERRED:** intentionally excluded and documented with owner/phase.
- **BLOCKED:** required proof failed or an unresolved safety decision prevents
  activation.

Passing unit tests alone cannot classify P9 ready. The final report must map
each locked decision and each mobile screen/API/data owner to evidence or an
explicit future gate.
