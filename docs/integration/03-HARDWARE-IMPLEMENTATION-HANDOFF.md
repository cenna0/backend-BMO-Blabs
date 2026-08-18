# BMO Hardware / ESP32 Handoff — Frozen Requirements

**Frozen:** 2026-08-11
**Status:** `PENDING_PHYSICAL_ESP`
**Existing voice contract:** `docs/hardware-contract/BMO-MVP-HW-INTERFACE-CONTRACT-v1.0.5.md` remains unchanged.

This file describes hardware work required after the Backend Phase 2 handlers
were implemented. The promoted Backend contains the additive handlers, but
this file is not evidence that firmware supports any new event.

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
| Code-only pairing | receive/display `pairing_code`, request reissue, clear on `pairing_completed` | `PENDING_PHYSICAL_ESP` |
| Wake word | target `Hi BMO`; firmware-owned, separate from VPS protocol | `PENDING_PHYSICAL_ESP` |

Exact payloads are in `02-BACKEND-DEVICE-ADDITIVE-CONTRACT.md`.

## Code-only pairing behavior

After successful existing `authenticate`, an unbound BMO receives
`pairing_code` over the same WSS `/ws` connection. The firmware displays the
six digits and clears them when `expires_at` is reached. No local persistent
pairing state is required; a reconnect receives a replacement code when
needed.

The unbound authenticated socket receives the first `pairing_code`
automatically. The firmware may send `pairing_mode_request` only when it
explicitly needs a replacement after expiry or reconnect; Backend accepts it
only from the authenticated hardware socket and returns a replacement code.
Firmware must debounce requests with backoff because Backend enforces a
five-second hardware reissue cooldown and a six-per-15-minute limit.

After Mobile successfully claims the code, Backend sends `pairing_completed`
on the currently authenticated but still-unbound socket. Firmware MUST clear
pairing UI, close the old WSS `/ws` session, and reconnect/authenticate with
the unchanged `DEVICE_ID` and `DEVICE_TOKEN`. Backend then resolves the newly
created ACTIVE Device during normal authentication, after which application-
bound settings, Wi-Fi, and proactive behavior may resume. The old socket must
not be treated as application-bound and owner-specific additive events remain
blocked until the reconnect completes. The firmware never sends
`DEVICE_TOKEN` to Mobile and must not log the token or pairing code. Physical
firmware acceptance remains `PENDING_PHYSICAL_ESP`.

If the old socket disconnected before it received `pairing_completed`, the
claim is still authoritative. After the reconnect has authenticated and the
Backend has resolved the ACTIVE Device, firmware sends exactly one
`pairing_mode_request` only if its pairing UI is still incomplete. The bound
reconnect receives `pairing_completed`; this is conditional recovery, not an
automatic request after every authentication, and firmware must not retry it
in a loop.

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
