# Memory Lifecycle and Privacy

> **CANONICAL MEMORY LIFECYCLE & PRIVACY SPECIFICATION**
> Current route/runtime status is in the canonical integration package (`docs/integration/05-IMPLEMENTATION-STATUS.md`).

**Status:** `PRODUCTION_VERIFIED` — deployed and active in production P9 runtime.

Chat history, memory, schedules, and provider conversations are separate domains with strict per-user PostgreSQL isolation.

```text
chat turn -> async post-turn extraction -> policy & forget check
          -> dedup check -> MemoryRecord (source: "conversation") & MemoryCandidate (status: "ACCEPTED")
          -> hybrid retrieval (search + top profile backfill) -> bounded chat context
```

### Privacy & Isolation Invariants
- **Stateless LLM Engine**: Hermes global disk memory (`/home/hermes/.hermes/memories/*`) is disabled (`memory_enabled: false`, `user_profile_enabled: false`). Hermes receives only ephemeral, bounded per-turn JSON context.
- **Strict User Scope**: Every `MemoryRecord`, `MemoryCandidate`, and `MemoryTopicForget` row belongs to exactly one `userId`. PostgreSQL queries enforce `userId = $1::uuid` and `deletedAt IS NULL`.
- **Automatic Post-Turn Extraction**: After assistant response generation and persistence, `#extractMemoriesAsync` identifies permanent facts/preferences, filters out trivial turns and forgotten topics, dedupes against active records, and persists accepted facts to `MemoryRecord` and `MemoryCandidate`.
- **Sensitive Data Exclusion**: Sensitive credentials, DOB, provider tokens, Wi-Fi passwords, and raw audio remain strictly ineligible for memory storage.
- **Forget & Deletion Guarantees**: `MemoryTopicForget` rows prevent matching topics from ever being extracted or resurfacing in chat context. Soft-deleted and expired memories are immediately excluded from retrieval.
