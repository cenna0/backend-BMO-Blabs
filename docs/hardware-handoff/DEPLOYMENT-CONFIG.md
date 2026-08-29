# Joy Hardware Handoff — Deployment Configuration

> **CURRENT / CANONICAL DEPLOYMENT VALUES**
> These values describe production. Candidate port `3010` and older deployment
> identities are historical and must not be used by firmware.

**Audited:** 2026-08-29

```text
DEPLOYMENT_STATUS: VERIFIED
VERIFIED_AT: 2026-08-29

HTTPS_BASE_URL: https://api.personalbmo.web.id
WEBSOCKET_URL: wss://api.personalbmo.web.id/ws
HEALTH_URL: https://api.personalbmo.web.id/health
UPLOAD_URL: https://api.personalbmo.web.id/api/v1/voice
AUDIO_URL_PATTERN: https://api.personalbmo.web.id/audio/<audio-uuid>.mp3
BACKEND_ORIGIN: 127.0.0.1:3000
PRODUCTION_IMAGE: joy-p9.1:production
PRODUCTION_IMAGE_DIGEST: not recorded in current container metadata
DEPLOYED_IMAGE_SOURCE_REVISION: not recorded in current container metadata
PRODUCTION_MIGRATIONS: 10 completed, 0 unfinished, 0 rolled_back
PAIRING_MIGRATION: 20260818110000_pairing_code_only_enrollment
DEVICE_ID: joy-001
DEVICE_TOKEN: PROVIDED_OUT_OF_BAND
PUBLIC_E2E_STATUS: PASS — public /health and loopback audio health checks
PHYSICAL_ESP32_STATUS: PENDING_PHYSICAL_ESP
PHYSICAL_PAIRING_STATUS: PENDING_PHYSICAL_ESP
```

The current production container is identified by the image tag above; repository HEAD is tracked separately. P9 Backend + PostgreSQL use `ops/deploy/p9.1-production-compose.yml`, while Audio runs from the root `docker-compose.yml`.

Never paste the real `DEVICE_TOKEN` into Git, docs, logs, URLs, screenshots, or
Mobile. Provision it through an approved protected firmware path.

## Network and TLS

Firmware uses only public HTTPS/WSS on `api.personalbmo.web.id`. Backend
`3000`, Audio `8001`, Hermes `8642`, PostgreSQL, and provider services are
private and are not firmware endpoints.

Before opening WSS, firmware must associate to Wi-Fi, resolve DNS, synchronize
a trustworthy clock, and validate the public certificate chain plus hostname
and SNI. Do not disable certificate validation or connect by bare VPS IP.

## Connection and pairing order

First reach `HW_VPS_CONNECTION_STABLE`: connect, authenticate within five
seconds, receive `authenticated`, keep native ping/pong healthy, reconnect with
bounded backoff, and keep wakeword/voice behavior regression-green.

Only then implement physical code-only pairing. The Backend sends
`pairing_code`; hardware may request a replacement with
`pairing_mode_request`; Backend sends `pairing_completed`; firmware clears the
UI and reconnects/authenticates using the unchanged hardware credential.

Backend code-only pairing and all ten migrations are already production
deployed. Physical firmware support remains `PENDING_PHYSICAL_ESP`.
