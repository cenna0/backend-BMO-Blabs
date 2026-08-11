# Entity Relationships — Phase 2 Source Foundation

**Evidence tier:** Prisma schema and unapplied migration source only. The running
candidate and production databases still contain the P9.1 foundation; Slice 2A
did not apply or deploy this graph.

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
and provider session bytes do not become BMO entities.
