# P9 Product Scope and Non-Goals

**Status:** `LOCKED + PROPOSED`

## Current verified baseline

P8 production is closed and unchanged:

- Piper `en_GB-semaine-medium`, Prudence, speaker ID `0` is the fixed primary.
- Kokoro `af_heart` at speed `0.80` is the automatic fallback.
- `RVC_ENABLED=false`; RVC runtime/container artifacts are not production
  dependencies. Archived RVC evidence and Git history remain historical only.
- The voice API, WebSocket event set, WAV input, MP3 lifecycle, and Hardware
  Contract v1.0.5 remain unchanged.
- PostgreSQL and Prisma are not implemented or deployed.

## P9 goal

P9 is the final application-platform architecture phase. It defines the
contracts and implementation order for persistent identity, device ownership,
mobile chat, chat history, curated memory, settings, editable voice settings,
scheduling, proactive speech, Spotify, WhatsApp, security, recovery, and
acceptance.

The Backend is the application boundary. Hermes remains the BMO reasoning and
personality runtime, but it must communicate with application capabilities
through explicit contracts. Mobile clients never call Hermes, PostgreSQL,
Spotify, WhatsApp, or hardware directly.

## In scope

1. PostgreSQL as application source of truth and Prisma as the type-safe data
   access/migration tool.
2. User authentication, sessions, device ownership, pairing, revocation, and
   user/device settings.
3. Text and voice-transcript chat history with explicit retention/deletion.
4. Curated long-term memory behind `MemoryGateway`.
5. Timezone-aware schedules, reminders, alarms, delivery, retries,
   acknowledgement, and audit.
6. A future additive scheduled-audio hardware contract proposal.
7. Backend-owned Spotify and WhatsApp credential/action boundaries.
8. Backup, restore, encryption, monitoring, load/resource verification, and
   final acceptance gates.

## Non-goals and explicit exclusions

- Do not install PostgreSQL, run migrations, deploy, or change production in
  this architecture task.
- Do not modify Hardware Contract v1.0.5.
- Do not implement Spotify, WhatsApp, mobile APIs, memory, scheduler, or voice
  settings in this architecture task.
- Do not install/run Mem0, Qdrant, or Obsidian on the VPS.
- Do not make Markdown the memory source of truth.
- Do not retain raw WAV or generated MP3 as permanent chat history.
- Do not automatically convert every chat message into long-term memory.
- Do not add custom voice uploads, cloning, RVC, user checkpoints, runtime
  model downloads, or simultaneous multi-model TTS preloading.
- Do not make scheduled audio reuse request-bound voice events silently.

## Product principles

- User-visible data has one authoritative owner and an auditable lifecycle.
- Chat history and long-term memory are separate products with separate
  deletion and privacy controls.
- Structured application records, especially schedules, are not memory.
- Backend executes external actions; Hermes proposes typed actions and
  receives bounded results.
- Every future feature is additive to the verified voice MVP boundary.
