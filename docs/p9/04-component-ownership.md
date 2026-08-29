# Component Ownership — Frozen

> **CURRENT / SUPPORTING**
> These ownership boundaries remain current. Source and the canonical
> integration package win on route, event, and runtime status.

| Component | Owns | Must not own |
|---|---|---|
| Mobile | presentation, local secure session handle, explicit user intent/confirmation | provider secrets, DB, Hermes/Audio calls, firmware state |
| Caddy | public TLS, host/path routing, edge policy | application auth, data, business state |
| Backend API service | auth/session, authorization, device ownership, APIs, chat, memory policy, schedules, delivery, provider adapters, audit | LLM personality, firmware implementation, provider session bytes |
| Prisma | schema mapping, typed DB access, controlled migrations | business policy or startup migration |
| PostgreSQL | durable Joy application state and audit | raw audio, Hermes provider session, plaintext secrets |
| Hermes | reasoning/personality, bounded responses, WhatsApp gateway/session capability | Joy source of truth, mobile API, direct provider policy |
| Audio Service | STT/TTS/FFmpeg and temporary audio output | identity, authorization, durable history |
| ESP32 | local network application, recording, playback, display, device acknowledgements | user/session/database/schedule truth |
| Spotify | provider playback/account state | Joy user ownership/audit |
| WhatsApp/Hermes session | provider connectivity/conversation session | Joy notification rules, confirmations, delivery audit |

An external side effect is authorized by Backend, executed by the owning adapter/device, and recorded as an idempotent attempt/result. No component may infer ownership from a display name, username, socket address, or Hermes conversation identifier.
