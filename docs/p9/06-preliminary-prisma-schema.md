# Prisma Schema Requirements — Phase 1 Freeze

**No production migration is authorized by this document.** Actual `schema.prisma` and applied migration history remain authoritative for existing storage.

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

Key existing facts: email is unique/canonicalized; refresh tokens and device credentials are stored as verifiers; `Device.hardwareId` is unique; pairing code is a keyed digest with expiry/use/attempt fields; user and device settings are one-to-one. `Session.clientDeviceId` exists, but the current auth issue path does not populate it, so per-client session revocation is not complete.

## Additive target requirements — `READY_TO_IMPLEMENT`

Names are conceptual until an implementation migration is reviewed. Prefer new tables and nullable columns; preserve all P9.1 identifiers and data.

### Account/profile/recovery

- Add nullable `User.dateOfBirth`, unique nullable normalized `username`, and nullable opaque `avatarKey`/media metadata; make DOB required only after a safe rollout/backfill policy.
- `PasswordRecovery`: user, single-use token/digest, expiry, used time, attempt/rate-limit/audit metadata. DOB is verified server-side and never returned.
- `PersonalizationSettings`: one-to-one user; tone, warmth, enthusiasm, headings/lists, emoji, answer speed, custom instructions, timestamps.

### Chat

- `ChatSession`: user, optional bound device, temporary flag, title/status, last-message cursor/time, retention/deletion timestamps.
- `ChatMessage`: session/user, role, kind, content/transcript metadata, stable monotonic cursor, idempotency key, created/deleted times.
- `ChatMessageFeedback`: unique user/message feedback with reason and timestamps.
- Unique `(userId, idempotencyKey)` or equivalently scoped constraint; indexes for stable session/message pagination.

### Memory

- `MemoryRecord`: user, topic/category, normalized content, importance, source, expiry/deletion, timestamps.
- `MemoryCandidate`: source message, proposed content, policy/review state, expiry.
- `MemoryAction` and `MemoryTopicForget`: immutable audit/idempotency for accept/reject/edit/delete/forget/clear/export.
- PostgreSQL full-text retrieval is initial; no mandatory vector extension.

### Scheduler and proactive delivery

- `Schedule`: user, timezone, recurrence/one-shot definition, durable state `ACTIVE|PAUSED|CANCELLED|COMPLETED`, target, payload, next-run time, version.
- `ScheduleRun`: unique schedule/due occurrence, claim/lease, result, retry/missed-run metadata.
- `ProactiveDelivery`: user/device, source `CHAT|SCHEDULE|WHATSAPP`, source resource, idempotency key, MP3 reference/expiry, attempt and terminal state.
- `DeliveryAttempt`: channel/device attempt, receipt/playback result, error, timestamps.

### Device configuration and observability

- `DeviceWifiConfiguration`: device, SSID, security, encrypted password ciphertext/nonce/tag/keyVersion, state including `SUPERSEDED`, delivery/applied/error timestamps. Never return ciphertext/plaintext through read APIs.
- `DeviceTelemetryCurrent`: unique device; Wi-Fi connected, nullable RSSI, battery-supported flag, nullable battery percent, nullable firmware version, observed time.
- `DeviceLog`: device, bounded level/code/message/metadata, observed time, expiry/retention index.
- Device settings delivery/application metadata may be separate records or explicit version fields; initial physical setting is playback volume.

### Integrations and support

- `IntegrationConnection`: user/provider, connection state, external opaque reference, scopes/status, timestamps; no WhatsApp session bytes.
- `SpotifyCredential`: encrypted access/refresh token material, nonce/tag/keyVersion, expiry/scope; unique user connection.
- `SpotifyAction`: user, normalized action, idempotency key, confirmation/provider result, redacted audit.
- `WhatsAppNotificationRule`, `WhatsAppSendRequest`, and `WhatsAppDelivery`: user-scoped rules, confirmation expiry, idempotency, bounded metadata; message retention minimized.
- `BugReport` and optional attachment/media metadata: reporter, category, sanitized description/context, state, timestamps; no secret dumps.

## Migration constraints

1. Generate reviewed migrations in development; use `prisma migrate deploy` only at an authorized runtime gate. Never use `db push`, startup migration, destructive reset, or blind down migration in production.
2. Add constraints/indexes after evaluating existing rows; use expand/backfill/enforce/contract when a required field cannot be introduced safely.
3. Encrypt Wi-Fi/provider secrets with application AEAD and key versioning. Encryption keys stay outside DB/Git/backups.
4. Every tenant query is scoped by authenticated user ownership; every delivery/action has an idempotency or uniqueness boundary.
5. Record migration name, image/SHA, backup, candidate result, and rollback/forward-fix plan before production execution.
