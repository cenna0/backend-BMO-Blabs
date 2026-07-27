# BMO Hardware Handoff — Deployment Configuration

**Purpose:** Deployment-specific values that firmware needs. Protocol behavior remains defined by the canonical hardware contract.

## Current state

```text
DEPLOYMENT_STATUS: NOT_VERIFIED
PUBLIC_DOMAIN_TARGET: api.personalbmo.web.id
HTTPS_BASE_URL: https://api.personalbmo.web.id
WEBSOCKET_URL: wss://api.personalbmo.web.id/ws
DEVICE_ID: bmo-001
DEVICE_TOKEN: PROVIDED_OUT_OF_BAND
PUBLIC_E2E_STATUS: NOT_RUN
PHYSICAL_ESP32_STATUS: NOT_RUN
```

**Meaning:** the hostname is the agreed production target, but this document does not claim the BMO backend has already been deployed and proven reachable through it.

Hardware must wait for `DEPLOYMENT_STATUS: VERIFIED` before treating this as a live integration endpoint.

## Values after deployment verification

The deployment executor must update this section only after testing from outside the VPS:

```text
DEPLOYMENT_STATUS: VERIFIED | BLOCKED
VERIFIED_AT: <UTC timestamp>
DEPLOYED_COMMIT: <git commit SHA>
HTTPS_BASE_URL: https://api.personalbmo.web.id
WEBSOCKET_URL: wss://api.personalbmo.web.id/ws
HEALTH_URL: https://api.personalbmo.web.id/health
UPLOAD_URL: https://api.personalbmo.web.id/api/v1/voice
AUDIO_URL_PATTERN: https://api.personalbmo.web.id/audio/<audio-uuid>.mp3
DEVICE_ID: bmo-001
DEVICE_TOKEN: PROVIDED_OUT_OF_BAND
PUBLIC_E2E_STATUS: PASS | FAIL | BLOCKED
PHYSICAL_ESP32_STATUS: PASS | FAIL | NOT_RUN | BLOCKED
```

Do not paste the real device token into this file.

## Network ownership

Expected production exposure:

```text
Public internet:
  TCP 80  → Caddy redirect/certificate handling
  TCP 443 → Caddy HTTPS/WSS

Not public:
  3000 → BMO backend origin
  8001 → Audio Service
  8642 → Hermes
  5432 → PostgreSQL
  Beszel origin port → reverse proxy only

Admin access:
  SSH → planned through Tailscale after verified setup
```

Firmware uses only the public HTTPS/WSS routes. It does not need Tailscale membership.

## TLS requirement

Production firmware must validate the TLS certificate chain for `api.personalbmo.web.id`. Do not ship with certificate validation disabled.

Before opening HTTPS/WSS, firmware must have a trustworthy wall clock (normally Wi-Fi + NTP/SNTP) so certificate validity checks can succeed. Do not solve TLS errors by disabling time/certificate verification. Prefer trusting the public CA/root used by the deployed certificate rather than pinning a short-lived leaf certificate; P10 records the actually deployed certificate/CA expectations after P7 TLS verification.

## Credential handoff

The backend team provides the firmware team with:

```text
device_id
one device_token
```

through a secure out-of-band channel. The token must not be committed to Git or documentation. Provision it through a firmware-secret/config path (for example build secret or protected device storage) rather than a public source file.

## Deployment handoff gate

The deployment executor may mark this file `VERIFIED` only after all of the following pass:

- DNS resolves to the intended public deployment path;
- HTTPS certificate is valid;
- WSS upgrade works through the reverse proxy;
- `/health` responds through the public hostname;
- valid WebSocket authentication works;
- raw WAV upload works through HTTPS;
- `thinking` and `audio_ready` arrive through WSS;
- MP3 downloads through HTTPS;
- fake ESP32 sends `audio_playback_done` successfully;
- internal ports are not exposed publicly;
- deployed commit SHA is recorded.
