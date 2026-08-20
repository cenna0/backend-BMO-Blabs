# BMO Hardware Handoff — Deployment Configuration

> **CURRENT / CANONICAL DEPLOYMENT VALUES**
> These values describe production. Candidate port `3010` and older deployment
> identities are historical and must not be used by firmware.

**Audited:** 2026-08-20

```text
DEPLOYMENT_STATUS: VERIFIED
VERIFIED_AT: 2026-08-03
DEPLOYED_COMMIT: 4e2cbda3f8eb02e27120821a11233e7848699249
HTTPS_BASE_URL: https://api.personalbmo.web.id
WEBSOCKET_URL: wss://api.personalbmo.web.id/ws
HEALTH_URL: https://api.personalbmo.web.id/health
UPLOAD_URL: https://api.personalbmo.web.id/api/v1/voice
AUDIO_URL_PATTERN: https://api.personalbmo.web.id/audio/<audio-uuid>.mp3
BACKEND_ORIGIN: 127.0.0.1:3000
PRODUCTION_IMAGE: bmo-p9.1:pairing-code-only-d1473d0
PRODUCTION_IMAGE_DIGEST: sha256:203817f83a023f730ed5dfd71be8bc96d127001a727c5ebc3d8999e945769973
DEPLOYED_IMAGE_SOURCE_REVISION: d1473d04f4b76ccb52cc8eeaff52a268504310f0
PRODUCTION_MIGRATIONS: 7 completed, 0 unfinished, 0 rolled_back
PAIRING_MIGRATION: 20260818110000_pairing_code_only_enrollment
DEVICE_ID: bmo-001
DEVICE_TOKEN: PROVIDED_OUT_OF_BAND
PUBLIC_E2E_STATUS: PASS — P8 NATIVE EQUIVALENT 12/12
PHYSICAL_ESP32_STATUS: NOT_RUN
PHYSICAL_PAIRING_STATUS: PENDING_PHYSICAL_ESP
```

`VERIFIED_AT`, `DEPLOYED_COMMIT`, and `PUBLIC_E2E_STATUS` retain the legacy
P7/P8 voice verifier checkpoint; `DEPLOYED_COMMIT` is not current Git HEAD or
the current Backend image revision. The production image/digest/source fields
above are the current immutable deployment identity.

The deployed image source revision is immutable image provenance. It is not
the mutable repository HEAD; use `git rev-parse HEAD` to inspect the checked-out
docs/source revision. Production Backend uses port `3000`. Port `3010` belonged
to a historical private candidate and is not production.

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

Backend code-only pairing and all seven migrations are already production
deployed. Physical firmware support remains `PENDING_PHYSICAL_ESP`.
