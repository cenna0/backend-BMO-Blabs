# Entity Relationships — Frozen Conceptual Model

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
├─ ChatSession ─ ChatMessage ─ ChatMessageFeedback
├─ MemoryRecord / MemoryCandidate / MemoryAction / MemoryTopicForget
├─ Schedule ─ ScheduleRun
├─ ProactiveDelivery ─ DeliveryAttempt
├─ IntegrationConnection
│  ├─ SpotifyCredential / SpotifyAction
│  └─ WhatsAppNotificationRule / WhatsAppSendRequest / WhatsAppDelivery
└─ BugReport
```

Existing P9.1 models are the first two identity/device/settings layers. All later nodes are additive targets. Chat messages may reference source devices and delivery records, but devices do not own user data. Schedules are structured records, not memory. Provider session bytes do not become BMO entities.
