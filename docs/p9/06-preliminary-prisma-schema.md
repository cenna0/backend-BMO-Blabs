# Prisma Schema — Phase 2 Application Foundation

**Source state:** `EXISTING_VERIFIED` for schema and migration source only.
**Runtime state:** migration `20260811190000_phase2_application_foundation` has
not been applied to the running candidate or production. This document does not
authorize a database migration.

## Existing P9.1 schema — `EXISTING_VERIFIED`

The audited schema has 11 models:

```text
User
PasswordCredential
AuthIdentity
Invitation
Session
RefreshToken
Device
DevicePairing
UserSettings
DeviceSettings
AuditEvent
```

Existing enums are `InvitationStatus`, `DeviceStatus`, `PairingStatus`,
`ResponseLength`, and `NotificationBehavior`.

Applied candidate migrations:

```text
20260804110000_p9_1_foundation
20260804123000_p9_1_integrity_constraints
```

Key existing facts: email is unique/canonicalized; refresh tokens and device credentials are stored as verifiers; `Device.hardwareId` is unique; pairing code is a keyed digest with expiry/use/attempt fields; user and device settings are one-to-one. Login may populate `Session.clientDeviceId` after transaction-locked active-owner validation; pre-pairing sessions remain nullable.

## Additive Slice 2A source — `EXISTING_VERIFIED`

The Prisma source now contains 38 models: the 11 unchanged P9.1 models plus the
following 27 additive models:

```text
PasswordRecovery
PersonalizationSettings
ChatSession
ChatMessage
ChatOperation
ChatMessageFeedback
MemoryRecord
MemoryCandidate
MemoryAction
MemoryTopicForget
MemorySummary
Schedule
ScheduleRun
ProactiveDelivery
DeliveryAttempt
DeviceWifiConfiguration
DeviceTelemetryCurrent
DeviceLog
IntegrationConnection
OAuthState
SpotifyCredential
SpotifyAction
WhatsAppNotificationRule
WhatsAppSendRequest
WhatsAppDelivery
BugReport
BugReportAttachment
```

The migration is expand-only: it creates enums/tables/indexes/foreign keys and
adds nullable `User` columns plus backward-compatible `DeviceSettings` delivery
metadata. It contains no destructive statement. Existing P9.1 IDs, fields,
constraints, and records are not renamed or removed.

### Account/profile/recovery

- `User.dateOfBirth` is nullable `DATE`; `username` is nullable, unique, and normalized by a database check; `avatarKey` is nullable/unique with content type and positive byte-size shape checks. Username length `3–30` remains an application-layer rule. `SafeUser` still omits DOB.
- `PasswordRecovery`: user, unique lowercase SHA-256 verifier only, expiry/used time, bounded attempts, optional hashed request IP/user agent, and a bounded request ID. No recovery token plaintext or unbounded JSON audit metadata is stored.
- `PersonalizationSettings`: one-to-one user; tone, warmth, enthusiasm, headings/lists, emoji, answer speed, custom instructions, timestamps.

### Chat

- `ChatSession`: user, optional same-owner device composite FK, temporary flag, title/status, last-message cursor/time, and nullable expiry/deletion timestamps.
- `ChatMessage`: session/user, role, kind, content/metadata, positive monotonic cursor, user-scoped idempotency, created/deleted times, and optional same-owner source device.
- `ChatOperation`: durable `PROCESSING|SUCCEEDED|FAILED|CANCELLED` state for the 202 response boundary, unique user message and user-scoped idempotency.
- `ChatMessageFeedback`: unique user/message feedback with reason and timestamps.
- Unique `(userId, idempotencyKey)` or equivalently scoped constraint; indexes for stable session/message pagination.

### Memory

- `MemoryRecord`: user, topic/category, normalized content, bounded importance, source, nullable expiry/deletion, timestamps.
- `MemoryCandidate`: source message, proposed content, policy/review state, expiry.
- `MemoryAction` and `MemoryTopicForget`: immutable user-scoped audit/idempotency for accept/reject/edit/delete/forget/clear/export and summary operations.
- `MemorySummary`: one current user-scoped durable summary with version/status/feedback and nullable expiry/deletion for the frozen summary endpoints.
- PostgreSQL full-text retrieval is initial; no mandatory vector extension.

### Scheduler and proactive delivery

- `Schedule`: user, timezone, recurrence/one-shot definition, durable state `ACTIVE|PAUSED|CANCELLED|COMPLETED`, target, payload, next-run time, version.
- `ScheduleRun`: unique schedule/due occurrence, paired lease owner/expiry, result, retry/missed-run metadata, and non-negative attempt count. No retry limit/default is invented.
- `ProactiveDelivery`: user/device, source `CHAT|SCHEDULE|WHATSAPP`, source resource, idempotency key, MP3 reference/expiry, attempt and terminal state.
- `DeliveryAttempt`: channel/device attempt, receipt/playback result, error, timestamps.

### Device configuration and observability

- `DeviceWifiConfiguration`: versioned device record with bounded SSID, `OPEN|WPA_PSK`, AEAD ciphertext/nonce/tag/key version, full status lifecycle including `SUPERSEDED`, delivery/application/error timestamps, and a database check that open networks have no secret material while protected networks have the complete encrypted shape. Never return ciphertext/plaintext through read APIs.
- `DeviceTelemetryCurrent`: unique device; Wi-Fi connected, nullable RSSI, battery-supported flag, nullable battery percent, nullable firmware version, observed time.
- `DeviceLog`: device, bounded level/code/message/metadata, observed time, expiry/retention index.
- Existing `DeviceSettings` now has additive version/delivered/applied/error metadata with version-shape checks; initial physical setting remains playback volume.

### Integrations and support

- `IntegrationConnection`: unique user/provider state, opaque external reference, scopes/status, timestamps; no WhatsApp session bytes.
- `OAuthState`: unique SHA-256 state verifier, exact redirect URI, expiry and single-use timestamp.
- `SpotifyCredential`: unique user/connection with encrypted access/refresh token ciphertext/nonce/tag/key version, expiry/scope, and encryption-shape checks.
- `SpotifyAction`: user, normalized action, idempotency key, confirmation/provider result, redacted audit.
- `WhatsAppNotificationRule`, `WhatsAppSendRequest`, and `WhatsAppDelivery`: user-scoped rules, confirmation expiry, idempotency, bounded metadata; message retention minimized. SQL check/partial indexes allow one global `ALL` rule with no target and distinct nonblank `CONTACT`/`GROUP` targets. Prisma deliberately exposes no misleading compound-unique API for this SQL-only partial uniqueness.
- `BugReport` and optional attachment/media metadata: reporter, category, sanitized description/context, state, timestamps; no secret dumps.

## Migration and rollout constraints

1. The reviewed source migration is not runtime evidence. Use `prisma migrate deploy` only at an authorized disposable/candidate gate, then separately authorize production. Never use `db push`, startup migration, destructive reset, or blind down migration in production.
2. Add constraints/indexes after evaluating existing rows; use expand/backfill/enforce/contract when a required field cannot be introduced safely.
3. Encrypt Wi-Fi/provider secrets with application AEAD and key versioning. Encryption keys stay outside DB/Git/backups.
4. Every tenant query is scoped by authenticated user ownership; every delivery/action has an idempotency or uniqueness boundary.
5. Record migration name, image/SHA, backup, candidate result, and rollback/forward-fix plan before production execution.
