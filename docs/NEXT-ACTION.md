# Joy — Current Next Action

> **CURRENT / CANONICAL**  
> Current source and the canonical integration package override dated plans/evidence.

**Last updated:** 2026-08-29  
**Current executable boundary:** End-to-end ecosystem verification across Joy Mobile app, ESP32-S3 hardware firmware, and VPS Backend.  
**Production status:** `PRODUCTION_VERIFIED` — Backend deployed as `joy-p9.1:production`.  
**Database Migrations:** 10 completed migrations applied in production.  
**Production verification:** Direct/public health, Mobile REST/WS, Two-Tier Schedule NLU, Spotify Intent, Push Notifications, and Voice Pipeline pass production checks.  
**Hardware Firmware Status:** `PENDING_PHYSICAL_ESP` — Backend-side hardware contract is source-defined; firmware and bench evidence remain outside this repository.  
**Audio status:** `PRODUCTION_VERIFIED` — Hybrid Edge-TTS (`en-US-AnaNeural`) + Piper TTS (`en_GB-semaine-medium`) + Groq Whisper STT + Hermes Core.

---

## Ecosystem Component Boundaries & Starting Points

### 1. Mobile Integration (`joy-mobile`)
- Start with [`integration/MOBILE-AGENT-HANDOFF.md`](integration/MOBILE-AGENT-HANDOFF.md).
- Endpoints: REST `https://api.personalbmo.web.id/api/v1`, WebSocket `wss://api.personalbmo.web.id/api/v1/ws`.
- Scope: 93 registered `/api/v1` routes (including database-ops and provider-callback entries) plus the hardware voice/audio/health routes tracked in the coverage matrix. Mobile WS uses an `authenticate` handshake, an `authenticated` acknowledgement, and 11 schema-defined outbound application events.

### 2. ESP32-S3 Firmware Integration (`Joy-1-2`)
- Start with [`integration/ESP-AGENT-HANDOFF.md`](integration/ESP-AGENT-HANDOFF.md) and [`integration/11-FULL-ECOSYSTEM-ARCHITECTURE-AND-STATUS.md`](integration/11-FULL-ECOSYSTEM-ARCHITECTURE-AND-STATUS.md).
- Endpoints: Hardware WSS `wss://api.personalbmo.web.id/ws`, Voice Upload `POST /api/v1/voice`, Audio Download `GET /audio/:audioId.mp3`.
- Scope: External ESP32 contract suite reports 105/105 tests; physical bench acceptance remains `PENDING_PHYSICAL_ESP`.
