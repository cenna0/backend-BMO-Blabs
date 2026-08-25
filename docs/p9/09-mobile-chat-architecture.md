# Mobile Chat and Realtime Architecture

> **CANONICAL CHAT ARCHITECTURE SPECIFICATION**
> Current production and Mobile contract authority is integration `01`, `05`, and `09`.

**Status:** `PRODUCTION_VERIFIED` — deployed and active in production P9 runtime.

- REST owns durable commands/history. `POST /chat/sessions/:sessionId/messages` returns 202 after an idempotent accepted write.
- Mobile WSS `/api/v1/ws` authenticates independently and emits completion/status events (`chat_thinking`, `chat_message`); it is not device `/ws` and carries no audio or token-by-token LLM stream.
- Backend persists the user message, obtains bounded curated memory via `PostgresMemoryGateway` hybrid search, calls Hermes `/v1/responses`, persists assistant text, emits `chat_message`, and triggers asynchronous post-turn memory extraction.
- Stable cursor pagination and `(user, idempotency key)` deduplication make reconnect/retry safe.
- Temporary sessions have explicit retention/deletion behavior and never silently seed long-term memory.
- Voice transcripts may enter history only after a physical device is bound to an owner; raw WAV and MP3 remain temporary.

### Durable Worker & Lease Orchestration
Slice 5A implements the six frozen REST routes with bearer-derived ownership,
strict bodies, a per-user transactional advisory lock, and the existing
`(userId, idempotencyKey)` constraints. A first request persists its user
message and `PROCESSING` operation before HTTP 202; same-input retries return
that operation, while reuse for different text/session/device is a conflict.
The worker scheduler is bounded globally, serializes each user/session key in
message order without blocking unrelated session keys, and reserves capacity
before durable acceptance.

Before reading context or invoking Hermes, every worker atomically claims the
durable operation with a short-lived `LEASE:<uuid>` marker stored in the
existing `errorCode` field. The PostgreSQL claim uses `clock_timestamp()` and
succeeds only when no lower-cursor `PROCESSING` operation exists for that
user/session. This gives the server-owned Hermes conversation durable ordering
across Backend processes while unrelated sessions remain concurrent. A worker
renews its exact lease with the DB clock after context assembly and immediately
before Hermes; a failed renewal stops without provider work. Completion and
failure transitions also require the exact lease.

### Identity Resolution & Context Assembly
Backend builds a bounded JSON context containing:
1. `user`: Dynamic identity resolution checks `user.displayName`; if null, checks active identity memories (topic `name` / `identity`), passing the resolved name in `displayName` or `null` if none exist.
2. `personalization`: The seven canonical personalization fields.
3. `memory`: Hybrid memory context from `PostgresMemoryGateway` (exact keyword search + top active profile memories backfill up to 8 items).
4. `history`: Twelve recent messages capped at 4,000 characters each.

### Provider Call & Memory Extraction
Hermes is an internal stateless generation engine (`memory_enabled: false` on daemon). Hermes calls are isolated with server-owned conversation IDs (`chat:<userId>:<sessionId>`) and session keys (`X-Hermes-Session-Key: bmo:user:<userId>`).

After assistant message persistence and realtime emission:
- `#extractMemoriesAsync` executes asynchronously in the background.
- Identifies factual statements/preferences from non-trivial user turns.
- Checks against `MemoryTopicForget`, dedupes against active records, and persists accepted facts to `MemoryRecord` (`source: "conversation"`) and `MemoryCandidate` (`status: "ACCEPTED"`).
