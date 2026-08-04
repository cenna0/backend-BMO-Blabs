# Mobile Chat Architecture

**Status:** `P9.1 LOCKED FOUNDATION; P9.2–P9.6 PROPOSED`

## Screens and API mapping

| Mobile surface | Proposed API group | Primary data |
|---|---|---|
| Sign-in/session | `/auth/register`, `/auth/login`, `/auth/refresh`, `/auth/logout`, `/auth/sessions/*`, `/me` | Invitation, PasswordCredential, Session, User |
| Device setup | `/pairing/*`, `/devices` | Device, DevicePairing |
| Chat list | `/chat/sessions` | ChatSession |
| Chat detail | `/chat/sessions/:id/messages` | ChatMessage |
| Compose text | `POST /chat/sessions/:id/messages` | ChatMessage |
| Voice transcript view | chat message response/events | ChatMessage kind `VOICE_TRANSCRIPT` |
| Memory review | `/memories`, `/memory-candidates` | MemoryRecord, MemoryCandidate |
| Schedule list/editor | `/schedules`, `/schedule-runs` | Schedule, ScheduleRun |
| Settings | `/settings`, `/devices/:id/settings` | UserSettings, DeviceSettings |
| Voice settings/preview | `/settings/voice`, `/voice/preview` | DeviceSettings + catalog |
| Spotify status | `/integrations/spotify/*` | SpotifyConnection, action result |
| WhatsApp status/rules | `/integrations/whatsapp/*` | WhatsAppConnection, rules |

Every proposed screen has a Backend API owner and a source-of-truth entity.
Mobile does not read raw Hermes context or provider tokens. Mobile displays all
initial user-facing times in `Asia/Jakarta`; timezone is server-enforced and
has no user-editable control.

## Chat request lifecycle

1. Mobile sends a client-generated message idempotency key and text.
2. Backend authenticates user, validates length/content policy, and creates the
   user message transactionally.
3. Backend retrieves only permitted context: recent chat, active memories,
   settings, and explicit task context.
4. Hermes returns assistant text and optional typed action proposals.
5. Backend validates actions independently, persists assistant text, action
   results, and audit metadata, then returns a bounded response.
6. Mobile renders server order using message IDs and can retry safely.

## Offline and error behavior

- Draft text may remain local and unsent.
- A submitted message is marked pending only in the client; Backend is the
  authority for accepted history.
- Retry uses the same idempotency key and returns the existing message/result.
- Provider/Hermes failure leaves the user message visible and returns a safe
  assistant error state without storing provider secrets or raw stack traces.
- Pagination uses a stable `(createdAt, id)` cursor; clients do not infer
  completeness from page size.
