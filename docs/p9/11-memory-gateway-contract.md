# MemoryGateway Contract

**Status:** `READY_TO_IMPLEMENT`; no memory runtime exists at freeze.

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
