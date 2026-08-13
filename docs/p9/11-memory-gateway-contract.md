# MemoryGateway Contract

**Status:** `EXISTING_VERIFIED` at source/test tier; no candidate/public deployment.

The Backend depends on an interface, initially `PostgresMemoryGateway`, for:

```text
search(userId, query, filters, limit)
createCandidate(userId, sourceMessageId, proposedMemory)
acceptCandidate(userId, candidateId)
rejectCandidate(userId, candidateId)
update(userId, memoryId, patch)
delete(userId, memoryId)
forgetTopic(userId, topic)
clearAll(userId)
export(userId)
```

Every call requires explicit user scope, bounded input/output, stable ordering, and audit semantics. Initial retrieval uses relational filters/full-text search; pgvector/Mem0/Qdrant are not required. An adapter may change later without changing mobile APIs or making Hermes the data owner.

The initial source implementation uses owner-scoped Prisma/PostgreSQL lifecycle
operations plus `PostgresMemoryGateway` retrieval. Chat requests at most eight
active, unexpired records in stable importance/update/ID order and safely
receives an empty list when none match. Chat does not call candidate creation.
