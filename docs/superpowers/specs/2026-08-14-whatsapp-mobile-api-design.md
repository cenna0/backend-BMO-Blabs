# WhatsApp Mobile Backend Contract Design

**Date:** 2026-08-14
**Scope:** Candidate Backend and the dedicated personal-account WhatsApp bridge
**Status:** Approved by the Phase 2.6 product contract

## Context

The current candidate implementation exposes connection/status, notification
rules, and preview/confirm send routes, but it has no Backend-owned
conversation index. The send route accepts a provider JID, and inbound
notification events do not carry a Joy conversation identity. This prevents a
mobile client from using WhatsApp without learning Hermes/Baileys details.

The Hermes bridge remains the unchanged transport implementation. Its
destructive queue is consumed only by the Backend. Incoming WhatsApp text is
untrusted data and never becomes a Hermes prompt or privileged action.

## Recommended architecture

Add an owner-scoped `WhatsAppConversation` record keyed internally by the
provider chat reference and exposed to mobile only by its UUID. The record
contains a bounded display name, `DM`/`GROUP` type, and `lastActivityAt`.
Inbound events upsert this index before notification evaluation. Outbound
preview/send resolves a conversation UUID to the internal provider reference.
Phone-based recipient resolution creates or reuses a DM conversation server
side; it does not perform full WhatsApp address-book synchronization.

Existing notification-rule and send-preview/send-confirm routes are evolved
instead of duplicated. New list/get/resolve conversation routes are
owner-authenticated. Existing historical raw-reference rows remain internal
and are not returned to mobile; new rules and sends use conversation IDs.

The mobile realtime contract gains a metadata-only
`whatsapp_notification` event containing conversation UUID, safe display name,
conversation type, and timestamp. It does not include message body, JID,
phone number, session path, or provider credentials.

## Data changes

Add `WhatsAppConversationType` (`DM`, `GROUP`) and the
`WhatsAppConversation` model with:

- UUID primary key;
- user/connection/provider ownership relation;
- opaque internal chat reference;
- bounded display name;
- conversation type;
- last activity and audit timestamps;
- owner-scoped uniqueness on connection and opaque chat reference.

Add nullable conversation relations to WhatsApp deliveries and send requests
so the additive migration remains compatible with existing candidate rows.
Raw message bodies are not stored.

## HTTP contract

All routes below require the existing bearer authentication and resolve the
owner from the token, never from request body fields:

```text
GET  /api/v1/integrations/whatsapp/status
POST /api/v1/integrations/whatsapp/disconnect
GET  /api/v1/integrations/whatsapp/conversations?limit=&cursor=
GET  /api/v1/integrations/whatsapp/conversations/:id
POST /api/v1/integrations/whatsapp/conversations/resolve
GET/PATCH /api/v1/integrations/whatsapp/notification-rules
POST /api/v1/integrations/whatsapp/send-preview
POST /api/v1/integrations/whatsapp/send-confirm
```

Conversation responses expose only `id`, `displayName`, `type`,
`notificationEnabled`, and `lastActivityAt`. Resolve accepts a normalized
international phone number and optional display name. Send preview accepts a
conversation ID, bounded message, and idempotency key; raw `recipientRef` is
not a mobile contract.

Notification semantics are application-owned:

- `ALL` is the DM default;
- `CONTACT` overrides one DM by conversation ID;
- `GROUP` is disabled unless explicitly enabled;
- ingestion continues when notification is muted;
- `speakOnDevice` remains a separate generic proactive-delivery option.

## Error and security behavior

Malformed or foreign conversation IDs return the existing bounded ownership
error (`OWNERSHIP_DENIED`, 404). Invalid phone/message/rule input returns
`INVALID_INPUT`, 400. Provider unavailable/send failures remain bounded
provider errors and do not make core health fail. Mobile never receives raw
provider identities or credentials.

The conversation index is user-scoped through both user and connection
ownership. A second WhatsApp owner, foreign conversation, or foreign send
request cannot be resolved. Prompt-injection content is stored neither as a
chat message nor as a Hermes instruction; it can only be transient notification
data when the owner-enabled rule permits.

## Testing and acceptance

Tests must cover authenticated route registration and schemas, list/get/resolve
ownership, inbound conversation upsert for DM and group events, global/contact/
group notification rules, metadata-only mobile events, conversation-scoped
send and echo deduplication, invalid/cross-user IDs, prompt-injection
isolation, the sole `/messages` consumer, and the systemd `[Install]` target.

Live acceptance uses the already-paired personal account through Backend APIs:
known contact notification, authenticated send/reply, muted/unknown contact,
group default suppression, and owner-forward behavior where the official
bridge gate supports it. No direct bridge `/messages` polling is part of
acceptance.

## Deliberate MVP limits

The index is traffic-derived and does not import the complete WhatsApp address
book or history. Media, typing/read receipts, full inbox synchronization, and
WhatsApp audio streaming remain out of scope. The bridge queue remains
in-memory and destructive.
