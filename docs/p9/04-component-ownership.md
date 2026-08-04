# P9 Component Ownership

**Status:** `LOCKED + PROPOSED`

| Component | Owns | Does not own | Boundary |
|---|---|---|---|
| Backend | auth, sessions, ownership, APIs, chat, memory policy, schedules, provider actions, audit | LLM personality, raw provider SDK exposure, firmware protocol changes | versioned HTTP APIs and existing HW adapter |
| Prisma data layer | schema mapping, transactions, migrations, query types | business policy, provider tokens in plaintext | repository/service interfaces |
| PostgreSQL | durable application records and audit | model cache, raw audio, Hermes private store, WhatsApp session bytes | private DB network |
| Hermes | personality, reasoning, context response, typed intent proposals | PostgreSQL, mobile APIs, provider credentials, memory CRUD | loopback adapter with explicit payloads |
| MemoryGateway | memory search/write/update/delete/export semantics | chat history ownership, raw audio, provider actions | interface implemented first by PostgresMemoryGateway |
| Scheduler worker | due-run claiming, retries, idempotency, delivery attempt lifecycle | memory, chat policy, hardware wire format | scheduler service interface |
| Audio Service | STT/TTS/FFmpeg and bounded audio output | user identity, tokens, provider actions, long-term storage | existing internal HTTP interface |
| Mobile app | presentation, local session state, user-initiated confirmation | secrets, direct DB/Hermes/provider access | authenticated Backend API |
| ESP32 firmware | local recording/playback/display and v1.0.5 event handling | user auth/session, schedules, database | immutable v1.0.5 contract |
| Spotify adapter | OAuth/provider calls/token refresh | action policy and user consent | Backend-owned interface |
| WhatsApp adapter | Hermes gateway calls/session status | notification policy, confirmation, memory ingestion | Backend-owned interface |
| Caddy | TLS and public routing | auth, business logic, persistence | public edge only |

## Ownership rules

- A record has one write owner. Other components use a service boundary.
- Provider response data is normalized before it crosses into chat, mobile, or
  Hermes.
- Sensitive values are represented by opaque IDs or redacted metadata outside
  the owning adapter.
- A failure in an optional integration cannot make the existing voice health
  route falsely report a core dependency failure.
