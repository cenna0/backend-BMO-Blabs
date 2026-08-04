# Authentication and Device-Pairing Flow

**Status:** `PROPOSED`

## Authentication

1. Mobile starts an approved identity-provider login.
2. Backend verifies the provider assertion server-side, maps the immutable
   provider subject to `AuthIdentity`, and creates a short-lived session plus
   rotating refresh/session material according to the security policy.
3. Mobile calls Backend only over TLS using the session.
4. Backend authorizes every user-owned resource from the session subject; a
   client-supplied `user_id` is never trusted.
5. Session expiry, explicit logout, suspected compromise, and key rotation
   revoke server-side session state.

The existing PRD names Google SSO as the initial identity provider. Provider
configuration and exact SDK are implementation-phase decisions; the Backend
contract is provider-neutral.

## Pairing

```text
Authenticated mobile
  → POST /api/v1/pairing/challenges
  ← one-time challenge display/QR payload (short TTL)
Device presents challenge over existing authenticated device channel
  → Backend verifies challenge, hardware identity, and ownership policy
  → transaction creates Device + hashed device credential + audit event
  ← mobile receives device summary, never the stored credential
```

Pairing challenges are single-use, short-lived, rate-limited, bound to the
requesting user, and invalidated after consumption, expiry, logout, or failed
attempt threshold. A device already owned by another user cannot be silently
claimed.

## Recovery and revocation

- User can revoke a device from mobile; Backend invalidates future device
  authentication while preserving the ownership/audit record.
- Credential rotation issues a new out-of-band device secret and stores only a
  verifier/hash; the old credential is invalidated atomically.
- Lost-device recovery does not require changing Hardware Contract v1.0.5.
- Pairing is an application workflow; it does not alter the current ESP32
  WebSocket event schema.

## Proposed API groups

```text
POST   /api/v1/auth/provider/callback
POST   /api/v1/auth/refresh
POST   /api/v1/auth/logout
GET    /api/v1/me
POST   /api/v1/pairing/challenges
POST   /api/v1/pairing/complete
GET    /api/v1/devices
PATCH  /api/v1/devices/:deviceId
POST   /api/v1/devices/:deviceId/rotate-credential
POST   /api/v1/devices/:deviceId/revoke
```

All routes are `PROPOSED`; none exists in the current Backend.
