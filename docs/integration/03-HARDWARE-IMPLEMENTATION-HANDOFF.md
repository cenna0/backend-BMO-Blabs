# BMO Hardware / ESP32 Handoff — Frozen Requirements

**Frozen:** 2026-08-11
**Status:** `PENDING_PHYSICAL_ESP`
**Existing voice contract:** `docs/hardware-contract/BMO-MVP-HW-INTERFACE-CONTRACT-v1.0.5.md` remains unchanged.

This file describes hardware work required after the Backend Phase 2 handlers are available. It is not evidence that firmware supports any new event.

## Existing physical path — preserve first

The physical device must continue to use:

```text
WSS /ws
authenticate { device_id, device_token }
raw whole WAV POST /api/v1/voice
audio_ready with an HTTPS MP3 URL
audio_playback_done / audio_playback_failed
```

Current production supports one configured device credential. P9.1 pairing rows do not authenticate `/ws` today. Hardware must not rotate the working credential as an implicit integration fix.

## Required additive capabilities

| Capability | Firmware requirement | Phase 1 status |
|---|---|---|
| Wi-Fi configuration | receive, persist pending, ACK, apply, rollback, reconnect, result | `PENDING_PHYSICAL_ESP` |
| Safe device logs | bounded `device_log`; no credentials/password/content secrets | `PENDING_PHYSICAL_ESP` |
| RSSI telemetry | `device_telemetry` every ~60 s and on significant change | `PENDING_PHYSICAL_ESP` |
| Battery telemetry | omit/null until reliable hardware measurement is proven | `PENDING_PHYSICAL_ESP` |
| Generic proactive audio | dedupe `delivery_id`, download MP3, play, report done/failed | `PENDING_PHYSICAL_ESP` |
| Settings sync | apply versioned playback volume only after HW confirmation | `PENDING_PHYSICAL_ESP` |
| Wake word | target `Hi BMO`; firmware-owned, separate from VPS protocol | `PENDING_PHYSICAL_ESP` |

Exact payloads are in `02-BACKEND-DEVICE-ADDITIVE-CONTRACT.md`.

## Wi-Fi flow and ownership

```text
Mobile → Backend API service → encrypted PostgreSQL record
       → bound authenticated ESP socket → wifi_configuration
ESP stores pending + previous known-good config
       → wifi_configuration_received
       → switch network
       → reconnect/authenticate
       → wifi_configuration_result CONNECTED|ROLLED_BACK|FAILED
```

The ESP must never echo the password in serial logs, network logs, ACKs, results, or telemetry. Open networks omit the password. Backend owns versioning/latest-write-wins; ESP owns applying and rollback.

## First-boot blocker

A VPS cannot deliver Wi-Fi credentials to a device with no network path. Hardware/product must choose and verify the initial bootstrap mechanism (for example factory provisioning, BLE, or SoftAP) before claiming first-boot provisioning. This remains `PENDING_PHYSICAL_ESP`; the Backend must not invent a transport.

## Generic proactive speech

One event family serves `CHAT`, `SCHEDULE`, and `WHATSAPP`. Firmware must not create source-specific queues. Existing user-initiated playback is never interrupted; duplicate `delivery_id` must never replay.

## Physical acceptance required

No status may move beyond `PENDING_PHYSICAL_ESP` without real-device evidence for:

- existing WSS/auth/heartbeat/reconnect and whole-WAV voice regression;
- good and bad Wi-Fi apply with rollback;
- reconnect and result after network change;
- RSSI/log emission without secrets;
- proactive audio without a preceding voice upload;
- duplicate proactive delivery suppression;
- playback-volume application if supported;
- behavior after power loss during pending Wi-Fi/proactive work.
