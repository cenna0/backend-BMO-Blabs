# Joy Hardware / ESP32 Implementation Handoff

> **CURRENT / CANONICAL**
> Backend code-only pairing is production-deployed. This document describes
> firmware and real-device work, whose status remains
> `PENDING_PHYSICAL_ESP`.

**Audited:** 2026-08-29
**Production image:** `joy-p9.1:production`
**Production migrations:** 10 completed, 0 unfinished, 0 rolled_back
**Hardware WSS:** `wss://api.personalbmo.web.id/ws`

Start at [`ESP-AGENT-HANDOFF.md`](ESP-AGENT-HANDOFF.md). The existing physical
voice authority remains
[`../hardware-contract/BMO-MVP-HW-INTERFACE-CONTRACT-v1.0.5.md`](../hardware-contract/BMO-MVP-HW-INTERFACE-CONTRACT-v1.0.5.md).

## Milestone 1 — connection stability first

Reach `HW_VPS_CONNECTION_STABLE` before pairing implementation:

1. Wi-Fi association;
2. DNS resolution of `api.personalbmo.web.id`;
3. trustworthy device time via SNTP/NTP;
4. TLS certificate-chain, hostname, and SNI validation;
5. WSS upgrade to the exact `/ws` URL;
6. `authenticate` as the first JSON message within five seconds using existing
   `device_id` / `device_token`;
7. receive `authenticated`;
8. maintain native ping/pong;
9. bounded reconnect plus re-authentication;
10. preserve existing wakeword, whole-WAV upload, MP3 playback, and completion.

Do not rotate a working hardware credential as an integration fix. Do not send
`DEVICE_TOKEN` to Mobile or logs.

## Exact current source event contract

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
voice_reserve
voice_cancel
proactive_offer_accepted
proactive_done
proactive_failed
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
voice_reserve_accepted
voice_reserve_rejected
voice_reserve_expired
proactive_offer
proactive_audio_ready
proactive_cancel
display_qr
clear_qr
```

`backend/src/websocket/events.ts` wins if prose drifts. Source-defined
Wi-Fi/log/telemetry/settings support is not physical acceptance. The current source schema defines the proactive hardware event family; physical implementation and acceptance remain `PENDING_PHYSICAL_ESP`.

## Milestone 2 — physical code-only pairing

After stable connection/auth/voice continuity:

1. An authenticated unbound Joy receives `pairing_code` automatically.
2. Display the six digits and clear them at `expires_at`.
3. Use a debounced `pairing_mode_request` only when replacement is actually
   needed; Backend enforces a five-second cooldown and six per 15 minutes.
4. When Mobile claims the code, receive `pairing_completed`.
5. Clear pairing UI, close the old unbound socket, and reconnect/authenticate
   using the unchanged `DEVICE_ID` / `DEVICE_TOKEN`.
6. If completion was missed, a newly bound reconnect may send exactly one
   conditional `pairing_mode_request`; Backend responds `pairing_completed`.

The old socket is not promoted in place. The durable ACTIVE Device binding is
resolved only on normal reconnect/authentication. Pairing UI/logs must never
expose the hardware token or persist pairing code unnecessarily.

## Later source-defined additive acceptance

Only after the two milestones above remain stable, test Wi-Fi apply/rollback,
bounded device logs, telemetry, and versioned playback-volume settings. Every
physical capability remains `PENDING_PHYSICAL_ESP` until real firmware build
and bench evidence exists. Fake-client Backend tests do not satisfy this gate.

The Backend repo is not the ESP firmware repository. If firmware source is not
mounted, return a repository-access blocker instead of modifying fake-ESP
tests as a substitute.
