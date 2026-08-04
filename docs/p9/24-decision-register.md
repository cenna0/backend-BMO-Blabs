# P9 Decision Register

**Status:** `LOCKED + PROPOSED + OPEN`
**Decision date:** 2026-08-04

| Decision | Status | Rationale | Alternatives | Consequence | Owner | Phase |
|---|---|---|---|---|---|---|
| PostgreSQL is application source of truth | LOCKED | durable relational ownership, audit, backup | Hermes store, document DB | DB is required for P9.1+ | SW/operations | P9.1 |
| Prisma is data access/migration layer | LOCKED | typed schema and repeatable migrations | raw SQL only, another ORM | Prisma version/policy must be pinned | SW | P9.1 |
| Initial gateway is `PostgresMemoryGateway` | LOCKED | keeps memory in application DB and boundary-testable | direct Hermes memory, Mem0 first | Backend owns memory semantics | SW | P9.2 |
| Mem0 is deferred | LOCKED | no foundation dependency before evaluation | install now | future adapter only | SW | post-P9.2 |
| Qdrant is rejected at current scale | LOCKED | unnecessary service/resource burden for initial FTS retrieval | Qdrant now | PostgreSQL FTS is initial search | SW/operations | P9.2 |
| pgvector is staged, not required | LOCKED | preserves future option without embedding every message | mandatory vectors, no vector path | additive extension/index later | SW/operations | P9.2/P9.6 |
| Obsidian is export-only | LOCKED | Markdown is useful for portability, not authoritative | VPS Obsidian, bidirectional sync | import stays disabled until conflict handling | SW/privacy owner | P9.2 |
| All valid text is chat history | LOCKED | preserves user-visible record | selective history | deletion/retention must scale | SW/mobile | P9.2 |
| Voice transcripts are chat history | LOCKED | transcript is durable text, audio is not | no voice history | associate user/device carefully | SW/HW | P9.2 |
| Chat history is not automatic memory | LOCKED | avoids silent profiling | all chat becomes memory | explicit candidate policy required | privacy owner | P9.2 |
| Long-term memory is curated | LOCKED | safety and user control | automatic unrestricted memory | candidate/review lifecycle | privacy owner | P9.2 |
| Scheduler is separate from memory | LOCKED | schedules are structured actions/time records | schedule as memory | independent retention/audit | SW | P9.3 |
| pg-boss-style PostgreSQL worker is evaluated | PROPOSED | keeps job state near relational source of truth | custom loop, external queue | library choice gated by load/reliability | SW/operations | P9.3 |
| Scheduled audio uses additive events | LOCKED | request-bound lifecycle has different semantics | reuse `audio_ready` | future firmware version review | SW + HW | P9.3 |
| v1.0.5 is immutable | LOCKED | protects existing firmware | edit existing contract | vNext must be additive | SW + HW | all |
| Initial selectable voice is Piper Prudence | LOCKED | P8 operator-approved production voice | multiple voices | catalog may be future-facing | SW/audio | P9.1 |
| Kokoro is internal fallback | LOCKED | verified recovery path | remove fallback | preserve current resilience | audio | all |
| No custom voice upload/cloning/RVC | LOCKED | safety, resource, provenance boundary | user checkpoints, RVC | no user model pipeline | SW/audio | all |
| Backend owns Spotify actions/tokens | LOCKED | protects credentials and policy | Hermes direct, mobile direct | adapter/audit required | SW | P9.4 |
| Backend owns WhatsApp policy/send confirmation | LOCKED | prevents silent outbound sends | Hermes direct send | session remains Hermes-owned | SW | P9.5 |
| WhatsApp ordinary content is not memory | LOCKED | privacy/minimization | ingest all messages | explicit user workflow only | privacy owner | P9.5 |
| Single VPS is initial target | LOCKED | matches verified deployment and cost | split services/HA | strict resource budget | operations | P9.6 |
| No production implementation in architecture task | LOCKED | protects P8 and scope | implement while documenting | follow-up prompts are required | release owner | all |
| Registration is invite-only | LOCKED | limits initial account creation | public registration | invitation lifecycle is required | SW/security | P9.1 |
| Email/password login with Argon2id | LOCKED | simple provider-independent foundation | social login, external IdP now | password policy and reset remain bounded | SW/security | P9.1 |
| Short-lived access token target | LOCKED | limits bearer exposure | long-lived access | approximately 15 minutes; exact implementation evidence required | SW/security | P9.1 |
| Opaque rotating refresh token | LOCKED | supports revocation and replay handling | stateless long-lived JWT | only refresh-token hashes persist | SW/security | P9.1 |
| Per-device session revocation | LOCKED | limits lost-device exposure | global logout only | session/device binding and audit required | SW/security | P9.1 |
| No social login in P9.1 | LOCKED | keeps foundation provider-neutral | Google or other IdP now | external providers remain future work | SW/security | P9.1 |
| Canonical timezone is `Asia/Jakarta` | LOCKED | fixes initial product interpretation | user-selectable zones, `WIB`, raw offset | server-enforced; timestamps remain UTC-compatible `timestamptz` | SW | P9.1 |
| Six-digit pairing code | LOCKED | usable device bootstrap with bounded risk | long-lived token, contract change | ten-minute TTL, single use, rate limits, replay protection | SW + HW | P9.1 |
| Private pinned-major PostgreSQL topology | LOCKED | protects single-VPS deployment | public DB, multiple majors | persistent external data, no public port | operations | P9.1 |
| P9.1 initial DB targets | LOCKED target / OPEN final cap | gives testing baseline without overclaiming capacity | unbounded resources | 768 MiB, Prisma pool 5, approximately 20 connections | operations | P9.1/P9.6 |
| P9.1 persisted settings | LOCKED | keeps user/device ownership explicit | Hermes/local-only settings | exact fields are defined in schema and settings boundary | SW/mobile | P9.1 |
| Migration discipline | LOCKED | protects data and controlled rollout | startup migration, `db push`, reset | dev/deploy split, expand/contract, forward fix/restore | SW/operations | P9.1 |
| P9.1 backup baseline | LOCKED | recoverability before activation | unverified local backup | scheduled `pg_dump`, checksum, encryption, seven daily, four weekly, isolated restore | operations | P9.1 |
| Off-VPS backup destination | OPEN | final disaster-recovery boundary remains unselected | provider/location choices | required before final production sign-off | operations | P9.6 |
| Production email delivery/password reset | OPEN | delivery and recovery need operational policy | local-only, provider service | not silently included in P9.1 | product/security | P9.1/P9.6 |
| Final mobile pairing copy/visual design | OPEN | implementation UX is not specified by protocol | ad hoc device UI | mechanics remain locked; presentation requires review | product/mobile | P9.1 |
| Mobile API is versioned Backend-only | PROPOSED | stable clients and ownership enforcement | direct service calls | API mapping required per screen | SW/mobile | P9.1+ |
| Provider OAuth flow/scopes | OPEN | policies and client constraints can change | server code, PKCE | exact choice gates P9.4 | SW/security | P9.4 |
| Default chat/memory retention values | OPEN | user/privacy policy not fully specified | indefinite, timed, user-selected | blocks final deletion policy | privacy owner | P9.2/P9.6 |
