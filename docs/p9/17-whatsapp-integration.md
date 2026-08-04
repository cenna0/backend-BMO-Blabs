# WhatsApp Integration Boundary

**Status:** `PROPOSED`

The current product direction assigns the WhatsApp gateway and session to
Hermes. P9 preserves that ownership while making Backend the policy and
application boundary.

## Connection flow

```text
Mobile → Backend requests connection/QR state
       → Backend adapter asks Hermes gateway
       → Mobile receives a short-lived, redacted QR/status payload
       → Hermes stores session in its persistent volume
       → Backend stores only connection metadata and audit state
```

Backend never copies raw session bytes into PostgreSQL. Hermes is loopback-only
and its gateway API is not a mobile contract.

## Notification policy

Backend stores enabled/disabled contact and group rules, user consent, quiet
hours, and delivery preferences. Ordinary WhatsApp message content is not
automatically written to chat history or long-term memory. If the user asks
BMO to summarize or remember a message, that is an explicit chat workflow with
normal redaction and memory policy.

## Outbound send-confirmation flow

```text
Hermes/voice/mobile proposes send
  → Backend validates recipient, connection, rule, and user ownership
  → Backend presents a normalized preview
  → user confirms within short expiry
  → Backend creates idempotent send request
  → Hermes gateway sends
  → Backend records delivery result and bounded audit metadata
```

No send occurs from an expired, replayed, ambiguous, or unconfirmed request.
Message body retention is minimized; an audit digest may prove what was sent
without storing the body permanently.

## Recovery

Connection status distinguishes `CONNECTED`, `DISCONNECTED`, `QR_REQUIRED`,
`SESSION_EXPIRED`, and `ERROR`. After Hermes restart, Backend reconciles status
and asks for a new QR only when the session is invalid. Mobile never assumes a
stored QR remains valid.
