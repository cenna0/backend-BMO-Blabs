# Preliminary Prisma Schema

**Status:** `P9.1 foundation LOCKED; future entities PROPOSED — NOT IMPLEMENTED`
**Rule:** this is a design artifact, not `backend/prisma/schema.prisma`; no
PostgreSQL service, extension, or migration is created by P9 architecture.

The following draft establishes names, ownership, and deletion boundaries. The
first implementation must run Prisma validation and migration review against
the approved version before any database is activated. Every `DateTime` field
is required to map to UTC-compatible PostgreSQL `timestamptz`; application
timezone interpretation is separately server-enforced as `Asia/Jakarta`.

```prisma
enum InvitationStatus { ACTIVE ACCEPTED EXPIRED REVOKED }
enum DeviceStatus { PENDING ACTIVE REVOKED }
enum PairingStatus { PENDING CONSUMED EXPIRED REVOKED }
enum ChatRole { USER ASSISTANT SYSTEM }
enum ChatKind { TEXT VOICE_TRANSCRIPT }
enum ResponseLength { BRIEF STANDARD DETAILED }
enum NotificationBehavior { ALL IMPORTANT NONE }
enum MemoryType { FACT PREFERENCE INSTRUCTION PROJECT GOAL DEADLINE RELATIONSHIP EPISODIC_SUMMARY }
enum MemoryStatus { ACTIVE DELETED }
enum CandidateStatus { PENDING ACCEPTED REJECTED EXPIRED }
enum MemoryActionType { CREATE UPDATE DELETE REJECT FORGET_TOPIC CLEAR_ALL }
enum ScheduleKind { ONE_TIME RECURRING }
enum ScheduleStatus { ACTIVE PAUSED CANCELLED COMPLETED }
enum MissedRunPolicy { SKIP RUN_ONCE RUN_NEXT_WINDOW }
enum RunStatus { PENDING CLAIMED DELIVERING DELIVERED MISSED FAILED CANCELLED }
enum DeliveryChannel { DEVICE MOBILE }
enum DeliveryStatus { PENDING SENT ACKNOWLEDGED FAILED EXPIRED }
enum IntegrationStatus { DISCONNECTED PENDING CONNECTED ERROR }
enum ActionStatus { PROPOSED CONFIRMATION_REQUIRED ACCEPTED EXECUTING SUCCEEDED FAILED EXPIRED }

model User {
  id              String          @id @default(uuid())
  email           String          @unique
  displayName     String?
  createdAt       DateTime        @default(now())
  updatedAt       DateTime        @updatedAt
  identities      AuthIdentity[]
  passwordCredential PasswordCredential?
  sessions        Session[]
  devices         Device[]
  pairing         DevicePairing[]
  userSettings    UserSettings?
  chatSessions    ChatSession[]
  chatMessages    ChatMessage[]
  memories        MemoryRecord[]
  candidates      MemoryCandidate[]
  memoryActions   MemoryAction[]
  forgottenTopics MemoryTopicForget[]
  schedules       Schedule[]
  targets         DeliveryTarget[]
  spotify         SpotifyConnection?
  whatsapp        WhatsAppConnection?
  auditEvents     AuditEvent[]
}

model Invitation {
  id          String           @id @default(uuid())
  email       String
  tokenHash   String           @unique
  status      InvitationStatus @default(ACTIVE)
  expiresAt   DateTime
  acceptedAt  DateTime?
  revokedAt   DateTime?
  createdAt   DateTime         @default(now())
  @@index([email, status, expiresAt])
}

model PasswordCredential {
  id           String   @id @default(uuid())
  userId       String   @unique
  passwordHash String
  algorithm    String   @default("argon2id")
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model AuthIdentity {
  id             String   @id @default(uuid())
  userId         String
  provider       String
  providerSubject String
  createdAt      DateTime @default(now())
  user           User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@unique([provider, providerSubject])
  @@index([userId])
}

model Session {
  id             String         @id @default(uuid())
  userId         String
  clientDeviceId String?
  expiresAt      DateTime
  revokedAt      DateTime?
  revokedReason  String?
  createdAt      DateTime       @default(now())
  lastUsedAt     DateTime?
  user           User           @relation(fields: [userId], references: [id], onDelete: Cascade)
  refreshTokens  RefreshToken[]
  @@index([userId, clientDeviceId, revokedAt, expiresAt])
}

model RefreshToken {
  id         String    @id @default(uuid())
  sessionId  String
  tokenHash  String    @unique
  familyId   String
  issuedAt   DateTime  @default(now())
  expiresAt  DateTime
  usedAt     DateTime?
  revokedAt  DateTime?
  session    Session   @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  @@index([sessionId, familyId, expiresAt])
}

model Device {
  id             String          @id @default(uuid())
  userId         String
  hardwareId     String          @unique
  name           String
  tokenHash      String
  status         DeviceStatus    @default(PENDING)
  pairedAt       DateTime?
  lastSeenAt     DateTime?
  createdAt      DateTime        @default(now())
  updatedAt      DateTime        @updatedAt
  user           User            @relation(fields: [userId], references: [id], onDelete: Restrict)
  pairing        DevicePairing[]
  settings       DeviceSettings?
  chatSessions   ChatSession[]
  chatMessages   ChatMessage[]
  targets        DeliveryTarget[]
  auditEvents    AuditEvent[]
  @@index([userId, status])
}

model DevicePairing {
  id            String        @id @default(uuid())
  userId        String
  deviceId      String?
  codeHash      String
  status        PairingStatus @default(PENDING)
  expiresAt     DateTime
  attemptCount  Int           @default(0)
  maxAttempts   Int           @default(5)
  lastAttemptAt DateTime?
  consumedAt    DateTime?
  invalidatedAt DateTime?
  createdAt     DateTime      @default(now())
  user          User          @relation(fields: [userId], references: [id], onDelete: Cascade)
  device        Device?       @relation(fields: [deviceId], references: [id], onDelete: SetNull)
  @@index([userId, status, expiresAt])
  @@index([codeHash])
}

model UserSettings {
  id                       String         @id @default(uuid())
  userId                   String         @unique
  language                 String         @default("en")
  responseLength           ResponseLength @default(STANDARD)
  automaticMemoryCandidates Boolean       @default(true)
  timezone                 String         @default("Asia/Jakarta")
  createdAt                DateTime       @default(now())
  updatedAt                DateTime       @updatedAt
  user                     User           @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model DeviceSettings {
  id                   String              @id @default(uuid())
  deviceId             String              @unique
  displayName          String?
  defaultDevice        Boolean             @default(false)
  playbackVolume       Int                 @default(80)
  quietHours           Json?
  notificationBehavior NotificationBehavior @default(ALL)
  voiceProfileId       String              @default("prudence")
  speechSpeed          Float               @default(1.0)
  enabled              Boolean             @default(true)
  createdAt            DateTime            @default(now())
  updatedAt            DateTime            @updatedAt
  device               Device              @relation(fields: [deviceId], references: [id], onDelete: Cascade)
}

model ChatSession {
  id         String        @id @default(uuid())
  userId     String
  deviceId   String?
  title      String?
  createdAt  DateTime      @default(now())
  updatedAt  DateTime      @updatedAt
  deletedAt  DateTime?
  user       User          @relation(fields: [userId], references: [id], onDelete: Cascade)
  device     Device?       @relation(fields: [deviceId], references: [id], onDelete: SetNull)
  messages   ChatMessage[]
  @@index([userId, updatedAt])
}

model ChatMessage {
  id         String      @id @default(uuid())
  sessionId  String
  userId     String
  deviceId   String?
  role       ChatRole
  kind       ChatKind
  content    String
  createdAt  DateTime    @default(now())
  deletedAt  DateTime?
  session    ChatSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  user       User        @relation(fields: [userId], references: [id], onDelete: Cascade)
  device     Device?     @relation(fields: [deviceId], references: [id], onDelete: SetNull)
  memories   MemoryRecord[]
  candidates MemoryCandidate[]
  @@index([userId, createdAt])
  @@index([sessionId, createdAt])
}

model MemoryRecord {
  id             String       @id @default(uuid())
  userId         String
  sourceMessageId String?
  type           MemoryType
  topic          String
  content        String
  normalizedKey  String?
  importance     Int          @default(50)
  sensitivityClass String     @default("normal")
  status         MemoryStatus @default(ACTIVE)
  expiresAt      DateTime?
  createdAt      DateTime     @default(now())
  updatedAt      DateTime     @updatedAt
  deletedAt      DateTime?
  user           User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  sourceMessage  ChatMessage? @relation(fields: [sourceMessageId], references: [id], onDelete: SetNull)
  actions        MemoryAction[]
  @@index([userId, type, importance])
  @@index([userId, topic, updatedAt])
  @@index([userId, expiresAt])
}

model MemoryCandidate {
  id             String          @id @default(uuid())
  userId         String
  sourceMessageId String?
  type           MemoryType
  topic          String
  proposedContent String
  rationale      String?
  status         CandidateStatus @default(PENDING)
  createdAt      DateTime        @default(now())
  reviewedAt     DateTime?
  user           User            @relation(fields: [userId], references: [id], onDelete: Cascade)
  sourceMessage  ChatMessage?    @relation(fields: [sourceMessageId], references: [id], onDelete: SetNull)
  actions        MemoryAction[]
  @@index([userId, status, createdAt])
}

model MemoryAction {
  id         String          @id @default(uuid())
  userId     String
  memoryId   String?
  candidateId String?
  action     MemoryActionType
  reason     String?
  createdAt  DateTime        @default(now())
  user       User            @relation(fields: [userId], references: [id], onDelete: Cascade)
  memory     MemoryRecord?   @relation(fields: [memoryId], references: [id], onDelete: SetNull)
  candidate  MemoryCandidate? @relation(fields: [candidateId], references: [id], onDelete: SetNull)
  @@index([userId, createdAt])
}

model MemoryTopicForget {
  id        String   @id @default(uuid())
  userId    String
  topicKey  String
  active    Boolean  @default(true)
  createdAt DateTime @default(now())
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@index([userId, topicKey, active])
}

model DeliveryTarget {
  id         String          @id @default(uuid())
  userId     String
  deviceId   String?
  channel    DeliveryChannel
  enabled    Boolean         @default(true)
  createdAt  DateTime        @default(now())
  user       User            @relation(fields: [userId], references: [id], onDelete: Cascade)
  device     Device?         @relation(fields: [deviceId], references: [id], onDelete: SetNull)
  schedules  Schedule[]
  attempts   ScheduleDeliveryAttempt[]
  @@index([userId, channel, enabled])
}

model Schedule {
  id              String          @id @default(uuid())
  userId          String
  deliveryTargetId String
  name            String
  kind            ScheduleKind
  timezone        String          @default("Asia/Jakarta")
  runAt           DateTime?
  recurrence      Json?
  status          ScheduleStatus  @default(ACTIVE)
  missedRunPolicy MissedRunPolicy @default(SKIP)
  createdAt       DateTime        @default(now())
  updatedAt       DateTime        @updatedAt
  user            User            @relation(fields: [userId], references: [id], onDelete: Cascade)
  target          DeliveryTarget  @relation(fields: [deliveryTargetId], references: [id], onDelete: Restrict)
  runs            ScheduleRun[]
  @@index([userId, status])
}

model ScheduleRun {
  id             String       @id @default(uuid())
  scheduleId     String
  occurrenceKey  String       @unique
  scheduledFor   DateTime
  status         RunStatus    @default(PENDING)
  idempotencyKey String       @unique
  claimedAt      DateTime?
  completedAt    DateTime?
  createdAt      DateTime     @default(now())
  schedule       Schedule     @relation(fields: [scheduleId], references: [id], onDelete: Cascade)
  attempts       ScheduleDeliveryAttempt[]
  @@index([status, scheduledFor])
}

model ScheduleDeliveryAttempt {
  id             String         @id @default(uuid())
  scheduleRunId  String
  targetId       String
  attemptNumber  Int
  idempotencyKey String         @unique
  status         DeliveryStatus @default(PENDING)
  errorCode      String?
  sentAt         DateTime?
  acknowledgedAt DateTime?
  createdAt      DateTime       @default(now())
  run            ScheduleRun    @relation(fields: [scheduleRunId], references: [id], onDelete: Cascade)
  target         DeliveryTarget @relation(fields: [targetId], references: [id], onDelete: Restrict)
  acknowledgement ScheduleAcknowledgement?
  @@unique([scheduleRunId, targetId, attemptNumber])
}

model ScheduleAcknowledgement {
  id         String                 @id @default(uuid())
  attemptId  String                 @unique
  channel    String
  createdAt  DateTime               @default(now())
  attempt    ScheduleDeliveryAttempt @relation(fields: [attemptId], references: [id], onDelete: Cascade)
}

model SpotifyConnection {
  id                    String            @id @default(uuid())
  userId                String            @unique
  providerUserId        String?
  scopes                String
  accessTokenCiphertext String
  refreshTokenCiphertext String
  tokenExpiresAt        DateTime
  keyVersion            String
  status                IntegrationStatus @default(PENDING)
  createdAt             DateTime          @default(now())
  updatedAt             DateTime          @updatedAt
  user                  User              @relation(fields: [userId], references: [id], onDelete: Cascade)
  actions               SpotifyAction[]
}

model SpotifyOAuthState {
  id             String   @id @default(uuid())
  userId         String
  stateHash      String   @unique
  verifierCiphertext String
  redirectUri    String
  expiresAt      DateTime
  consumedAt     DateTime?
  createdAt      DateTime @default(now())
  @@index([userId, expiresAt])
}

model SpotifyAction {
  id             String       @id @default(uuid())
  userId         String
  connectionId   String
  actionType     String
  status         ActionStatus
  idempotencyKey String       @unique
  requestDigest  String
  resultDigest   String?
  createdAt      DateTime     @default(now())
  completedAt    DateTime?
  user           User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  connection     SpotifyConnection @relation(fields: [connectionId], references: [id], onDelete: Cascade)
  @@index([userId, createdAt])
}

model WhatsAppConnection {
  id               String            @id @default(uuid())
  userId           String            @unique
  gatewayAccountRef String?
  status           IntegrationStatus @default(PENDING)
  lastErrorCode    String?
  createdAt        DateTime          @default(now())
  updatedAt        DateTime          @updatedAt
  user             User              @relation(fields: [userId], references: [id], onDelete: Cascade)
  rules            WhatsAppNotificationRule[]
  sends            WhatsAppSendRequest[]
}

model WhatsAppNotificationRule {
  id           String   @id @default(uuid())
  connectionId String
  contactRef   String?
  groupRef     String?
  enabled      Boolean  @default(true)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  connection   WhatsAppConnection @relation(fields: [connectionId], references: [id], onDelete: Cascade)
  @@index([connectionId, enabled])
}

model WhatsAppSendRequest {
  id             String         @id @default(uuid())
  connectionId   String
  recipientRef   String
  messageDigest  String
  confirmation   ActionStatus
  idempotencyKey String         @unique
  expiresAt      DateTime
  createdAt      DateTime       @default(now())
  connection     WhatsAppConnection @relation(fields: [connectionId], references: [id], onDelete: Cascade)
  deliveries     WhatsAppDeliveryEvent[]
}

model WhatsAppDeliveryEvent {
  id        String             @id @default(uuid())
  sendId    String
  status    DeliveryStatus
  errorCode String?
  createdAt DateTime           @default(now())
  send      WhatsAppSendRequest @relation(fields: [sendId], references: [id], onDelete: Cascade)
  @@index([sendId, createdAt])
}

model AuditEvent {
  id         String   @id @default(uuid())
  userId     String?
  deviceId   String?
  actorType  String
  action     String
  resourceType String
  resourceId String?
  metadata   Json?
  createdAt  DateTime @default(now())
  user       User?    @relation(fields: [userId], references: [id], onDelete: SetNull)
  device     Device?  @relation(fields: [deviceId], references: [id], onDelete: SetNull)
  @@index([userId, createdAt])
  @@index([resourceType, resourceId])
}
```

## Schema constraints

- `ChatMessage.content` is text/transcript only; no WAV/MP3 blob or permanent
  audio path is stored.
- Tokens and OAuth verifiers require application-level authenticated
  encryption and key-version metadata. The schema does not make ciphertext
  safe without the key-management boundary.
- PostgreSQL full-text search is the initial memory search mechanism. A
  generated/search document and GIN index may be added in the first migration
  after query plans are reviewed.
- `pgvector` may be provisioned or represented by a future additive migration,
  but no embedding column is required for initial message ingestion. Qdrant is
  not part of this schema.
- `recurrence` is validated by application code against a versioned schedule
  grammar; arbitrary executable expressions are forbidden.
