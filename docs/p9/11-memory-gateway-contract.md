# MemoryGateway Contract

> **CANONICAL DOMAIN DESIGN & IMPLEMENTATION SPECIFICATION**
> Current source and integration status win (`docs/integration/05-IMPLEMENTATION-STATUS.md`).

**Status:** `PRODUCTION_VERIFIED` — deployed and active in production P9 runtime.

The Backend depends on `PostgresMemoryGateway` for per-user bounded memory context:

```text
search(userId, query, limit)
listTopActiveMemories(userId, limit, excludeContents)
```

Every call requires explicit user scope, bounded input/output, stable ordering (`importance DESC, updatedAt DESC, id ASC`), and audit semantics. Relational ILIKE filters combined with top active memory backfill are used; pgvector/Mem0/Qdrant are not required.

### Hybrid Retrieval Mechanics
1. **Keyword Search**: Parses query tokens (>= 2 characters, up to 8 terms) and searches active `MemoryRecord` rows by topic and normalizedContent with forget-topic suppression.
2. **Top Profile Backfill**: When keyword search returns fewer than `limit` items (or when query has no specific keywords), queries top active memories for `userId` ordered by `importance DESC, updatedAt DESC`, excluding already matched contents.
3. **Identity Resolution**: `#buildContext` checks `user.displayName` and identity memories (topic `identity` / `name`), passing the resolved name in `context.user.displayName` or `null` if none exist.
4. **Hermes Statelessness**: Hermes daemon global memory (`USER.md`, `MEMORY.md`) is completely disabled (`memory_enabled: false`). All persistent memory is stored and managed exclusively in per-user PostgreSQL rows.
