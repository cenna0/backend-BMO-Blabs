# Joy P9 Platform — Database Schema & Prisma ORM Reference

**Status:** `PRODUCTION_VERIFIED`  
**ORM:** Prisma 7.9.0  
**Database:** PostgreSQL 16.14 Alpine  
**Total Models:** 43 Models  
**Applied Migrations:** 10 Migrations (up to `20260827120000_mobile_push_tokens`)

---

## 1. Domain Group Overview

1. **User & Identity Domain**: `User`, `AuthIdentity`, `PasswordCredential`, `PasswordRecovery`, `OAuthState`, `Invitation`, `RefreshToken`, `Session`.
2. **Device & Hardware Domain**: `Device`, `HardwareEnrollment`, `DevicePairing`, `DeviceWifiConfiguration`, `DeviceSettings`, `DeviceTelemetryCurrent`, `DeviceLog`, `DeviceSpeechReservation`.
3. **User Preferences & Customization**: `UserSettings`, `PersonalizationSettings`.
4. **Conversations & Chat Domain**: `ChatSession`, `ChatMessage`, `ChatMessageFeedback`, `ChatOperation`.
5. **Long-Term Memory Domain**: `MemoryCandidate`, `MemoryRecord`, `MemorySummary`, `MemoryTopicForget`, `MemoryAction`.
6. **Schedules & Proactive Speech**: `Schedule`, `ScheduleRun`, `ProactiveDelivery`, `DeliveryAttempt`.
7. **Audit & Notifications**: `AuditEvent`, `MobilePushToken`.
8. **Integrations & Plugins Domain**: `IntegrationConnection`, `SpotifyCredential`, `SpotifyAction`, `WhatsAppConversation`, `WhatsAppConversationAlias`, `WhatsAppNotificationRule`, `WhatsAppSendRequest`, `WhatsAppDelivery`.
9. **Support Domain**: `BugReport`, `BugReportAttachment`.

---

## 2. Complete Model Definitions & Schemas

### 2.1 User & Authentication
- **`User`**:
  - Columns: `id` (UUID PK), `email` (VarChar 255 unique), `displayName` (VarChar 120), `dateOfBirth` (Date), `avatarUrl` (VarChar 255), `avatarKey` (VarChar 255), `createdAt`, `updatedAt`, `deletedAt`.
  - Relations: Cascading relation to identities, sessions, devices, chat, memories, schedules, integrations, and push tokens.
- **`AuthIdentity`**:
  - Columns: `id` (UUID PK), `userId` (FK), `provider` (`EMAIL_PASSWORD` | `GOOGLE`), `providerSubject` (VarChar 255), `createdAt`, `updatedAt`.
  - Unique Constraint: `@@unique([provider, providerSubject])`.
- **`PasswordCredential`**:
  - Columns: `id` (UUID PK), `userId` (FK unique), `passwordHash` (VarChar 255), `salt` (VarChar 64), `createdAt`, `updatedAt`.
- **`PasswordRecovery`**:
  - Columns: `id` (UUID PK), `userId` (FK), `tokenHash` (VarChar 128 unique), `expiresAt`, `usedAt`, `createdAt`.
- **`Session`**:
  - Columns: `id` (UUID PK), `userId` (FK), `sessionTokenHash` (VarChar 128 unique), `clientDeviceId` (VarChar 255), `revokedAt`, `expiresAt`, `createdAt`, `updatedAt`.
- **`RefreshToken`**:
  - Columns: `id` (UUID PK), `sessionId` (FK), `userId` (FK), `tokenHash` (VarChar 128 unique), `familyId` (UUID), `generation` (Int), `revokedAt`, `expiresAt`, `createdAt`.

### 2.2 Device & Hardware Domain
- **`Device`**:
  - Columns: `id` (UUID PK), `userId` (FK), `name` (VarChar 120), `hardwareId` (VarChar 64 unique), `tokenHash` (VarChar 128), `status` (`PENDING` | `ACTIVE` | `REVOKED`), `pairedAt`, `revokedAt`, `createdAt`, `updatedAt`.
  - Constraint: Partial unique index `idx_devices_one_active_device_per_user_v2` on `(userId)` where `status = 'ACTIVE' AND revokedAt IS NULL`.
- **`DeviceSpeechReservation`**:
  - Columns: `id` (UUID PK), `deviceId` (UUID unique FK), `ownerKind` (`VOICE_CHAT` | `PROACTIVE_SPEECH` | `SYSTEM_ALERT`), `ownerCorrelationId` (UUID), `generation` (Int default 1), `leaseId` (UUID), `receipt` (VarChar 512), `leaseExpiresAt`, `createdAt`, `updatedAt`.
  - Concurrency: Managed by `DeviceSpeechArbiterService` with PostgreSQL `pg_advisory_xact_lock`.
- **`HardwareEnrollment`**:
  - Columns: `id` (UUID PK), `hardwareId` (VarChar 64 unique), `pairingCodeHash` (VarChar 128), `status` (`ISSUED` | `CLAIMED` | `EXPIRED` | `REVOKED` | `INVALIDATED`), `expiresAt`, `claimedAt`, `createdAt`, `updatedAt`.
- **`DeviceWifiConfiguration`**:
  - Columns: `id` (UUID PK), `deviceId` (FK), `encryptedSsid` (VarChar 512), `encryptedPassword` (VarChar 1024), `security` (`OPEN` | `WPA_PSK`), `status` (`PENDING` | `DELIVERED` | `APPLYING` | `CONNECTED` | `FAILED`), `createdAt`, `updatedAt`.

### 2.3 Mobile Push Notifications
- **`MobilePushToken`**:
  - Columns: `id` (UUID PK), `userId` (UUID FK), `token` (VarChar 512 unique), `platform` (VarChar 32 default "expo"), `deviceId` (VarChar 255 nullable), `createdAt`, `updatedAt`.
  - Index: `@@index([userId])`.

### 2.4 Chat & Conversations
- **`ChatSession`**:
  - Columns: `id` (UUID PK), `userId` (FK), `title` (VarChar 200), `status` (`ACTIVE` | `ARCHIVED` | `DELETED`), `isTemporary` (Boolean default false), `createdAt`, `updatedAt`.
- **`ChatMessage`**:
  - Columns: `id` (UUID PK), `sessionId` (FK), `userId` (FK), `role` (`USER` | `ASSISTANT` | `SYSTEM`), `kind` (`TEXT` | `EVENT`), `content` (Text), `sourceDeviceId` (UUID nullable), `createdAt`.
- **`ChatMessageFeedback`**:
  - Columns: `id` (UUID PK), `messageId` (FK unique), `userId` (FK), `rating` (`POSITIVE` | `NEGATIVE`), `reason` (VarChar 500), `createdAt`.

### 2.5 Long-Term Memory
- **`MemoryRecord`**:
  - Columns: `id` (UUID PK), `userId` (FK), `content` (VarChar 2000), `category` (VarChar 64), `confidence` (Float), `sourceMessageId` (UUID nullable), `createdAt`, `updatedAt`.
- **`MemoryCandidate`**:
  - Columns: `id` (UUID PK), `userId` (FK), `content` (VarChar 2000), `status` (`PENDING` | `ACCEPTED` | `REJECTED` | `EXPIRED`), `createdAt`, `expiresAt`.
- **`MemorySummary`**:
  - Columns: `id` (UUID PK), `userId` (FK unique), `content` (VarChar 4000), `status` (`READY` | `GENERATING` | `FAILED`), `version` (Int), `createdAt`, `updatedAt`.

### 2.6 Schedules & Proactive Delivery
- **`Schedule`**:
  - Columns: `id` (UUID PK), `userId` (FK), `targetDeviceId` (UUID nullable FK), `status` (`ACTIVE` | `PAUSED` | `CANCELLED` | `COMPLETED`), `timezone` (VarChar 64 default "Asia/Jakarta"), `recurrence` (JSONB), `payload` (JSONB), `nextRunAt`, `createdAt`, `updatedAt`.
- **`ScheduleRun`**:
  - Columns: `id` (UUID PK), `scheduleId` (FK), `userId` (FK), `status` (`DUE` | `CLAIMED` | `SUCCEEDED` | `FAILED` | `MISSED`), `workerId` (VarChar 128), `leaseExpiresAt`, `dueAt`, `executedAt`, `errorCode`, `createdAt`, `updatedAt`.
- **`ProactiveDelivery`**:
  - Columns: `id` (UUID PK), `userId` (FK), `targetDeviceId` (UUID nullable FK), `source` (`CHAT` | `SCHEDULE` | `WHATSAPP`), `status` (`PENDING` | `READY` | `DELIVERING` | `DELIVERED` | `FAILED` | `EXPIRED` | `MISSED`), `expiresAt`, `createdAt`, `updatedAt`.
