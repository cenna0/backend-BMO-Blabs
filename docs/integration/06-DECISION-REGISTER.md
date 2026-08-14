# Integration Decision Register

**Frozen:** 2026-08-11

| ID | Decision | Reason / consequence |
|---|---|---|
| INT-001 | One production Backend API service owns mobile and device application APIs. | Avoid a second source of business truth. |
| INT-002 | Device WSS `/ws` and mobile WSS `/api/v1/ws` are different contracts. | Authentication, payload limits, reconnect, and consumers differ. |
| INT-003 | PostgreSQL is the durable application source of truth. | Hermes is an execution/provider boundary, not BMO persistence. |
| INT-004 | Existing physical voice transport is frozen: device `/ws`, whole raw WAV HTTP, MP3 HTTP. | Backward compatibility is mandatory. |
| INT-005 | Registration becomes self-service; existing password hashing/session rotation remains the baseline. | Approved product scope. |
| INT-006 | DOB recovery is a dedicated audited workflow, not a plaintext DOB lookup. | Reduce enumeration/replay risk. |
| INT-007 | Wi-Fi credentials are written to VPS DB encrypted at rest, queued to ESP, and never returned in plaintext. | Backend owns desired state; ESP owns application. |
| INT-008 | First-boot Wi-Fi bootstrap is not solved by the VPS. | A disconnected ESP cannot receive a remote DB command. |
| INT-009 | Proactive delivery uses one generic backend queue/event family. | Chat, schedule, and WhatsApp share delivery mechanics. |
| INT-010 | Battery telemetry is nullable and capability-gated. | Hardware measurement support is not proven. |
| INT-011 | Spotify tokens stay server-side and use Authorization Code callback/state. | Backend is a confidential server client. |
| INT-012 | WhatsApp conversations remain in the provider/Hermes boundary; BMO stores linkage, rules, deliveries, and audit metadata. | Avoid duplicating provider session ownership. |
| INT-013 | Migrations are additive where practical; Phase 1 runs no production migration. | Preserve P9.1 data and rollback safety. |
| INT-014 | Historical evidence and the locked PRD v1.2.4 remain byte-stable. | Current corrections belong in current canonical docs, not past evidence. |
| INT-041 | Freeze status vocabulary is exactly `EXISTING_VERIFIED`, `READY_TO_IMPLEMENT`, `PENDING_PHYSICAL_ESP`, `BLOCKED`, `DEFERRED`. | Availability/evidence tier is recorded separately. |
| INT-042 | P9.1 source and private candidate are existing; production activation is not. | Prevent “implemented” from being mistaken for public. |
| INT-043 | Owner binding requires active `Device.hardwareId == device_id` and `Device.tokenHash == SHA-256(device_token)`. | Reuses the issued credential without exposing it. |
| INT-044 | Current pairing claim is a mobile-bearer call with pairing ID, code, hardware ID, name, and out-of-band device credential. The ESP does not claim through `/ws`. | Matches registered source behavior. |
| INT-045 | Schedule durable lifecycle is `ACTIVE/PAUSED/CANCELLED/COMPLETED`; UI labels such as `MONITORING` and `WEEKLY` are presentation labels. | Avoid state-model ambiguity. |
| INT-046 | A WhatsApp-capable Hermes release is not proof that a BMO WhatsApp session is configured. | Live acceptance stays blocked pending evidence. |
| INT-050 | Dedicated WhatsApp transport runs the unchanged Hermes Baileys bridge separately from `hermes-gateway.service`; BMO alone consumes `/messages`, owns notification/action authorization, and keeps incoming text out of Hermes privileged paths. | Prevent destructive queue races and unrestricted inbound Hermes access. |
| INT-051 | WhatsApp is a personal-account connector. Official `--mode bot` is retained only because it admits contact events; `WHATSAPP_DM_POLICY=pairing` feeds the private queue, while `WHATSAPP_ENABLED=false` prevents the shared Hermes gateway adapter from consuming it. Backend uses `ALL`/`CONTACT`/explicit `GROUP` rules for notification filtering, with groups denied by default. | Separate transport ingestion from product identity, notification policy, and privileged BMO actions. |
| INT-052 (supersedes INT-012) | BMO owns a traffic-derived, owner-scoped WhatsApp conversation/contact index and exposes only BMO conversation UUIDs to Mobile. Provider chat references remain server-side; inbound content is untrusted data and notification filtering is application state. | Finalize the personal-account Mobile contract without importing a full address book or exposing Baileys identities. |
| INT-053 | The dedicated bridge queue is in-memory and destructive. Candidate acceptance must not claim durable/replayable WhatsApp delivery; the Backend must deduplicate observed provider message references where available. | Make the official bridge delivery-durability limitation explicit. |
| INT-054 | WhatsApp provider identity reconciliation is server-side and alias-based. Backend records explicit DM `chatId`/`senderId` aliases, preserves the rule-bearing BMO conversation during deterministic duplicate merges, and never links a phone identity to a LID using names or message text. | Baileys/WhatsApp may emit a phone JID and an opaque LID for one contact; the installed bridge's observed LID-only event has no safe cross-identifier evidence, so unresolved links remain conservative until an explicit provider/operator mapping exists. |
| INT-055 | V2 identity reconciliation treats the provider identity relationship as a prerequisite, not an inference. A phone-JID resolve plus a LID-only inbound event remains unlinked; an event or operator action that explicitly associates both provider references attaches the aliases before conversation creation/merge. | Hermes 0.20.0's unchanged bridge emits `chatId`/`senderId` but does not expose its internal LID-to-phone map in `/messages`; automatic first-event linking is therefore not safely implementable in Backend alone. |
| INT-047 | Prisma Studio on `*:5555` is a security blocker and is not part of declared production architecture. | Close before Phase 2/deploy. |
| INT-048 | `docs/product/BMO-BY-BLABS-PRD-v1.4.0.md` is the current integration PRD; v1.2.4 remains the locked historical product baseline. | Keeps verifier-protected history intact. |

Decisions may be superseded only by a new dated entry that states the old ID, migration/compatibility impact, and evidence required. Do not silently rewrite these rows.
