# Mobile Chat and Realtime Architecture

**Status:** `EXISTING_VERIFIED` at source/test tier; candidate/public deployment and physical proactive speech are absent.

- REST owns durable commands/history. `POST /chat/sessions/:sessionId/messages` returns 202 after an idempotent accepted write.
- Mobile WSS `/api/v1/ws` authenticates independently and emits completion/status events; it is not device `/ws` and carries no audio or token-by-token LLM stream.
- Backend persists the user message, obtains bounded curated memory, calls Hermes `/v1/responses`, persists assistant text, then emits `chat_message` with `messageId`.
- Stable cursor pagination and `(user, idempotency key)` deduplication make reconnect/retry safe.
- Temporary sessions have explicit retention/deletion behavior and never silently seed long-term memory.
- Voice transcripts may enter history only after a physical device is bound to an owner; raw WAV and MP3 remain temporary.

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

Recovery launches only after the HTTP listener binds, then drains repeated
64-row pages without making startup wait for the backlog. Periodic maintenance
continues the same recovery and retries transient query failures. Session
deletion cancels durable operations, aborts active in-process calls, and queued
workers must pass session/operation lease renewal before any provider call.

Hermes remains an internal dependency. Backend builds a bounded JSON context
from the seven canonical personalization fields, an explicit empty
`ChatMemoryContextProvider` result until the memory slice exists, and twelve
recent messages capped at 4,000 characters each. Hermes conversations are
server-owned and isolated as `chat:<userId>:<sessionId>`; URL, API key, database
configuration, and client-supplied identity never enter the mobile response or
context. The existing sanitizer and a local hard deadline protect persisted
assistant output. Provider failures persist only `HERMES_FAILED` and safe audit
metadata. Mobile events are best effort after durable state; REST history is
the recovery authority.

Deletion is a soft delete because retention/purge defaults remain open. The
slice rejects `speakOnDevice:true` with a sanitized service-unavailable result
until generic proactive delivery is available; no physical protocol was added.

All endpoints/events are enumerated in the integration coverage matrix.
