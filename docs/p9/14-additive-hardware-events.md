# Additive Hardware Events

> **CURRENT / SOURCE-DERIVED**
> `backend/src/websocket/events.ts` is authoritative. Backend implementation
> does not prove physical firmware acceptance.

**Physical status:** `PENDING_PHYSICAL_ESP`

Exact ESP → Backend events:

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

Exact Backend → ESP events:

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

These extend/preserve device `/ws`; Mobile uses a different `/api/v1/ws`
contract. Payloads and binding rules are in
[`../integration/02-BACKEND-DEVICE-ADDITIVE-CONTRACT.md`](../integration/02-BACKEND-DEVICE-ADDITIVE-CONTRACT.md).

Current source does not define `proactive_audio_ready`,
`proactive_playback_done`, or `proactive_playback_failed`. Backend durable
proactive-delivery state must not be mistaken for a hardware event family.

Firmware work starts with `HW_VPS_CONNECTION_STABLE`, then physical pairing,
then other additive acceptance. Existing wakeword/whole-WAV/MP3 voice behavior
must remain regression-green. Promotion requires actual firmware source/build
and real ESP evidence; fake clients are insufficient.
