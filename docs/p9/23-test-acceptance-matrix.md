# Test and Acceptance Matrix — Frozen

| Area | Phase 1 evidence | Phase 2 acceptance |
|---|---|---|
| Backend tests | Node 22.23.1: 188 passed, 1 skipped DB HTTP suite | Unit + authenticated HTTP integration with disposable Postgres |
| Build/typecheck | Passed on Node 22.23.1 | Repeat on pinned build/runtime |
| Prisma | Validate passed; readiness manifest exactly matches both source migrations and requires each to be finished | Empty/repeat/upgrade migration, constraints, backup/restore, no startup migration |
| Audio | 103 passed in production audio image | Existing suite + voice regression |
| Existing device voice | Production contract/runtime inspected | Public fake-device regression plus no raw-WAV/MP3/event drift |
| Auth/recovery | P9.1 auth source/private candidate exists | Self-service, Argon2id, rotation/replay, DOB enumeration/rate/reuse, logout-all, tenant isolation |
| Pairing/identity | Six-digit source/tests/private DB state; Slice 1 exact hash binding, ACTIVE cache revalidation, and transaction-locked owned session-device binding source tests | TTL/attempt/replay/owner tests remain regression gates; physical result remains separate |
| Chat/mobile WSS | Absent | 202/idempotency, cursor order, reconnect/replay, auth expiry, no audio/token stream |
| Memory | Absent | gateway contract, candidate/privacy, delete/forget/clear/export, tenant isolation |
| Scheduler/delivery | Absent | recurrence/timezone, unique due claim, retry/missed/offline/expiry, delivery idempotency |
| Device additions | Absent | Backend schema/parser/state tests, then real ESP evidence for any physical promotion |
| Spotify | Provider docs checked; BMO adapter absent | state/callback, encryption/refresh, scope, confirmation, normalized errors; live credential gate |
| WhatsApp | Hermes capability only | Exact local API/session recovery, rules, confirmation replay, no auto-memory; live session gate |
| Security | Port-5555 listener closed; firewall visibility remains operator-gated; one-hop Caddy proxy trust tested through real Express routing; candidate DB has no published port | Authz matrix, secret/log scans, dependency/image checks, privileged firewall evidence |
| Public/private | Caddy/runtime inspected | Only intended routes public; DB/Hermes/Audio/internal ops private |
| Documentation | Baseline verifier passed | Verifier, links, vocabulary, route/schema/WS drift loop, docs-only/secret diff |

Acceptance must state the tier: source, private candidate, loopback production, public production, or physical. Unit tests do not prove public or physical acceptance.
