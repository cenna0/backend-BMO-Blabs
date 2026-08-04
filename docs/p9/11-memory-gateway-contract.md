# MemoryGateway Contract

**Status:** `LOCKED + PROPOSED`

Hermes and mobile use this boundary through Backend services. They never call
Mem0, Prisma, PostgreSQL, Qdrant, or an Obsidian API directly.

## TypeScript contract sketch

```ts
type MemoryType =
  | "FACT" | "PREFERENCE" | "INSTRUCTION" | "PROJECT"
  | "GOAL" | "DEADLINE" | "RELATIONSHIP" | "EPISODIC_SUMMARY";

type MemoryQuery = {
  userId: string;
  text?: string;
  types?: MemoryType[];
  topics?: string[];
  minImportance?: number;
  includeExpired?: boolean;
  limit: number;
  cursor?: string;
};

type MemoryRecord = {
  id: string;
  userId: string;
  type: MemoryType;
  topic: string;
  content: string;
  importance: number;
  sourceMessageId?: string;
  expiresAt?: string;
  createdAt: string;
  updatedAt: string;
};

interface MemoryGateway {
  search(query: MemoryQuery): Promise<{ items: MemoryRecord[]; nextCursor?: string }>;
  create(input: CreateMemoryInput): Promise<MemoryRecord>;
  update(id: string, input: UpdateMemoryInput): Promise<MemoryRecord>;
  delete(id: string, actor: MemoryActor): Promise<void>;
  forgetTopic(userId: string, topic: string, actor: MemoryActor): Promise<void>;
  clearAll(userId: string, actor: MemoryActor): Promise<void>;
  export(userId: string): Promise<MemoryExport>;
}
```

`PostgresMemoryGateway` is the initial implementation. It performs structured
filters and PostgreSQL full-text search inside Backend transactions, applies
forget-topic and expiry filters before ranking, and writes `MemoryAction`
records for mutations.

## Adapter rules

- The interface accepts domain types, not Prisma types or provider SDK types.
- The interface is user-scoped and rejects missing/foreign ownership.
- Search output is bounded, deterministic, and redacted according to policy.
- A future Mem0 adapter may be evaluated behind this interface but is not
  installed, run, or required by P9 foundation.
- A future vector adapter can extend search after pgvector evaluation; no
  caller may require vectors in the initial contract.
