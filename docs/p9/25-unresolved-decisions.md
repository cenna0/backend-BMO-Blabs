# Unresolved Decisions and External Gates

These do not change approved scope; they block only the named acceptance or require a bounded implementation choice.

| Gate/decision | State | Owner / required evidence |
|---|---|---|
| Prisma Studio `*:5555` exposure | `BLOCKED` | Operations: stop it and prove listeners/firewall |
| Actual Hermes WhatsApp API/session/persistence/version | `BLOCKED` | Hermes/operations: sanitized local contract and working session evidence |
| Spotify app credentials and callback registration | `BLOCKED` | Provider/operator: exact registered URI and secret availability |
| First-boot Wi-Fi bootstrap | `PENDING_PHYSICAL_ESP` | Hardware product/firmware decision and bench evidence |
| Battery sensing capability | `PENDING_PHYSICAL_ESP` | Hardware measurement evidence; backend remains nullable |
| Additive events/settings/proactive playback | `PENDING_PHYSICAL_ESP` | Firmware source/build and real-device acceptance |
| Off-VPS backup destination/key custody | `BLOCKED` for final production sign-off | Operations decision and restore evidence |
| Chat/memory default retention and legal audit floor | `BLOCKED` for final privacy acceptance | Product/privacy decision |
| Memory candidate default/sensitive-content policy | `BLOCKED` for automatic candidate activation | Product/privacy decision |
| Schedule recurrence grammar, missed-run/retry defaults | `BLOCKED` for scheduler acceptance | Product/software decision before slice implementation |
| Application AEAD library/key rotation mechanism | `BLOCKED` for secret-bearing storage | Security/operations implementation decision |
| Exact single-VPS resource caps | `BLOCKED` for final rollout | Candidate mixed-load evidence |

Closed by the Phase 1 freeze: self-service registration, DOB recovery route shape, server-side Spotify authorization-code flow, separate mobile WSS, generic proactive events, device-binding rule, and status vocabulary.
