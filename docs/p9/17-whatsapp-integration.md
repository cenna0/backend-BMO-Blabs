# WhatsApp Integration

> **HISTORICAL PROVIDER/CANDIDATE CHECKPOINT — NOT CURRENT MOBILE AUTHORITY**
> Current Mobile routes and provider boundaries are in integration `01`, `05`,
> and `09`. Do not execute operator/provider actions from this record.

**Joy adapter/API:** `SOURCE_VERIFIED` against the Hermes 0.20.0 bridge contract
**Dedicated transport runtime:** `SOURCE_VERIFIED` in repository; not installed or started
**Live candidate provider:** `BLOCKED_OPERATOR` pending protected configuration and QR pairing

The installed Hermes CLI/runtime reports WhatsApp pairing support and gateway
platform support. The upstream Hermes 0.20.0 WhatsApp plugin/bridge contract
defines a loopback HTTP bridge with `GET /health`, destructive queue polling via
`GET /messages`, and outbound `POST /send`. Joy implements only those verified
routes through `HermesWhatsAppBridgeClient`; it does not start, configure, or
replace the Hermes gateway. The dedicated bridge is launched from the unchanged
official `bridge.js` in `bot` transport mode with the user's personal paired
account; `WHATSAPP_ENABLED=false` remains enforced so `hermes-gateway.service`
never consumes this queue. The word `bot` describes bridge dispatch semantics,
not a second number or a Joy-owned identity.

Candidate configuration is `WHATSAPP_BRIDGE_URL=http://127.0.0.1:3001` so the
Hermes bridge cannot collide with the production Backend on port 3000. The
bridge must remain loopback-only. The installed service account's protected
configuration/session contents were not read or modified; the sanitized
inspection found no WhatsApp session directory and no live bridge listener.
The repository unit is `ops/whatsapp/systemd/joy-whatsapp-bridge.service` and
its launcher is `ops/whatsapp/joy-whatsapp-bridge-launcher`; neither has been
installed or started. Bridge stdout/stderr are discarded because official
startup output can include configured provider identities. Health is checked through
loopback `/health`; systemd active/exit/restart state supplies crash
observability. Temporary provider disconnects stay under bridge.js's internal
reconnect loop and do not trigger a second supervisor reconnect loop.

Frozen ownership:

- Hermes/provider owns the personal WhatsApp session and transport state.
- Backend owns the mobile API, one-owner binding, notification/contact/group
  rules, outbound confirmation, idempotency, delivery state, retention policy,
  and audit. Transport intake and notification filtering are separate.
- The launcher uses official `WHATSAPP_DM_POLICY=pairing` only to admit contact
  events to the private queue. An optional protected non-wildcard
  `WHATSAPP_ALLOWED_USERS` value is passed only to the official owner-forward
  gate; it is not a Backend notification list. Empty means manual owner
  forwarding is disabled. Wildcard identity and the Hermes gateway adapter are
  never enabled. Backend rules are the application authorization boundary for
  notifications and actions.
- `event.isGroup === true` is classified by Backend and persisted only as
  bounded routing metadata. Groups are notification-denied by default and can
  be explicitly enabled by an owner-owned `GROUP` rule. Group content never
  becomes a Hermes prompt or privileged tool request. `WHATSAPP_GROUP_POLICY`
  is not the enforcement layer for this design.
- Backend is the only `/messages` consumer. The dedicated bridge exposes the
  verified `/health`, `/messages`, and `/send` boundary; it never polls its
  own queue or invokes Hermes gateway reasoning.
- PostgreSQL never stores raw Hermes session bytes.
- Mobile never calls Hermes directly.

Outbound send requires a normalized preview, short-lived confirmation, ownership/rule validation, idempotent request, and bounded delivery result. Ordinary incoming/outgoing WhatsApp content is not chat history or memory; explicit user summarize/remember requests re-enter normal chat/redaction policy.

The Joy connect/status/send boundary now health-checks the existing bridge,
normalizes bounded provider fields, rejects non-loopback bridge URLs, requires a
WhatsApp JID for outbound delivery, and never returns provider response bodies.
`/qr` remains fail-closed because Hermes owns the QR flow; pairing is performed
with the supported `hermes whatsapp` command. A Joy disconnect changes Joy
metadata only and does not delete or overwrite the Hermes session.

Incoming events have a real producer: the candidate worker polls `/messages`,
requires exactly one connected Joy WhatsApp owner, deduplicates by provider
message ID, persists only bounded routing metadata/body length, and applies
owner-owned notification rules. Contact DM content is untrusted data: it is
never passed to Hermes reasoning or privileged tools. Owner-typed messages
forwarded by the official `WHATSAPP_FORWARD_OWNER_MESSAGES=true` behavior are
recorded as bounded metadata only and do not create a notification or proactive
delivery. Official forwarding is available only for chats in the protected
owner-forward gate; ordinary `/send` echoes remain suppressed. Ambiguous
multi-owner state is dropped closed.

The existing owner-scoped routes remain fail-closed through the injected boundary.
No Hermes session bytes or raw inbound WhatsApp content are stored in
PostgreSQL. An enabled contact/group rule emits a bounded generic mobile
notification; an enabled `speakOnDevice` rule additionally creates the generic
`WHATSAPP` proactive-delivery job. Actual text-to-speech/physical playback
remains `PENDING_PHYSICAL_ESP` until real device evidence exists. Retention of
full WhatsApp history is intentionally not part of this MVP contract.

Official references: [Hermes WhatsApp guide](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/messaging/whatsapp.md),
[WhatsApp adapter](https://github.com/NousResearch/hermes-agent/blob/main/plugins/platforms/whatsapp/adapter.py),
and [bridge source](https://github.com/NousResearch/hermes-agent/blob/main/scripts/whatsapp-bridge/bridge.js).

Operator checkpoint: after reviewing the repository unit, pair the user's
personal WhatsApp account with the supported `hermes whatsapp` CLI, force
`WHATSAPP_ENABLED=false`, then install/start only the dedicated unit. Report
only sanitized connection status; never send QR output, session directory
contents, session files, provider tokens, phone/JID identities, or provider
message payloads.
