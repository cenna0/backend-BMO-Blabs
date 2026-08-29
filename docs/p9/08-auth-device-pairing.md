# Authentication, Device Identity, and Code-Only Pairing

> **CURRENT / CANONICAL DOMAIN GUIDE**
> The historical four-field Mobile pairing flow is superseded. Current source
> and the canonical integration package are authoritative.

Backend code-only pairing is deployed and production-verified. Physical
firmware implementation and real-device acceptance remain
`PENDING_PHYSICAL_ESP`.

## Mobile claim

```http
POST /api/v1/pairing/claim
Authorization: Bearer <access-token>
Content-Type: application/json

{"code":"123456"}
```

The strict ordinary Mobile claim contains only the six-digit `code`. It does
not accept `pairingId`, `hardwareId`, `deviceName`, `deviceCredential`,
`DEVICE_TOKEN`, or `tokenHash`. A non-secret `hardwareId` may appear later in a
normal `SafeDevice` response, but it is never a Mobile pairing input. Device
name defaults to `Joy`; friendly rename happens through existing settings APIs.

## Trusted hardware enrollment

1. Hardware opens `/ws` and authenticates with its existing `device_id` and
   `device_token`.
2. Authenticated hardware identity establishes the trusted `hardwareId` and
   SHA-256 token digest.
3. Before any Mobile claim, Backend creates a durable `HardwareEnrollment`.
4. Backend sends a six-digit `pairing_code` to the authenticated unbound
   hardware socket.
5. Mobile submits the visible code only; Backend creates the ACTIVE Device from
   trusted enrollment data.

Raw `DEVICE_TOKEN` is not persisted by enrollment and never enters the Mobile
contract. Raw pairing code is not persisted. Backend stores its HMAC-SHA256
digest using the protected pairing pepper. The code TTL is 600 seconds,
single-use, and generic invalid/expired/replaced/replayed outcomes return `409`.

Replacement invalidates the previous issued enrollment/code, and immediate
same-code reissue is rejected. An existing `PENDING` or `ACTIVE` Device for the
hardware blocks new issuance. Partial unique indexes plus a hardware-scoped
database lock make issue/claim concurrency-safe. An expired matching claim
persists `EXPIRED` before returning the generic `409` response.

Mobile claim limits are scoped independently to authenticated user, session,
and request IP. Code-only MVP intentionally has no per-enrollment wrong-code
counter: an arbitrary wrong code cannot safely be attributed to one hardware
enrollment. See decision `INT-067` in
[`../integration/06-DECISION-REGISTER.md`](../integration/06-DECISION-REGISTER.md).

## Hardware protocol and reconnect

Current pairing events are:

- Backend → hardware: `pairing_code`
- hardware → Backend: `pairing_mode_request`
- Backend → hardware: `pairing_completed`

The initial code is issued automatically after successful unbound hardware
authentication. Firmware uses `pairing_mode_request` only for a needed
replacement after expiry/reconnect, with debounce/backoff; Backend enforces a
five-second reissue cooldown and six reissues per 15 minutes.

After claim, the old socket remains unbound. Firmware clears pairing UI,
closes it, and reconnects/re-authenticates with the unchanged hardware
credential. Backend then resolves the ACTIVE Device. If completion was missed
because the old socket disconnected, a bound reconnect may send exactly one
conditional `pairing_mode_request`; Backend responds `pairing_completed`.

Do not begin this physical pairing work until `HW_VPS_CONNECTION_STABLE` is
proven. Existing wakeword/whole-WAV/MP3 voice behavior must remain intact.
