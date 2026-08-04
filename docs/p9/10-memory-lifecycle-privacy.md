# Memory Lifecycle and Privacy Policy

**Status:** `LOCKED + PROPOSED`

## Memory classes

Allowed long-term memory candidates include explicit stable facts,
preferences, repeated instructions, user corrections, projects, goals,
expiring deadlines, relationship/context facts, and important episodic
summaries.

The system does not automatically store small talk, one-time questions,
temporary search results, uncertain AI inference, ordinary WhatsApp content,
credentials, OTPs, tokens, financial secrets, precise sensitive locations, or
other unsafe sensitive content.

## Lifecycle

```text
ChatMessage
  → candidate extraction with source and risk classification
  → pending review or approved automatic-candidate policy
  → MemoryRecord active
  → user edit / expiry / delete / forget-topic / clear-all
  → tombstone or audited deletion
```

Chat remains history even when a memory candidate is rejected. A memory record
must retain provenance sufficient to explain and remove it, but the user-facing
content is minimized.

## Retrieval order

Initial `PostgresMemoryGateway` retrieval applies:

1. user/tenant and active-status filter;
2. topic/type filters;
3. sensitivity and expiry policy;
4. importance score;
5. recency;
6. PostgreSQL full-text search rank;
7. deterministic limit and tie-break by ID.

Embeddings are optional staged infrastructure. No request depends on an
embedding being present, and no Qdrant service is introduced.

## User controls

Backend must expose and audit:

- list/search/view memories;
- edit a memory;
- delete a memory;
- accept or reject a candidate;
- forget a topic;
- disable automatic candidates;
- clear all memories;
- export memory data.

## Privacy rules

- Do not log raw memory content, raw transcripts, tokens, or provider payloads
  by default; use correlation IDs and safe metadata.
- Never place secrets in memory, candidate prompts, exports, or Markdown files.
- Treat memory retrieval as user-scoped data access, not a free-form Hermes
  capability.
- Memory exports are derived, user-requested snapshots. Obsidian-compatible
  Markdown export is optional; import is disabled until validation and
  conflict handling exist.
