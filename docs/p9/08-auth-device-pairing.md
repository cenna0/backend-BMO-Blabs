# Authentication and Device-Pairing Flow

**Status:** `P9.1 LOCKED`

## Authentication — locked P9.1 contract

1. Registration is invite-only. The invitation is single-use, expiring, and
   stored by hash; registration cannot proceed without a valid invitation.
2. Mobile submits email and password over TLS to Backend. Backend verifies the
   password with Argon2id and never stores or logs the plaintext password.
3. Backend issues a short-lived access token targeted at approximately 15
   minutes plus an opaque cryptographically random refresh token.
4. Only the refresh-token hash is stored in PostgreSQL. Refresh rotates the
   token; reuse/replay revokes the affected token family/session.
5. Mobile calls Backend only over TLS. Backend authorizes every resource from
   the server-side session subject; a client-supplied `user_id` is never
   trusted.
6. Logout, expiry, explicit per-device revocation, suspected compromise, and
   security action revoke server-side session state.

The identity schema remains provider-neutral for future expansion, but P9.1
has no social login or external identity provider. Production email delivery
and password-reset strategy remain OPEN and are not silently added to P9.1.

## Pairing — locked P9.1 contract

```text
Authenticated mobile
  → POST /api/v1/pairing/challenges
  ← six-digit numeric code, valid for 10 minutes
Device presents the code over the existing device channel
  → Backend verifies code, hardware identity, and ownership policy
  → authenticated user claims the device in one transaction
  → transaction creates Device + hashed device credential + audit event
  ← mobile receives device summary, never the stored credential
```

Pairing codes are single-use, valid for 10 minutes, rate-limited, replay-
protected, bound to the authenticated user, and invalidated after consumption,
expiry, or failed-attempt threshold. Generating a new code invalidates the
previous active code. Only a hash is persisted; full expired codes are never
logged. A device already owned by another user cannot be silently claimed.

## Recovery and revocation

- User can revoke a device from mobile; Backend invalidates future device
  authentication while preserving the ownership/audit record.
- Credential rotation issues a new out-of-band device secret and stores only a
  verifier/hash; the old credential is invalidated atomically.
- Lost-device recovery does not require changing Hardware Contract v1.0.5.
- Pairing is an application workflow; it does not alter the current ESP32
  WebSocket event schema.

All pairing lifecycle events are audited: requested, succeeded, failed,
expired, revoked, and device unpaired.

## Proposed API groups

```text
POST   /api/v1/auth/register
POST   /api/v1/auth/login
POST   /api/v1/auth/refresh
POST   /api/v1/auth/logout
POST   /api/v1/auth/sessions/:sessionId/revoke
GET    /api/v1/me
POST   /api/v1/pairing/challenges
POST   /api/v1/pairing/complete
GET    /api/v1/devices
PATCH  /api/v1/devices/:deviceId
POST   /api/v1/devices/:deviceId/rotate-credential
POST   /api/v1/devices/:deviceId/revoke
```

All routes are `PROPOSED`; none exists in the current Backend.
