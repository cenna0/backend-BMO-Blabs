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

## Physical identity bridge

The current `/ws` and voice HTTP auth remains config-based. After it succeeds, owner-only device capabilities resolve only when:

```text
Device.status == ACTIVE
Device.hardwareId == authenticated device_id
Device.tokenHash == SHA-256(authenticated device_token)
```

If no row matches, keep valid legacy voice working but deny owner-specific Wi-Fi/settings/telemetry/proactive operations. Do not silently rotate credentials during binding. Physical pairing proof is `PENDING_PHYSICAL_ESP`.
