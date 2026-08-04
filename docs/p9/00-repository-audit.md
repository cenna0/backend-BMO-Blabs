# P9 Repository Audit

**Status:** `P9.1 LOCKED — AUDIT COMPLETE`
**Audit date:** 2026-08-04
**Base:** `159ce6d9081928eca6d68921c3f64cdb36fce5bb`

## Git and production boundary

- Local `main` and fetched `origin/main` resolve to the same SHA above.
- The source checkout was clean before the P9 worktree was created.
- P8 production evidence records Piper Prudence primary, Kokoro fallback, and
  `RVC_ENABLED=false`.
- The current production deployment and Hardware Contract v1.0.5 were not
  modified by this audit or architecture branch.

## Documents read

| Area | Documents |
|---|---|
| Product/roadmap | `docs/product/BMO-BY-BLABS-PRD-v1.2.4.md`, `docs/roadmap/P6-P10-ROADMAP.md`, `docs/roadmap/P8-EXECUTION-SPEC.md`, `docs/NEXT-ACTION.md` |
| Current status/evidence | `docs/backend-mvp/CURRENT-RUNTIME-CONFIG.md`, `IMPLEMENTATION-STATUS.md`, `P8-PRODUCTION-ROLLOUT-EVIDENCE.md`, `POST-P8-STORAGE-CLEANUP-EVIDENCE.md`, `P7-TEST-EVIDENCE.md` |
| Backend/Hermes | `01-SCOPE-AND-DECISIONS.md`, `02-API-AND-WEBSOCKET-CONTRACT.md`, `03-BACKEND-ARCHITECTURE.md`, `04-AUDIO-SERVICE.md`, `06-DEPLOYMENT-AND-OPERATIONS.md`, `backend/src/services/hermes.client.ts`, `request-store.ts`, `websocket/events.ts`, `config/env.ts` |
| Hardware | `docs/hardware-contract/BMO-MVP-HW-INTERFACE-CONTRACT-v1.0.5.md`, `docs/hardware-handoff/README.md`, `AGENT-CONTEXT.md`, `CURRENT-STATUS.md`, `DEPLOYMENT-CONFIG.md`, `ACCEPTANCE-TESTS.md` |
| Runtime/tests | `docker-compose.yml`, `.env.*.example`, `backend/package.json`, backend Hermes/request/WebSocket/voice tests, `scripts/verify-backend-mvp-docs.py` |

## Outdated or incomplete statements found

1. The active PRD still described Kokoro as the current TTS and RVC as a
   possible production conversion path. P8 now requires Piper Prudence primary,
   Kokoro fallback, and archived/disabled RVC wording.
2. The PRD and some active backend MVP references treated P9 as only database
   readiness and left mobile/auth/integration behavior as future/unresolved. P9 now
   has a final platform architecture with isolated subphases.
3. The older architecture described Hermes as owning personality, context, and
   memory without an application `MemoryGateway`. P9 separates Postgres-backed
   memory from chat history and keeps Hermes behind an adapter.
4. Existing request state is intentionally in-memory and voice-only; there are
   no chat, memory, schedule, provider-action, or pairing models in code. This
   remains correct for P8 and is documented as a P9 implementation boundary.
5. The current public event contract contains request-bound audio lifecycle
   events only. Proactive speech had no dedicated lifecycle; P9 proposes an
   additive future contract version and leaves v1.0.5 unchanged.
6. Existing mobile plans name broad screens/API ideas but do not map every
   surface to a source-of-truth entity. P9 adds that mapping.
7. Spotify/WhatsApp ownership was described broadly; P9 makes Backend the
   action/policy/token boundary while preserving Hermes ownership of WhatsApp
   session bytes.
8. `docs/NEXT-ACTION.md` had a duplicated P8/P9 gate sentence and historical
   P8 RVC execution bullets mixed into the current next-action narrative.
9. `docs/backend-mvp/05-TESTING-AND-ACCEPTANCE.md` and the RVC deployment
   section retain historical P8 language; active current overrides are added
   rather than erasing evidence.

## Implementation inventory

The repository contains the existing TypeScript voice Backend, Python Audio
Service, Hermes Responses adapter, in-memory request/device stores, Docker
Compose topology, hardware contract/handoff, tests, and P8 evidence. It does
not contain a Prisma schema, PostgreSQL runtime, mobile application, chat
models, MemoryGateway, scheduler worker, Spotify adapter, WhatsApp policy
adapter, or proactive-audio events.

## Audit conclusion

The repository is suitable for an isolated documentation lock. P9 is not
implemented; no production change is authorized by this branch.
