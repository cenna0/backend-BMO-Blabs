# BMO Hardware Handoff — Current Backend Status

**Audited:** 2026-08-11
**Deployment state:** `VERIFIED — PRODUCTION (P8 PIPER PRIMARY)`
**Physical hardware state:** `PENDING_PHYSICAL_ESP` — existing and additive physical acceptance not run

This file separates verified public production behavior from future physical
ESP32 acceptance. The public endpoint is now available to the hardware team for
live integration. Public fake-client evidence does not prove the physical
device, decoder, speaker, timing, or Wi-Fi behavior.

## Verified production

| Capability | Current status | Evidence boundary |
|---|---|---|
| Backend HTTP/WebSocket production deployment | **VERIFIED — PRODUCTION** | P7 evidence |
| WebSocket authentication, close/state, connection replacement | **VERIFIED — PUBLIC** | public P7 acceptance |
| Heartbeat/reconnect and state resynchronization | **VERIFIED — PUBLIC** | public P7 acceptance |
| Raw WAV validation/upload through public HTTPS | **VERIFIED — PUBLIC** | public P7 acceptance |
| Idempotency/request conflict/device busy behavior | **VERIFIED — PUBLIC** | public P7 acceptance |
| MP3 download, completion, expiry/unavailability lifecycle | **VERIFIED — PUBLIC** | public P7 acceptance |
| faster-whisper production inference | **VERIFIED — PRODUCTION** | pinned offline P7 model + E2E |
| Kokoro production inference | **VERIFIED — PRODUCTION** | pinned offline P7 model + E2E |
| FFmpeg production MP3 output | **VERIFIED — PRODUCTION** | P7 private/public E2E |
| Hermes `/v1/responses` production integration | **VERIFIED — PRODUCTION** | loopback Hermes + P7 E2E |
| Production domain `api.personalbmo.web.id` | **LIVE / VERIFIED** | public HTTPS/WSS |
| Public fake ESP32 end-to-end matrix | **PASS — 23/23** | P7 public acceptance |
| Piper Prudence → Kokoro fallback | **VERIFIED — PRODUCTION** | P8 rollout; `RVC_ENABLED=false` |
| Piper Prudence fixed primary | **VERIFIED — PRODUCTION** | P8 rollout evidence; fixed speaker prudence / ID 0 |

## Not verified

| Capability | Current status | Owner |
|---|---|---|
| Real RVC inference | **NOT VERIFIED** | P8 archived experimental boundary; RVC disabled |
| RVC replacement architecture | **ARCHIVED / NOT A PRODUCTION DEPENDENCY** | compact P8 evidence and Git history retained |
| Physical ESP32 integration | **PENDING_PHYSICAL_ESP** | Hardware/P10 |
| PostgreSQL/Prisma application data layer | **SOURCE + PRIVATE CANDIDATE VERIFIED; NOT PRODUCTION** | P9.1 |
| Wi-Fi/log/telemetry/settings/proactive additive events | **PENDING_PHYSICAL_ESP** | Phase 2 backend + ESP firmware |

## What the hardware team can do now

- use the verified HTTPS/WSS values in
  [`DEPLOYMENT-CONFIG.md`](DEPLOYMENT-CONFIG.md) for live firmware integration;
- receive the real device token only through the approved out-of-band channel;
- keep TLS certificate validation and trustworthy device time enabled;
- execute development/integration work against the canonical hardware
  contract without depending on RVC state;
- prepare and later execute the physical acceptance matrix in P10.

For additive integration requirements, read
[`../integration/03-HARDWARE-IMPLEMENTATION-HANDOFF.md`](../integration/03-HARDWARE-IMPLEMENTATION-HANDOFF.md)
and [`../integration/02-BACKEND-DEVICE-ADDITIVE-CONTRACT.md`](../integration/02-BACKEND-DEVICE-ADDITIVE-CONTRACT.md).
Those documents do not claim current firmware implementation. First-boot Wi-Fi,
battery measurement, and every new event require real-device evidence.

The verified public endpoint satisfies the former P7 dependency. It does
**not** equal:

```text
HARDWARE INTEGRATION VERIFIED
```

That classification remains P10 and requires recorded physical ESP32 evidence,
including real capture/upload, reconnect/resync, MP3 decode/playback, completion
reporting, and the mandatory acceptance cases.
