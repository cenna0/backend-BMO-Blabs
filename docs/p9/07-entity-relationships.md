# P9 Entity Relationships

**Status:** `P9.1 LOCKED RELATIONSHIPS; P9.2–P9.6 PROPOSED`

```text
User
├── Invitation, PasswordCredential, AuthIdentity
├── Session ── RefreshToken
├── Device ── DevicePairing, DeviceSettings
├── UserSettings
├── ChatSession ── ChatMessage
│                  ├── MemoryCandidate
│                  └── MemoryRecord
├── MemoryAction, MemoryTopicForget
├── Schedule ── ScheduleRun ── ScheduleDeliveryAttempt ── Acknowledgement
│      └── DeliveryTarget ── Device or Mobile
├── SpotifyConnection ── SpotifyAction
├── WhatsAppConnection ── NotificationRule
│                        └── SendRequest ── DeliveryEvent
└── AuditEvent
```

## Cardinality and invariants

| Relationship | Invariant |
|---|---|
| Invitation → User | invite-only registration; token is single-use, expiring, and stored only by hash |
| User → PasswordCredential | one Argon2id credential; plaintext password is never persisted or logged |
| User → Session | sessions are revocable per authenticated client/device; access tokens are not durable records |
| Session → RefreshToken | opaque refresh tokens rotate; only token hashes persist and replay revokes the family |
| User → Device | one initial owner per device; transfer requires explicit pairing/revocation flow |
| User → DevicePairing | six-digit code, ten-minute TTL, single use; new active code invalidates the previous one |
| User → UserSettings | language, response length, automatic candidates, and server-enforced `Asia/Jakarta` |
| Device → DeviceSettings | display/default flag, volume, quiet hours, notifications, Prudence, and speech speed |
| User → ChatSession | sessions are user-scoped; device is optional metadata |
| ChatSession → ChatMessage | append-only logical history; deletion is explicit and audited |
| ChatMessage → MemoryCandidate | candidate may cite one source message; no candidate means no automatic memory |
| MemoryRecord → MemoryAction | every mutation is attributable to a user or policy action |
| User → Schedule | schedule cannot execute without an enabled target and server-enforced `Asia/Jakarta` |
| Schedule → ScheduleRun | `occurrenceKey` makes one logical occurrence unique |
| ScheduleRun → DeliveryAttempt | each target/attempt number is unique and idempotent |
| User → SpotifyConnection | one active connection initially; reconnect replaces after revoke/rotate |
| User → WhatsAppConnection | one gateway connection initially; session bytes remain Hermes-owned |
| Any entity → AuditEvent | security-sensitive creation, mutation, delivery, and deletion is recorded |

## Deletion graph

User deletion is a controlled workflow, not an unrestricted cascade. It first
revokes sessions and provider connections, disables device delivery, cancels
future schedules, exports or irreversibly deletes chat/memory according to the
confirmed request, and retains only the minimum legally/operationally required
audit record. The exact retention duration is an OPEN policy decision.
