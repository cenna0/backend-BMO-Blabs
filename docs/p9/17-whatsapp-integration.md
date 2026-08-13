# WhatsApp Integration

**BMO adapter/API:** `SOURCE_VERIFIED` against the Hermes 0.20.0 bridge contract
**Dedicated transport runtime:** `SOURCE_VERIFIED` in repository; not installed or started
**Live candidate provider:** `BLOCKED_OPERATOR` pending protected configuration and QR pairing

The installed Hermes CLI/runtime reports WhatsApp pairing support and gateway
platform support. The upstream Hermes 0.20.0 WhatsApp plugin/bridge contract
defines a loopback HTTP bridge with `GET /health`, destructive queue polling via
`GET /messages`, and outbound `POST /send`. BMO implements only those verified
routes through `HermesWhatsAppBridgeClient`; it does not start, configure, or
replace the Hermes gateway. The dedicated bridge is launched from the unchanged
official `bridge.js` in bot mode; `WHATSAPP_ENABLED=false` remains enforced so
`hermes-gateway.service` never consumes this queue.

Candidate configuration is `WHATSAPP_BRIDGE_URL=http://127.0.0.1:3001` so the
Hermes bridge cannot collide with the production Backend on port 3000. The
bridge must remain loopback-only. The installed service account's protected
configuration/session contents were not read or modified; the sanitized
inspection found no WhatsApp session directory and no live bridge listener.
The repository unit is `ops/whatsapp/systemd/bmo-whatsapp-bridge.service` and
its launcher is `ops/whatsapp/bmo-whatsapp-bridge-launcher`; neither has been
installed or started. Bridge stdout/stderr are discarded because official
startup output includes the configured allowlist. Health is checked through
loopback `/health`; systemd active/exit/restart state supplies crash
observability. Temporary provider disconnects stay under bridge.js's internal
reconnect loop and do not trigger a second supervisor reconnect loop.

Frozen ownership:

- Hermes/provider owns WhatsApp session and provider conversation state.
- Backend owns mobile API, connection metadata, notification/contact/group rules, consent/quiet hours, outbound confirmation, idempotency, delivery state, and audit.
- The official bridge and Backend both require a protected, exact
  `WHATSAPP_ALLOWED_USERS` list; Backend additionally fails closed when the
  list is empty and rejects unauthorized DMs before BMO intake. Hermes may
  match a phone allowlist through its protected LID mapping; if the bridge
  emits a LID sender identifier, the corresponding normalized identifier must
  also be present in the protected Backend list.
- `event.isGroup === true` is an authoritative Backend drop before owner
  lookup, duplicate lookup, persistence, notification evaluation, Hermes
  reasoning, or proactive delivery. `WHATSAPP_GROUP_POLICY=disabled` is only
  documentation/future gateway compatibility, not this security control.
- Backend is the only `/messages` consumer. The dedicated bridge exposes the
  verified `/health`, `/messages`, and `/send` boundary; it never polls its
  own queue or invokes Hermes gateway reasoning.
- PostgreSQL never stores raw Hermes session bytes.
- Mobile never calls Hermes directly.

Outbound send requires a normalized preview, short-lived confirmation, ownership/rule validation, idempotent request, and bounded delivery result. Ordinary incoming/outgoing WhatsApp content is not chat history or memory; explicit user summarize/remember requests re-enter normal chat/redaction policy.

The BMO connect/status/send boundary now health-checks the existing bridge,
normalizes bounded provider fields, rejects non-loopback bridge URLs, requires a
WhatsApp JID for outbound delivery, and never returns provider response bodies.
`/qr` remains fail-closed because Hermes owns the QR flow; pairing is performed
with the supported `hermes whatsapp` command. A BMO disconnect changes BMO
metadata only and does not delete or overwrite the Hermes session.

Incoming events have a real producer: the candidate worker polls `/messages`,
requires exactly one connected BMO WhatsApp owner, deduplicates by provider
message ID, persists only bounded routing metadata/body length, and passes the
message to the authenticated owner boundary. Group events are dropped before
all of those side effects, even when the sender is allowlisted. Contact rules
must match the provider sender identifier. Ambiguous multi-owner state is
dropped closed.

The existing owner-scoped routes remain fail-closed through the injected boundary.
No Hermes session bytes or raw inbound WhatsApp content are stored in
PostgreSQL or returned to mobile. When an enabled notification rule and active
device match, BMO creates the generic `WHATSAPP` proactive-delivery job; actual
text-to-speech/physical playback remains `PENDING_PHYSICAL_ESP` until real
device evidence exists.

Official references: [Hermes WhatsApp guide](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/messaging/whatsapp.md),
[WhatsApp adapter](https://github.com/NousResearch/hermes-agent/blob/main/plugins/platforms/whatsapp/adapter.py),
and [bridge source](https://github.com/NousResearch/hermes-agent/blob/main/scripts/whatsapp-bridge/bridge.js).

Operator checkpoint: after reviewing the repository unit, install the dedicated
unit, provision the protected exact sender list in both Hermes and candidate
Backend configuration, and complete the supported QR pairing. Report only
sanitized connection status; never send the gateway API key, QR, session
directory contents, session files, provider tokens, sender identities, or
provider message payloads.
