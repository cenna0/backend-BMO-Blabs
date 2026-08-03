# BMO Hardware Handoff — Deployment Configuration

**Purpose:** Verified deployment-specific values that firmware needs. Protocol
behavior remains defined by the canonical Hardware Contract v1.0.5.

## Current state

```text
DEPLOYMENT_STATUS: VERIFIED
VERIFIED_AT: 2026-08-03
DEPLOYED_COMMIT: 4e2cbda3f8eb02e27120821a11233e7848699249
HTTPS_BASE_URL: https://api.personalbmo.web.id
WEBSOCKET_URL: wss://api.personalbmo.web.id/ws
HEALTH_URL: https://api.personalbmo.web.id/health
UPLOAD_URL: https://api.personalbmo.web.id/api/v1/voice
AUDIO_URL_PATTERN: https://api.personalbmo.web.id/audio/<audio-uuid>.mp3
DEVICE_ID: bmo-001
DEVICE_TOKEN: PROVIDED_OUT_OF_BAND
PUBLIC_E2E_STATUS: PASS — P8 NATIVE EQUIVALENT 12/12
PHYSICAL_ESP32_STATUS: NOT_RUN
```

`VERIFIED_AT` is the authoritative end of the final P7 production soak and
closure verification recorded in `P7-TEST-EVIDENCE.md`. The public endpoint is
live, and the production fake-client matrix passed `23/23` checks. Physical
ESP32 acceptance has not run and remains P10; this file does not claim
`HARDWARE INTEGRATION VERIFIED`.

P8 Piper implementation, final-main synchronization, deployment, and soak
evidence are recorded in
[`../backend-mvp/P8-PRODUCTION-ROLLOUT-EVIDENCE.md`](../backend-mvp/P8-PRODUCTION-ROLLOUT-EVIDENCE.md).
The P7 image remains retained as the deterministic offline rollback.

Do not paste the real device token into this file.

## Network ownership

Verified production exposure:

```text
Public internet:
  TCP 80  → Caddy redirect/certificate handling
  TCP 443 → Caddy HTTPS/WSS

Not public:
  3000 → BMO backend origin at 127.0.0.1:3000
  8001 → Audio Service at 127.0.0.1:8001
  8642 → Hermes at 127.0.0.1:8642
  5432 → PostgreSQL not deployed; must remain private if P9 activates it
  Beszel origin port → reverse proxy only

Admin access:
  SSH → Tailscale-only approved path
```

Firmware uses only the public HTTPS/WSS routes. It does not need Tailscale
membership and must not call private origin ports.

## TLS requirement

Production firmware must validate the TLS certificate chain for
`api.personalbmo.web.id`. Do not ship with certificate validation disabled.

Before opening HTTPS/WSS, firmware must have a trustworthy wall clock (normally
Wi-Fi + NTP/SNTP) so certificate validity checks can succeed. Do not solve TLS
errors by disabling time/certificate verification. Prefer trusting the public
CA/root used by the deployed certificate rather than pinning a short-lived leaf
certificate. P10 records the physical device's observed certificate/CA behavior.

## Credential handoff

The backend team provides the firmware team with:

```text
device_id
one device_token
```

through a secure out-of-band channel. The token must not be committed to Git or
documentation. Provision it through a firmware-secret/config path, such as a
build secret or protected device storage, rather than a public source file.

## Verified deployment handoff evidence

P7 marked this deployment `VERIFIED` only after all of the following passed:

- DNS and HTTPS certificate through the intended public path;
- WSS upgrade and valid/invalid authentication behavior;
- sanitized `/health` readiness through the public hostname;
- raw WAV upload and canonical lifecycle through public HTTPS/WSS;
- `thinking`, reconnect/resync, `audio_ready`, and MP3 download;
- fake ESP32 playback completion and idempotency/error cases;
- public fake-client matrix `23/23`;
- no public exposure of `3000`, `8001`, or `8642`;
- immutable deployment source and image digests recorded;
- final 61m 5s soak with zero new OOM and zero application restarts.

The remaining gate is physical P10 acceptance; `PHYSICAL_ESP32_STATUS` must
remain `NOT_RUN` until real device evidence exists.
