# Entity Relationships — Phase 2 Source Foundation

**Evidence tier:** Prisma schema plus disposable PostgreSQL migration evidence.
The running `bmo` candidate and production databases still contain the P9.1
foundation; Slice 2A did not apply or deploy this graph to either runtime.

```text
User
├─ PasswordCredential / AuthIdentity
├─ Session ─ RefreshToken
├─ Device ─ DevicePairing
│          ├─ DeviceSettings
│          ├─ DeviceWifiConfiguration
│          ├─ DeviceTelemetryCurrent
│          └─ DeviceLog
├─ UserSettings / PersonalizationSettings
├─ ChatSession ─ ChatMessage ─ ChatOperation / ChatMessageFeedback
├─ MemoryRecord / MemoryCandidate / MemoryAction / MemoryTopicForget / MemorySummary
├─ Schedule ─ ScheduleRun
├─ ProactiveDelivery ─ DeliveryAttempt
├─ IntegrationConnection / OAuthState
│  ├─ SpotifyCredential / SpotifyAction
│  └─ WhatsAppNotificationRule / WhatsAppSendRequest / WhatsAppDelivery
└─ BugReport ─ BugReportAttachment
```

All 11 P9.1 models and their identifiers/constraints are preserved. The 27 later
models are additive source records. Composite foreign keys enforce the same user
for nullable chat/schedule/delivery device links, chat messages within sessions,
delivery attempts within deliveries, memory candidates linked to messages, and
provider records linked to integration connections. Device-owned telemetry,
Wi-Fi configuration, and logs inherit ownership through `Device`; devices do not
own user chat or memory data. Schedules remain structured records, not memory,
and provider session bytes do not become BMO entities. Spotify and WhatsApp
subtypes are additionally bound through the connection's provider discriminator;
a subtype cannot point at a connection for the other provider.

The disposable gate passed empty deployment, repeat deployment with no pending
migrations, and a populated two-to-three migration upgrade preserving one seeded
row in every P9.1 model. Explicit Prisma relation maps match the 14 deployed
custom foreign-key names, avoiding constraint-name-only introspection drift.
