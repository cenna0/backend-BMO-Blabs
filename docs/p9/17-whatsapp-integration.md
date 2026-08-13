# WhatsApp Integration

**BMO adapter/API:** `BLOCKED_OPERATOR` pending protected installed-Hermes runtime inspection
**Live provider:** `BLOCKED_OPERATOR` pending exact Hermes bridge/session boundary and QR pairing

The official Hermes documentation confirms a Baileys WhatsApp bridge and Hermes-owned session directory, but it does not define a generic HTTP WhatsApp send/receive API. The installed Hermes package/configuration is owned by `hermes` and unreadable to the current operator account. BMO must not invent an adapter from the documented CLI alone. A concrete adapter and incoming-event producer may be implemented only after the exact installed runtime boundary is inspected.

Frozen ownership:

- Hermes/provider owns WhatsApp session and provider conversation state.
- Backend owns mobile API, connection metadata, notification/contact/group rules, consent/quiet hours, outbound confirmation, idempotency, delivery state, and audit.
- PostgreSQL never stores raw Hermes session bytes.
- Mobile never calls Hermes directly.

Outbound send requires a normalized preview, short-lived confirmation, ownership/rule validation, idempotent request, and bounded delivery result. Ordinary incoming/outgoing WhatsApp content is not chat history or memory; explicit user summarize/remember requests re-enter normal chat/redaction policy.

The QR/connect/status route family is a target contract only. Phase 2 must first prove the actual Hermes API boundary before implementing an adapter against it.

The existing owner-scoped routes remain fail-closed through the injected boundary.
No Hermes session bytes or raw WhatsApp content are stored in PostgreSQL or
returned to mobile. Incoming notification speech must use the generic
`WHATSAPP` proactive-delivery source and remains `PENDING_PHYSICAL_ESP` until
real device evidence exists.

Operator checkpoint: exact installed runtime inspection must be performed with
the `hermes` service account. Report only sanitized command/API shape and
permissions; never send the gateway API key, QR, session directory contents,
session files, or provider message payloads.
