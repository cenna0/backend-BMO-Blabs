# Additive Hardware Events

**Status:** `PENDING_PHYSICAL_ESP`

The exact payloads and state rules are canonical in [`../integration/02-BACKEND-DEVICE-ADDITIVE-CONTRACT.md`](../integration/02-BACKEND-DEVICE-ADDITIVE-CONTRACT.md). The target events are:

```text
Backend -> ESP  wifi_configuration
ESP -> Backend  wifi_configuration_received
ESP -> Backend  wifi_configuration_result
ESP -> Backend  device_log
ESP -> Backend  device_telemetry
Backend -> ESP  device_settings
ESP -> Backend  device_settings_applied
Backend -> ESP  proactive_audio_ready
ESP -> Backend  proactive_playback_done
ESP -> Backend  proactive_playback_failed
```

They extend device `/ws`; they do not replace `authenticate`, `display_status`, `audio_ready`, `audio_playback_done`, or `audio_playback_failed`. Firmware must preserve the whole-WAV/MP3 voice path.

Backend test doubles may verify parsing/queue state, but promotion requires firmware source/build plus a real ESP test for reconnect, idempotency, rollback, offline delivery, and physical playback. First-boot Wi-Fi and reliable battery measurement remain hardware-owned gates.
