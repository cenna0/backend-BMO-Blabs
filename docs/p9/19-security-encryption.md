# Security and Encryption Architecture

**Status:** `P9.1 LOCKED CONTROLS; P9.2–P9.6 PROPOSED`

## Secret ownership

| Secret/data | Owner | Storage/handling |
|---|---|---|
| App/session signing or encryption key | Backend operator/key boundary | outside Git, rotated by version |
| Device credential verifier | Backend/PostgreSQL | salted hash; raw credential only out-of-band |
| Hermes API key | Backend runtime config | loopback only; never mobile/Hermes prompt |
| Audio internal token | Backend/Audio runtime config | loopback only; never user/API response |
| Spotify client secret/tokens | Backend Spotify adapter | field-level authenticated encryption + key version |
| WhatsApp session | Hermes persistent volume | not copied to PostgreSQL or mobile |
| Database password | PostgreSQL/Backend runtime config | outside Git; least-privilege roles |
| Backup encryption key | operator/key boundary | separate from backup artifact and VPS checkout |

## P9.1 authentication and audit controls

- Registration is invite-only; passwords are hashed with Argon2id.
- Access tokens are short-lived, targeted at approximately 15 minutes.
- Refresh tokens are opaque and cryptographically random; only their hashes
  are stored in PostgreSQL, and rotation/replay handling is server-side.
- Sessions are revocable per authenticated client/device.
- Pairing codes are six-digit, ten-minute, single-use values; only hashes are
  persisted and attempts are rate-limited.
- The server enforces `Asia/Jakarta`; clients cannot change the timezone.

Audit at minimum records login success/failure, session refresh/revocation,
pairing requested/succeeded/failed/expired/revoked, device unpaired, settings
changes, and administrative/security actions.

Never log passwords, raw access/refresh tokens, full expired pairing codes,
OAuth tokens, WhatsApp credentials, or private message contents.

No secret, credential, token, OTP, or raw provider payload belongs in this
documentation branch.

## Controls

- TLS for mobile/provider/public traffic; existing device TLS/WSS requirements
  remain unchanged.
- Session cookies/tokens are short-lived or rotated, server-revocable, and
  stored/transported with secure client policy.
- Every query is user-scoped; ownership is checked in the service layer and
  again at sensitive mutation boundaries.
- Pairing, provider actions, outbound WhatsApp sends, memory deletion, and
  account deletion are rate-limited and audited.
- Secrets and sensitive content are excluded from logs, metrics labels, error
  responses, exports, memory, and Hermes context.
- External provider adapters use least scopes, timeout, retry, circuit-breaker
  behavior, and normalized error codes.
- PostgreSQL is private-only with a dedicated application role; migrations
  run as a separate controlled operator step.
- Backups are encrypted, integrity checked, access logged, and restore-tested.

## Encryption proposal

Use application-level AEAD for provider tokens and other high-risk fields,
with a key identifier/version stored beside ciphertext. The key must be
provided from an operator-controlled secret boundary; storing the key next to
the database backup defeats the control. Key rotation re-encrypts active
records in a transactionally resumable job and preserves the old key only for
the documented recovery window.

Exact library, key service, rotation interval, and deleted-content purge
period are OPEN implementation decisions for P9.6 and must be selected from
maintained, audited dependencies.
