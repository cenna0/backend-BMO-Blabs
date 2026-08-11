# WhatsApp Integration

**BMO adapter/API:** `READY_TO_IMPLEMENT`
**Live provider:** `BLOCKED`

The audited Hermes version/documentation is WhatsApp-capable, but Phase 1 did not prove a configured BMO session, exact gateway API/version, persistence path, or credentials. Capability is not acceptance.

Frozen ownership:

- Hermes/provider owns WhatsApp session and provider conversation state.
- Backend owns mobile API, connection metadata, notification/contact/group rules, consent/quiet hours, outbound confirmation, idempotency, delivery state, and audit.
- PostgreSQL never stores raw Hermes session bytes.
- Mobile never calls Hermes directly.

Outbound send requires a normalized preview, short-lived confirmation, ownership/rule validation, idempotent request, and bounded delivery result. Ordinary incoming/outgoing WhatsApp content is not chat history or memory; explicit user summarize/remember requests re-enter normal chat/redaction policy.

The QR/connect/status route family is a target contract only. Phase 2 must first prove the actual Hermes API boundary before implementing an adapter against it.
