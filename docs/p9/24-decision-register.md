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
| Mobile API is versioned Backend-only | PROPOSED | stable clients and ownership enforcement | direct service calls | API mapping required per screen | SW/mobile | P9.1+ |
| Provider OAuth flow/scopes | OPEN | policies and client constraints can change | server code, PKCE | exact choice gates P9.4 | SW/security | P9.4 |
| Default chat/memory retention values | OPEN | user/privacy policy not fully specified | indefinite, timed, user-selected | blocks final deletion policy | privacy owner | P9.2/P9.6 |
