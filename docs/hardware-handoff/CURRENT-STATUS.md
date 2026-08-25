> **HISTORICAL ONLY — DO NOT IMPLEMENT**
> This document records an earlier BMO checkpoint. Current production authority is `docs/README.md`, `docs/NEXT-ACTION.md`, `docs/backend-mvp/CURRENT-RUNTIME-CONFIG.md`, and `docs/operations/2026-08-24-piper-only-purge-evidence.md`.

# BMO Hardware Handoff — Current Backend Status

> **CURRENT / CANONICAL STATUS**
> Backend code-only pairing is deployed. `PENDING_PHYSICAL_ESP` refers only to
> firmware and real-device acceptance.

**Audited:** 2026-08-20
**Backend/VPS state:** `PRODUCTION_VERIFIED`
**Production migrations:** `7/7` completed
**Physical pairing state:** `PENDING_PHYSICAL_ESP`

## Current production boundary

- Public domain: `https://api.personalbmo.web.id`
- Hardware WSS: `wss://api.personalbmo.web.id/ws`
- Backend origin: `127.0.0.1:3000`
- Deployed image: `bmo-p9.1:pairing-code-only-d1473d0`
- Pairing migration: `20260818110000_pairing_code_only_enrollment` is applied
- `/livez`, `/readyz`, and public `/health` returned HTTP `200`
- production soak passed `6/6`; rollback image remains preserved
- accepted readiness limitation: `rvc=unavailable`
- real RVC inference remains unverified and is not a production dependency

Public fake-client tests prove Backend behavior, not physical ESP firmware,
decoder, display, speaker, Wi-Fi, or timing acceptance.

## Immediate hardware task: connection stability first

The next milestone is `HW_VPS_CONNECTION_STABLE`:

1. associate to Wi-Fi;
2. resolve `api.personalbmo.web.id` through DNS;
3. establish trustworthy device time with SNTP/NTP;
4. validate TLS certificate, hostname, and SNI;
5. upgrade to `wss://api.personalbmo.web.id/ws`;
6. send hardware `authenticate` with the existing `device_id` and
   `device_token` within five seconds;
7. receive `authenticated`;
8. maintain native ping/pong liveness;
9. perform bounded reconnect and re-authentication;
10. preserve the existing wakeword/whole-WAV/MP3 voice path.

Do not implement or accept physical pairing until this base connection is
stable. After stability, implement `pairing_code`, `pairing_mode_request`,
`pairing_completed`, clear the pairing UI, then reconnect/re-authenticate after
completion while preserving existing voice behavior.

## What remains physical

- pairing code display/reissue/completion/reconnect;
- Wi-Fi apply/rollback, logs, telemetry, and settings acknowledgement;
- physical wakeword, capture, MP3 decode/playback, and reconnect regression;
- any feature that requires actual firmware source/build and bench evidence.

Start at
[`../integration/ESP-AGENT-HANDOFF.md`](../integration/ESP-AGENT-HANDOFF.md).
The Backend repository contains contracts and fake-client tests, not the ESP
firmware project.
