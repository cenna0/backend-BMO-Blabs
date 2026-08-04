# P9 System Architecture

**Status:** `P9.1 LOCKED; P9.2–P9.6 PROPOSED`

## Target topology

```text
Mobile app ──HTTPS──┐
                    ▼
              Caddy / public API
                    ▼
        Backend application boundary
        ├─ auth/session and device ownership
        ├─ chat/history and MemoryGateway
        ├─ schedules/worker/delivery
        ├─ Spotify and WhatsApp adapters
        ├─ action-intent validator/executor
        └─ existing voice pipeline + HW v1.0.5 adapter
          │             │             │
          │             │             └─ Hermes localhost adapter
          │             └─ Audio Service localhost adapter
          └─ Prisma ── private PostgreSQL

Future additive path:
  Scheduler → ProactiveSpeechCoordinator → Backend audio generation
            → proposed scheduled-audio HW events → device/mobile target
```

The single VPS remains the initial deployment shape. Backend, Audio Service,
and PostgreSQL are private origins; Caddy is the only public application edge.
P9.1 PostgreSQL is one pinned-major container with an initial 768 MiB memory
target, Prisma pool target 5, and approximately 20 database connections;
capacity testing may revise exact caps before implementation acceptance.
Hermes remains a host runtime at `127.0.0.1:8642`. Existing production Piper
and Kokoro behavior is an internal audio implementation detail and is not
replaced by P9.

## Trust boundaries

1. **Mobile ↔ Backend:** email/password authentication, short-lived access
   token, opaque rotating refresh token, TLS, user authorization, rate limits,
   response filtering.
2. **Device ↔ Backend:** existing device credential/WebSocket/HTTP contract;
   v1.0.5 is immutable.
3. **Backend ↔ Hermes:** loopback bearer key, typed request/response adapter,
   no database/API access for Hermes.
4. **Backend ↔ Audio Service:** loopback internal token, bounded text/audio
   payloads, no external provider credentials.
5. **Backend ↔ PostgreSQL:** private network, least-privilege database role,
   encrypted backups and migrations.
6. **Backend ↔ providers:** provider credentials stay in Backend-side secret
   storage and provider adapters; mobile and Hermes receive redacted results.

## Request flows

### Mobile chat

```text
Mobile → Backend auth/session check
       → create/append ChatMessage
       → scoped context retrieval via MemoryGateway
       → Hermes request with bounded context
       → persist assistant ChatMessage
       → review-safe memory candidate (optional)
       → response to Mobile
```

Voice input follows the existing ESP32 pipeline. When a user/device identity
is known, the transcript and assistant text are appended to chat history by
Backend; WAV and MP3 remain temporary operational artifacts.

### External action

```text
Hermes → typed ActionIntent proposal
       → Backend schema/policy/ownership/confirmation checks
       → provider adapter or device adapter
       → ActionExecution audit/result
       → Hermes/mobile receives bounded result
```

### Scheduled speech

```text
Schedule → due ScheduleRun → idempotent worker claim
         → delivery target selection
         → optional Hermes wording
         → audio generation
         → additive scheduled-audio event lifecycle
         → acknowledgement/attempt audit
```

No scheduled flow writes memory merely because it produced speech.

## P9.1 time and settings rule

All initial user-facing and mobile schedule times are interpreted and displayed
in `Asia/Jakarta`. The timezone is server-enforced and not user-editable.
Persisted database timestamps use UTC-compatible PostgreSQL `timestamptz`;
future schedule metadata also defaults to `Asia/Jakarta`.
