# Joy Mobile Agent Handoff

> **CURRENT / CANONICAL**
> Backend/VPS code-only pairing is deployed and production-verified. If source
> and docs disagree, source wins; report the mismatch instead of guessing.

## Endpoints and authority

- API base: `https://api.personalbmo.web.id`
- Mobile WSS: `wss://api.personalbmo.web.id/api/v1/ws`
- current P9 router registrations: `93` (the coverage matrix lists all current HTTP routes)
- Mobile WS: initial `authenticate`, `authenticated` acknowledgement, and 11 schema-defined outbound application events

Read in this order:

1. [`00-START-HERE.md`](00-START-HERE.md)
2. [`01-MOBILE-BACKEND-API-CONTRACT.md`](01-MOBILE-BACKEND-API-CONTRACT.md)
3. [`05-IMPLEMENTATION-STATUS.md`](05-IMPLEMENTATION-STATUS.md)
4. [`09-ENDPOINT-EVENT-COVERAGE-MATRIX.md`](09-ENDPOINT-EVENT-COVERAGE-MATRIX.md)

Do not use dated P9 plans, candidate runbooks, old PRDs, or integration files
`04`, `07`, and `10` as current API authority.

## Mobile boundary

Mobile communicates only with Backend. It does not call hardware `/ws`,
Hermes, PostgreSQL, Audio Service, the WhatsApp bridge/resolver, Spotify Web
API, or any provider API directly.

Ordinary pairing is:

```http
POST /api/v1/pairing/claim
Authorization: Bearer <access-token>
Content-Type: application/json

{"code":"123456"}
```

Do not send `pairingId`, `hardwareId`, `deviceName`, `deviceCredential`,
`DEVICE_TOKEN`, or `tokenHash`. `hardwareId` is a non-secret field that may
appear in `SafeDevice`; it is not a pairing input. Hardware credentials never
enter Mobile.

Backend pairing is deployed. Physical display/completion E2E still depends on
ESP firmware and remains `PENDING_PHYSICAL_ESP`.

## Safe implementation order

1. common error envelope, request IDs, auth, refresh, and secure session state;
2. profile/settings/personalization;
3. code-only pairing and device APIs;
4. Mobile WSS authentication, heartbeat, reconnect, and REST recovery;
5. chat/history, memory, schedules, integrations, and diagnostics.

Never expose `/integrations/whatsapp/qr` or
`/integrations/whatsapp/confirm-scanned` in ordinary Mobile UI. For Spotify,
open the server-returned authorization URL and observe completion by polling
`GET /api/v1/integrations/spotify/status`; do not require a WebSocket
`integration_status` event.
