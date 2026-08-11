# Mobile Chat and Realtime Architecture

**Status:** `READY_TO_IMPLEMENT`

- REST owns durable commands/history. `POST /chat/sessions/:sessionId/messages` returns 202 after an idempotent accepted write.
- Mobile WSS `/api/v1/ws` authenticates independently and emits completion/status events; it is not device `/ws` and carries no audio or token-by-token LLM stream.
- Backend persists the user message, obtains bounded curated memory, calls Hermes `/v1/responses`, persists assistant text, then emits `chat_message` with `messageId`.
- Stable cursor pagination and `(user, idempotency key)` deduplication make reconnect/retry safe.
- Temporary sessions have explicit retention/deletion behavior and never silently seed long-term memory.
- Voice transcripts may enter history only after a physical device is bound to an owner; raw WAV and MP3 remain temporary.

All endpoints/events are enumerated in the integration coverage matrix.
