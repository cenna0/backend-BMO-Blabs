# BMO ESP / Hardware Agent Handoff

> **CURRENT / CANONICAL**
> Backend/VPS code-only pairing is production-deployed. Physical firmware and
> real-device acceptance remain `PENDING_PHYSICAL_ESP`.

## Endpoint and repository boundary

- Hardware WSS: `wss://api.personalbmo.web.id/ws`
- hardware auth: existing `device_id` / `device_token`
- `DEVICE_TOKEN` is hardware ↔ Backend only and never goes to Mobile
- this Backend repository contains contracts/tests, not the ESP firmware
  project

If the actual ESP firmware repository is not mounted, return a
repository-access blocker. Do not edit fake-ESP Backend tests as though they
were firmware.

## Immediate milestone: `HW_VPS_CONNECTION_STABLE`

Prove this sequence before pairing work:

1. Wi-Fi association;
2. DNS resolution of `api.personalbmo.web.id`;
3. correct device time through SNTP/NTP;
4. TLS certificate-chain, hostname, and SNI validation;
5. WSS upgrade to `wss://api.personalbmo.web.id/ws`;
6. first JSON message within five seconds: `authenticate` using the existing
   hardware identity/token;
7. receive `authenticated`;
8. maintain native server ping/pong liveness;
9. bounded reconnect and re-authentication;
10. preserve existing wakeword, whole-WAV upload, MP3 playback, and completion
    continuity.

Do not implement pairing before this milestone is stable.

## Exact current source events

Hardware → Backend:

```text
authenticate
audio_playback_done
audio_playback_failed
wifi_configuration_received
wifi_configuration_result
device_log
device_telemetry
device_settings_applied
pairing_mode_request
```

Backend → hardware:

```text
authenticated
authentication_failed
connection_replaced
display_status
audio_ready
request_failed
wifi_configuration
device_settings
pairing_code
pairing_completed
```

Authority: `backend/src/websocket/events.ts`,
[`02-BACKEND-DEVICE-ADDITIVE-CONTRACT.md`](02-BACKEND-DEVICE-ADDITIVE-CONTRACT.md),
and the immutable existing voice contract
[`../hardware-contract/BMO-MVP-HW-INTERFACE-CONTRACT-v1.0.5.md`](../hardware-contract/BMO-MVP-HW-INTERFACE-CONTRACT-v1.0.5.md).

Source-defined Wi-Fi/log/telemetry/settings events are Backend-implemented but
remain `PENDING_PHYSICAL_ESP` for firmware/bench acceptance. Do not infer that
fake-client tests prove physical support.

## Pairing after connection stability

An authenticated unbound device receives `pairing_code`. Firmware displays the
six digits and may send a debounced `pairing_mode_request` when replacement is
needed. After Mobile claims the code, Backend sends `pairing_completed`.
Firmware clears pairing UI, closes the old unbound socket, and reconnects and
re-authenticates with the unchanged hardware credential. A bound reconnect may
use one conditional pairing-mode request to recover a missed completion.

Keep wakeword and the existing voice path regression-green throughout. Backend
pairing is deployed; only physical pairing remains
`PENDING_PHYSICAL_ESP`.
