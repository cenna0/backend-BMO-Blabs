# Authentication, Device Identity, and Pairing

## Existing private candidate

- Registration requires `invitationToken`, email, password of at least 12 characters, and optional display name.
- Passwords use Argon2id (`m=19456`, `t=3`, `p=1`); access JWT is HS256 with 15-minute lifetime, issuer `bmo-p9`, audience `bmo-mobile`.
- Opaque 30-day refresh tokens are stored by hash, rotate on use, and revoke their family on replay. Logout and logout-all exist.
- Six-digit pairing has 600-second TTL, five-attempt maximum, keyed HMAC digest, single use, and active-challenge invalidation.
- Every pairing route requires mobile bearer auth. Claim body is `code`, `hardwareId`, `deviceName`, and an out-of-band `deviceCredential`; the ESP does not claim on `/ws`.

## Approved target

- Make registration self-service and add DOB recovery with uniform responses, strong rate limiting, single-use recovery token, audit, and session-family revocation after reset.
- Add username/profile/avatar without exposing DOB or credential fields.
- Complete client-device session binding before claiming per-device mobile revocation.
- Preserve current pairing code semantics and route shapes.

## Phase 2 Slice 2B source evidence

- Registration is self-service with normalized email, password minimum 12,
  optional bounded display name, and required exact non-future calendar DOB.
  Optional valid invitations remain consumable for legacy clients and operator
  tooling remains intact. Argon2id/session behavior is unchanged.
- Canonical `SafeUser` now contains nullable normalized username and a public
  opaque avatar URL, never DOB. Profile updates use only the authenticated user
  ID and sanitize uniqueness conflicts.
- Recovery verification gives unknown email and wrong DOB the same public
  error, uses independent one-hop-proxy-aware IP and normalized-email limits,
  stores only a SHA-256 verifier, and expires at 600 seconds. Reset claims the
  verifier once inside the credential/session transaction, replaces the
  Argon2id hash, and revokes every session and refresh token.
- These are source/automated-test facts only. The running private candidate
  remains invitation-era/unmigrated and public production is unchanged.

## Physical identity bridge

The current `/ws` and voice HTTP auth remains config-based. After it succeeds, owner-only device capabilities resolve only when:

```text
Device.status == ACTIVE
Device.hardwareId == authenticated device_id
Device.tokenHash == SHA-256(authenticated device_token)
```

If no row matches, keep valid legacy voice working but deny owner-specific Wi-Fi/settings/telemetry/proactive operations. Do not silently rotate credentials during binding. Physical pairing proof is `PENDING_PHYSICAL_ESP`.

## Phase 2 Slice 1 evidence

- Optional `clientDeviceId` token issuance now queries `Device` with the
  authenticated user ID and `ACTIVE` state before persisting the session
  binding. Issuance runs in a transaction under the same per-user advisory lock
  as unpair; registration reuses its open transaction and sessions issued before
  pairing remain nullable.
- Device `/ws` resolves `hardwareId` plus a timing-safe comparison of the stored
  SHA-256 verifier after the unchanged runtime credential succeeds. Before any
  owner-specific use, the only server authorization accessor revalidates exact
  device/user/hardware identity plus `ACTIVE` state and clears invalid cache.
- Unit/integration tests cover owner rejection, token mismatch, successful
  binding, post-bind revocation, delayed-resolver stale binding, and unbound
  legacy voice continuity. This is source evidence, not public production or
  physical pairing evidence.
