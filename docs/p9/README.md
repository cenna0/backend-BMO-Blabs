# Joy P9 — Current Architecture and Scope Authority

> **CURRENT / CANONICAL NAVIGATION**  
> Current runtime/API/status authority is source plus the canonical integration package. Numbered P9 files retain domain design and checkpoint context; follow their status banners and never let a frozen candidate statement override the current integration docs.

**Audited:** 2026-08-29  
**Production Status:** `PRODUCTION_VERIFIED` — Image `joy-p9.1:production`.  
**Database Migrations:** 10 migrations completed and applied in production (including `one_active_device_per_user`, `joy_speech_and_schedule_dialog`, and `mobile_push_tokens`).  
**HTTP Inventory:** 98 registered HTTP routes: 93 `/api/v1` P9 registrations, plus hardware voice upload, audio download, and three health routes.
**WebSocket Inventory:** Mobile uses an initial `authenticate` handshake, an `authenticated` acknowledgement, and 11 schema-defined application events; hardware has 14 inbound and 18 outbound source-defined events.

---

## Current Integration Authority
For Mobile, start at [`../integration/MOBILE-AGENT-HANDOFF.md`](../integration/MOBILE-AGENT-HANDOFF.md).  
For ESP/Hardware, start at [`../integration/ESP-AGENT-HANDOFF.md`](../integration/ESP-AGENT-HANDOFF.md).

Primary current contracts:
1. [`../integration/00-START-HERE.md`](../integration/00-START-HERE.md)
2. [`../integration/01-MOBILE-BACKEND-API-CONTRACT.md`](../integration/01-MOBILE-BACKEND-API-CONTRACT.md)
3. [`../integration/02-BACKEND-DEVICE-ADDITIVE-CONTRACT.md`](../integration/02-BACKEND-DEVICE-ADDITIVE-CONTRACT.md)
4. [`../integration/03-HARDWARE-IMPLEMENTATION-HANDOFF.md`](../integration/03-HARDWARE-IMPLEMENTATION-HANDOFF.md)
5. [`../integration/05-IMPLEMENTATION-STATUS.md`](../integration/05-IMPLEMENTATION-STATUS.md)
6. [`06-DECISION-REGISTER.md`](../integration/06-DECISION-REGISTER.md) — Dated decision lineage; not runtime authority.
7. [`../integration/08-DOCS-MAINTENANCE-PROTOCOL.md`](../integration/08-DOCS-MAINTENANCE-PROTOCOL.md)
8. [`../integration/09-ENDPOINT-EVENT-COVERAGE-MATRIX.md`](../integration/09-ENDPOINT-EVENT-COVERAGE-MATRIX.md)
9. [`../integration/11-FULL-ECOSYSTEM-ARCHITECTURE-AND-STATUS.md`](../integration/11-FULL-ECOSYSTEM-ARCHITECTURE-AND-STATUS.md)

---

## Domain Specifications
- [`06-database-schema-prisma.md`](06-database-schema-prisma.md) — Referensi skema lengkap 43 model database Prisma.
- [`08-auth-device-pairing.md`](08-auth-device-pairing.md) — Model autentikasi & pairing code-only dengan aturan *One Active Device per User*.
- [`13-scheduler-proactive-speech.md`](13-scheduler-proactive-speech.md) — Two-tier Schedule NLU & Proactive Delivery pipeline.
- [`18-action-intent-schema.md`](18-action-intent-schema.md) — Skema semantic action intents (Schedule & Spotify).
- [`26-push-notifications.md`](26-push-notifications.md) — Mobile Push Notification service & Expo integration.
- [`27-device-speech-arbiter.md`](27-device-speech-arbiter.md) — Device Speech Arbiter & sinkronisasi audio speaker hardware.
