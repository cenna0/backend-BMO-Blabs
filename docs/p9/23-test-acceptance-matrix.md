# Test and Acceptance Matrix — Frozen

| Area | Phase 1 evidence | Phase 2 acceptance |
|---|---|---|
| Backend tests | Node 22.23.1: 200 passed, 1 skipped DB HTTP suite; Slice 2A focused schema/repository run 18 passed | Unit + authenticated HTTP integration with disposable Postgres |
| Build/typecheck | Passed on Node 22.23.1 | Repeat on pinned build/runtime |
| Prisma | Validate/generate passed; exact 38-model list, every new table's scalar SQL types, embedded destructive/data-rewrite SQL rejection, nullable check guards, provider-subtype integrity, repository delegates, and readiness manifest matching all three source migrations are statically verified. Disposable PostgreSQL passed an empty three-migration deploy, repeat deploy with no pending migration, and populated two-to-three upgrade preserving seeded rows in all 11 P9.1 models. Explicit relation maps correct the 14 constraint-name-only introspection proposals without database renames. | Constraint and backup/restore acceptance at an authorized candidate gate; no startup migration. Slice 2A remains unapplied to the running `bmo` candidate. |
| Audio | 103 passed in production audio image | Existing suite + voice regression |
| Existing device voice | Production contract/runtime inspected | Public fake-device regression plus no raw-WAV/MP3/event drift |
| Auth/recovery | P9.1 auth source/private candidate exists; nullable DOB and verifier-only recovery storage exist in unapplied source schema; `SafeUser` remains DOB-free | Self-service, Argon2id, rotation/replay, DOB enumeration/rate/reuse, logout-all, tenant isolation |
| Pairing/identity | Six-digit source/tests/private DB state; Slice 1 exact hash binding, ACTIVE cache revalidation, and transaction-locked owned session-device binding source tests | TTL/attempt/replay/owner tests remain regression gates; physical result remains separate |
| Chat/mobile WSS | Durable source schema exists; runtime absent | 202/idempotency, cursor order, reconnect/replay, auth expiry, no audio/token stream |
| Memory | Durable source schema exists; runtime absent | gateway contract, candidate/privacy, delete/forget/clear/export, tenant isolation |
| Scheduler/delivery | Durable source schema exists; worker/runtime absent | recurrence/timezone, unique due claim, retry/missed/offline/expiry, delivery idempotency |
| Device additions | Wi-Fi/current telemetry/log/settings-delivery source schema exists; runtime/firmware absent | Backend parser/state tests, then real ESP evidence for any physical promotion |
| Spotify | OAuth/credential/action source schema exists; adapter absent | state/callback, encryption/refresh, scope, confirmation, normalized errors; live credential gate |
| WhatsApp | Hermes capability plus BMO metadata source schema only | Exact local API/session recovery, rules, confirmation replay, no auto-memory; live session gate |
| Security | Port-5555 listener closed; firewall visibility remains operator-gated; one-hop Caddy proxy trust tested through real Express routing; candidate DB has no published port | Authz matrix, secret/log scans, dependency/image checks, privileged firewall evidence |
| Public/private | Caddy/runtime inspected | Only intended routes public; DB/Hermes/Audio/internal ops private |
| Documentation | Baseline verifier passed | Verifier, links, vocabulary, route/schema/WS drift loop, docs-only/secret diff |

Acceptance must state the tier: source, private candidate, loopback production, public production, or physical. Unit tests do not prove public or physical acceptance.
