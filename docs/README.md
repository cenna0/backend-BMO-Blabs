# BMO Documentation — Current Entry Point

**Last audited:** 2026-08-18
**Current milestone:** P9 production is promoted and the Mobile integration package is current.

## Current Mobile reading order

1. [`integration/00-START-HERE.md`](integration/00-START-HERE.md)
2. [`integration/01-MOBILE-BACKEND-API-CONTRACT.md`](integration/01-MOBILE-BACKEND-API-CONTRACT.md)
3. [`integration/05-IMPLEMENTATION-STATUS.md`](integration/05-IMPLEMENTATION-STATUS.md)
4. [`integration/09-ENDPOINT-EVENT-COVERAGE-MATRIX.md`](integration/09-ENDPOINT-EVENT-COVERAGE-MATRIX.md)

[`NEXT-ACTION.md`](NEXT-ACTION.md) records the current Mobile executable
boundary. It is not a substitute for the four-document contract package.

Current production endpoints are:

- API: `https://api.personalbmo.web.id`
- Mobile WebSocket: `wss://api.personalbmo.web.id/api/v1/ws`
- Hardware WebSocket: `wss://api.personalbmo.web.id/ws`

## Historical and supporting records

The current integration PRD is [`product/BMO-BY-BLABS-PRD-v1.4.0.md`](product/BMO-BY-BLABS-PRD-v1.4.0.md). The domain architecture is [`p9/README.md`](p9/README.md). Existing runtime authority is [`backend-mvp/CURRENT-RUNTIME-CONFIG.md`](backend-mvp/CURRENT-RUNTIME-CONFIG.md), and existing physical voice authority is [`hardware-contract/BMO-MVP-HW-INTERFACE-CONTRACT-v1.0.5.md`](hardware-contract/BMO-MVP-HW-INTERFACE-CONTRACT-v1.0.5.md).

[`integration/04-VPS-IMPLEMENTATION-PLAN.md`](integration/04-VPS-IMPLEMENTATION-PLAN.md), [`integration/07-ONE-SHOT-AGENT-PROMPT.md`](integration/07-ONE-SHOT-AGENT-PROMPT.md), and [`integration/10-OPERATOR-PROMPT-RUNBOOK.md`](integration/10-OPERATOR-PROMPT-RUNBOOK.md) are `COMPLETED / HISTORICAL` operator evidence. They are not mandatory Mobile onboarding.

Historical phase records such as [`roadmap/P8-EXECUTION-SPEC.md`](roadmap/P8-EXECUTION-SPEC.md), [`roadmap/P6-EXECUTION-SPEC.md`](roadmap/P6-EXECUTION-SPEC.md), P9.1 evidence/review, and [`product/BMO-BY-BLABS-PRD-v1.2.4.md`](product/BMO-BY-BLABS-PRD-v1.2.4.md) remain immutable evidence for their time. They are not the current integration requirement.

## Source-of-truth order

1. Actual registered source, Prisma migration history, and inspected runtime establish current facts.
2. Hardware contract v1.0.5 owns existing device voice protocol.
3. Integration `00`, `01`, `02`, `05`, `06`, `08`, and `09` plus PRD v1.4.0 own the approved target.
4. Current P9 docs own domain architecture, source-of-truth, and conceptual schema.
5. Runtime config owns deployed STT/TTS values.
6. Historical evidence describes only its recorded checkpoint.

## Audited current boundary

- P7 is `VERIFIED — PRODUCTION`; P8 Piper Prudence primary/Kokoro fallback remains production behavior, and real RVC inference is not verified.
- Production exposes the existing device voice path and the promoted P9 Mobile REST/WebSocket contract at `https://api.personalbmo.web.id`.
- Production PostgreSQL contains exactly the six applied P9 migrations; candidate resources and port `3010` are not production.
- Hermes is a host systemd runtime on `127.0.0.1:8642`; production Hermes integration is verified. Audio Service is private on `127.0.0.1:8001`; Backend is private on `127.0.0.1:3000`. Caddy is the public edge.
- physical ESP32 integration is not verified. All additive Wi-Fi/log/telemetry/settings/proactive events remain `PENDING_PHYSICAL_ESP`.
- The manual Prisma Studio `*:5555` listener was stopped in Phase 2; no listener, Docker publication, or Caddy route remains. Privileged firewall-policy inspection is still an operator evidence gap.

### Hermes host bootstrap clarification

The historical production VPS preflight reported Hermes absent. P6 re-confirmed
the `ABSENT` branch and created the maintained loopback host service; P7 then
verified production integration. This clarification does not modify the locked PRD snapshot or hardware contract. The current audited service is Hermes 0.20.0
on `127.0.0.1:8642`.

## Teams

Hardware should continue with `hardware-handoff/` for the existing voice contract and use `integration/03-HARDWARE-IMPLEMENTATION-HANDOFF.md` only for additive, explicitly pending work. Backend/infrastructure work follows the integration plan and must keep route/schema/status documentation synchronized.

## Secrets

Never store credentials, database URLs, Wi-Fi passwords, provider tokens/session bytes, or recovery/pairing tokens in Git/docs. Use variable names and sanitized evidence only.

Repository verifier:

```text
python3 scripts/verify-backend-mvp-docs.py
```
