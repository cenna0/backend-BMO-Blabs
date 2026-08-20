# BMO Hardware / ESP Agent Context

> **CURRENT ENTRYPOINT**
> Start with
> [`../integration/ESP-AGENT-HANDOFF.md`](../integration/ESP-AGENT-HANDOFF.md).
> Source `backend/src/websocket/events.ts` is authoritative for current event
> names; fake-ESP Backend tests are not physical firmware acceptance.

## Mission order

1. Reach `HW_VPS_CONNECTION_STABLE` on
   `wss://api.personalbmo.web.id/ws`.
2. Preserve existing wakeword, raw-WAV upload, MP3 playback, and completion
   behavior.
3. Only after stable WSS/auth/ping-pong/reconnect/voice continuity, implement
   physical pairing and then other source-defined additive behavior.

Hardware authenticates with the existing `device_id` / `device_token` within
five seconds of WSS open. `DEVICE_TOKEN` is hardware ↔ Backend only. It must
never be sent to Mobile, placed in a URL, or logged.

## Exact current source event inventory

ESP → Backend:

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

Backend → ESP:

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

Wi-Fi/log/telemetry/settings schemas exist in Backend source, but physical
support remains `PENDING_PHYSICAL_ESP`. Pairing is Backend-deployed but remains
`PENDING_PHYSICAL_ESP` for firmware and real-device acceptance.

After `pairing_completed`, clear pairing UI, close the old unbound socket, and
reconnect/re-authenticate with the unchanged hardware credential. Preserve
wakeword and voice behavior throughout.

This repository does not contain the ESP firmware project. If the actual
firmware repository is not mounted, return a repository-access blocker instead
of editing Backend fake-ESP tests as if they were firmware.

Companion authority:

- [`../hardware-contract/BMO-MVP-HW-INTERFACE-CONTRACT-v1.0.5.md`](../hardware-contract/BMO-MVP-HW-INTERFACE-CONTRACT-v1.0.5.md)
- [`../integration/02-BACKEND-DEVICE-ADDITIVE-CONTRACT.md`](../integration/02-BACKEND-DEVICE-ADDITIVE-CONTRACT.md)
- [`../integration/03-HARDWARE-IMPLEMENTATION-HANDOFF.md`](../integration/03-HARDWARE-IMPLEMENTATION-HANDOFF.md)
- [`DEPLOYMENT-CONFIG.md`](DEPLOYMENT-CONFIG.md)
