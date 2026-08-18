# BMO Backend API Service ↔ ESP32 Additive Device Contract

**Version:** 2.0.0
**Date:** 2026-08-11
**Rule:** Additive only. This file describes the Backend API service ↔ ESP32 protocol. Existing `BMO-MVP-HW-INTERFACE-CONTRACT-v1.0.5` voice behavior remains valid.

**Implementation state:** Backend handlers for the additive capabilities are
implemented in the promoted P9 runtime. Firmware behavior and real-device
acceptance remain `PENDING_PHYSICAL_ESP`; this document must not be read as
evidence that an ESP32 supports the new events.

**Current lifecycle:** Code-only enrollment exists in reviewed source but is
NOT YET DEPLOYED. Migration
`20260818110000_pairing_code_only_enrollment` is NOT YET APPLIED IN PRODUCTION.
Physical firmware acceptance remains `PENDING_PHYSICAL_ESP`. The physical
contract remains separate from Mobile `/api/v1/ws` and existing hardware
`/ws` voice behavior.

---

# 1. Existing contract remains unchanged

Existing ESP32 events continue to work exactly as before.

Do not rename/remove:

```text
authenticate
authenticated
authentication_failed
connection_replaced
display_status
audio_ready
request_failed
audio_playback_done
audio_playback_failed
```

Do not change raw WAV upload or MP3 download semantics.

The events below extend `/ws`.

Audited existing `/ws` implementation accepts only `authenticate`, `audio_playback_done`, and `audio_playback_failed` inbound, and emits only the existing voice events listed above. It authenticates one configured `DEVICE_ID`/`DEVICE_TOKEN`; it does not query Prisma.

Current defaults are a 5-second auth timeout, 60-second native ping interval,
two missed pongs, and 8,192-byte JSON payload limit. Close behavior uses code
`4008` for `AUTHENTICATION_TIMEOUT`, `4001` for
`AUTHENTICATION_REQUIRED`/invalid pre-auth messages, `4003` for
`INVALID_CREDENTIALS`, and policy code `1008` for invalid post-auth messages.
A newer valid connection replaces the old one.

## 1.1 Application-device binding

Existing `/ws` authentication remains backward-compatible.

Phase 2 must resolve the authenticated hardware/device identity to the application `Device` row before allowing DB-owned additive features. The frozen resolver rule is:

```text
Device.hardwareId == authenticated device_id
AND Device.status == ACTIVE
AND Device.tokenHash == SHA-256(authenticated device_token)
```

The resolved `Device.userId` owns every subsequent DB operation. Matching only a client-supplied UUID, pairing ID, or mobile-selected device ID is insufficient.

If no active owned application device can be bound:

- existing voice behavior remains available if it was already valid under the current voice contract;
- Backend must not deliver owner-specific Wi-Fi credentials/settings/proactive content;
- Backend records a safe `DEVICE_NOT_BOUND` diagnostic;
- do not rotate the currently deployed physical-device credential as an implicit fix.

## 1.2 Code-only hardware enrollment

When an authenticated hardware session has no active application binding,
Backend creates a durable `HardwareEnrollment` containing the hardware ID and
the SHA-256 digest of the authenticated `DEVICE_TOKEN`. The raw token is never
persisted or sent to Mobile. The enrollment stores only a keyed digest of the
six-digit code and expires after 600 seconds. A replacement invalidates the
previous enrollment.

Backend → ESP32: `pairing_code`

```json
{
  "event": "pairing_code",
  "code": "123456",
  "expires_at": "2026-08-18T12:10:00.000Z"
}
```

The event is sent through the pairing-only current-device sender to the
registry's current socket authenticated with the same hardware identity. This
also delivers a delayed issuance result to a replacement socket without
widening owner-specific event delivery. Firmware displays the six digits and
clears them at expiry.

ESP32 → Backend: `pairing_mode_request`

```json
{
  "event": "pairing_mode_request"
}
```

This is accepted only after hardware authentication and requests a replacement
code when the firmware explicitly needs one after expiry or reconnect. The
normal unbound-authentication path already issues a code automatically, so
firmware must not loop by immediately requesting another code. Repeated
requests are debounced by firmware and rate-limited by Backend (5 seconds
between hardware reissues and 6 in 15 minutes).

Backend → ESP32: `pairing_completed`

```json
{
  "event": "pairing_completed",
  "status": "ok"
}
```

Mobile claims through `POST /api/v1/pairing/claim` with only `{ "code":
"123456" }`. Backend creates the Device from the trusted enrollment identity,
defaults its name to `BMO`, and sends `pairing_completed` on the currently
authenticated hardware socket when it is connected.

The socket that received `pairing_completed` was authenticated before the
claim while hardware was unbound. It is not promoted in place and must not be
treated as application-bound. Firmware MUST clear pairing UI, close that WSS
`/ws` session, and reconnect using the unchanged `DEVICE_ID` and
`DEVICE_TOKEN`. On the new authenticated session, Backend resolves the new
ACTIVE Device and normal application-bound settings, Wi-Fi, and proactive
behavior resumes. Owner-specific additive events remain blocked on the old
socket and are available only after this normal reconnect/authentication
binding step. Firmware support and physical acceptance remain
`PENDING_PHYSICAL_ESP`.

If the claim commits after the old socket has disconnected, `pairing_completed`
may not be delivered on that socket. After reconnect/authentication resolves
the ACTIVE Device, firmware that still shows pairing incomplete sends exactly
one `pairing_mode_request`. Because the reconnect is already application-bound,
Backend answers with `pairing_completed` directly. This is conditional recovery
for a missed completion, not an unconditional request after every
authentication; firmware must not loop on it.

---

# 2. New capability A — Wi-Fi configuration delivery

Backend persists remote Wi-Fi configuration and delivers it to an authenticated device.

## 2.1 Security model

- Wi-Fi password is encrypted at rest in Backend DB.
- Backend decrypts it only when delivering to the authorized device.
- Password must never be logged.
- ESP32 must never echo the password in logs/telemetry.
- Open Wi-Fi uses `security="OPEN"` and omits `password`.

## 2.2 Backend → ESP32: `wifi_configuration`

```json
{
  "event": "wifi_configuration",
  "configuration_id": "<uuid>",
  "ssid": "Home WiFi",
  "security": "WPA_PSK",
  "password": "<plaintext-only-on-authorized-device-transport>"
}
```

Open network:

```json
{
  "event": "wifi_configuration",
  "configuration_id": "<uuid>",
  "ssid": "Cafe Guest",
  "security": "OPEN"
}
```

Transport must be WSS in production.

## 2.3 ESP32 → Backend: received

Before intentionally leaving the current network, ESP32 confirms it safely stored a pending config:

```json
{
  "event": "wifi_configuration_received",
  "configuration_id": "<uuid>"
}
```

Backend state becomes `DELIVERED`.

If a newer non-terminal configuration superseded this one before application, Backend marks the older one `SUPERSEDED` and does not intentionally resend it.

## 2.4 Apply sequence

ESP32:

```text
receive config
→ validate locally
→ persist as PENDING, keep previous known-good config
→ send wifi_configuration_received
→ switch network
→ connect to new Wi-Fi
→ reconnect WSS
→ authenticate
→ send wifi_configuration_result
```

Success:

```json
{
  "event": "wifi_configuration_result",
  "configuration_id": "<uuid>",
  "status": "CONNECTED",
  "rssi": -57
}
```

Failure with rollback:

```json
{
  "event": "wifi_configuration_result",
  "configuration_id": "<uuid>",
  "status": "ROLLED_BACK",
  "reason": "AUTH_FAILED|SSID_NOT_FOUND|DHCP_FAILED|CONNECT_TIMEOUT|INTERNAL_ERROR"
}
```

Failure when rollback is impossible:

```json
{
  "event": "wifi_configuration_result",
  "configuration_id": "<uuid>",
  "status": "FAILED",
  "reason": "AUTH_FAILED|SSID_NOT_FOUND|DHCP_FAILED|CONNECT_TIMEOUT|INTERNAL_ERROR"
}
```

If the new network fails, firmware should restore the previous known-good network if possible.

Backend must accept result idempotently.

## 2.5 Reconnect state sync

After device auth, Backend checks for a pending/delivered Wi-Fi configuration and may resend it if not terminal.

Do not endlessly resend a configuration already marked `CONNECTED` or `ROLLED_BACK`.

---

# 3. New capability B — device logs

ESP32 → Backend:

```json
{
  "event": "device_log",
  "level": "INFO|WARN|ERROR",
  "code": "WIFI_CONNECT_FAILED",
  "message": "safe bounded diagnostic",
  "timestamp": "<ISO-8601-or-null>",
  "metadata": {
    "firmware_version": "..."
  }
}
```

Rules:

- max WS message remains bounded;
- no secrets;
- no Wi-Fi password;
- no device token;
- no full Authorization header;
- Backend rate limits ingestion;
- backend may retain logs for a bounded period (baseline 7 days);
- malformed/excessive logs do not crash the device connection.

Suggested important codes:

```text
BOOT
WIFI_CONNECTED
WIFI_DISCONNECTED
WIFI_CONNECT_FAILED
WS_CONNECTED
WS_AUTHENTICATED
WS_DISCONNECTED
VOICE_UPLOAD_FAILED
AUDIO_DOWNLOAD_FAILED
AUDIO_PLAYBACK_FAILED
PROACTIVE_AUDIO_FAILED
```

---

# 4. New capability C — telemetry

ESP32 → Backend:

```json
{
  "event": "device_telemetry",
  "wifi_connected": true,
  "wifi_rssi": -57,
  "battery_percent": null,
  "firmware_version": "..."
}
```

Rules:

- Wi-Fi RSSI: implement if firmware can provide it.
- Battery: send `null` or omit until hardware confirms reliable measurement.
- Backend stores latest telemetry separately from event history.
- baseline cadence: every 60 seconds while connected, plus significant-change events.
- do not use telemetry as a replacement for native WebSocket heartbeat.

---

# 5. New capability D — generic proactive audio

Purpose:

```text
mobile chat
schedule
WhatsApp
future backend-initiated speech
```

Backend must be able to make BMO speak without a preceding ESP32 voice request.

## 5.1 Backend-side queue rule

Backend owns queueing.

Source/test status: Backend now persists and arbitrates all `CHAT`, `SCHEDULE`,
and `WHATSAPP` intents through the same delivery/attempt service with database
idempotency, expiry, per-device exclusion, and a user-voice-busy boundary. No
physical sender is installed and this does not implement any Section 5.2/5.4
device event. Physical status remains `PENDING_PHYSICAL_ESP`.

Arbitration is locked for this release:

1. an already-running physical playback is never interrupted;
2. a user-initiated voice request has priority over proactive items that have not started;
3. proactive items wait while the device is processing/playing a user voice request;
4. only one proactive delivery may be actively offered/played per device at a time;
5. ESP32 does not need a large durable queue.

Backend should queue the **delivery intent/text/source** first and synthesize or publish the MP3 when the device is eligible, so a file does not expire while waiting behind a busy/offline device.

Baseline proactive delivery deadline from its due/creation time is 5 minutes unless the source-specific policy says otherwise. Expired stale items become `EXPIRED`/`MISSED` and must not suddenly speak hours later.

## 5.2 Backend → ESP32: `proactive_audio_ready`

```json
{
  "event": "proactive_audio_ready",
  "delivery_id": "<uuid>",
  "source": "CHAT|SCHEDULE|WHATSAPP",
  "audio_url": "https://api.personalbmo.web.id/audio/<uuid>.mp3",
  "format": "mp3",
  "expires_in_seconds": 300
}
```

`delivery_id` is not a voice `request_id`.

## 5.3 ESP32 behavior

```text
receive proactive_audio_ready
→ deduplicate delivery_id
→ download MP3
→ set display speaking when playback begins
→ play
→ send done/failed
→ return idle
```

Do not replay the same `delivery_id` after reconnect.

## 5.4 ESP32 → Backend completion

```json
{
  "event": "proactive_playback_done",
  "delivery_id": "<uuid>"
}
```

Failure:

```json
{
  "event": "proactive_playback_failed",
  "delivery_id": "<uuid>",
  "reason": "DOWNLOAD_FAILED|DECODE_FAILED|PLAYBACK_FAILED|DEVICE_BUSY"
}
```

Completion/failure must be idempotent.

## 5.5 Reconnect

If delivery is pending and MP3 still valid, Backend may resend `proactive_audio_ready`.

If a delivery intent is still valid but audio was never generated because the device was busy/offline, Backend may generate it when the device becomes eligible. Do not regenerate after a terminal playback failure merely as an implicit retry.

ESP32 deduplicates by `delivery_id`.

If playback completed but completion delivery was uncertain, ESP32 may resend `proactive_playback_done`.

---

# 6. Device settings sync

Existing P9.1 candidate persistence has device settings such as playback volume, but no value is currently synchronized to firmware.

Additive Backend → ESP32:

```json
{
  "event": "device_settings",
  "version": 12,
  "settings": {
    "playback_volume": 80
  }
}
```

ESP32 → Backend:

```json
{
  "event": "device_settings_applied",
  "version": 12
}
```

Only include settings the firmware can actually apply. Initial physical scope is playback volume after hardware confirmation. `enabled`, notification behavior, quiet hours, voice profile, and speech speed remain Backend policy/audio concerns and must not be sent merely because they exist in `DeviceSettings`.

Voice profile/speech speed remain backend/audio-service concerns and do not need to be applied by ESP32.

---

# 7. Authentication and ownership

All additive events reuse the existing authenticated device connection.

Backend must verify that:

- active socket is authenticated;
- device identity maps to the correct DB device;
- device is active/not revoked;
- only owner-authorized configuration is delivered.

No new secret is introduced into the WS payload beyond the already authorized connection.

---

# 8. First-boot limitation

This contract covers remote configuration after the ESP32 can reach Backend.

Hardware must answer separately:

```text
How does a fresh device with zero known Wi-Fi credentials obtain its first network path?
```

Possible hardware-level choices are out of scope for Backend until agreed.

---

# 9. Acceptance matrix

Backend tests:

- additive schemas accepted/rejected correctly;
- existing v1.0.5 voice tests remain green;
- Wi-Fi config never appears in logs;
- pending config delivered on reconnect;
- terminal config not endlessly redelivered;
- proactive delivery deduplicated;
- proactive completion idempotent;
- telemetry updates latest status;
- log ingestion bounded/rate-limited;
- device settings versioning works.

Physical ESP32 tests:

- receive Wi-Fi config;
- rollback bad Wi-Fi;
- reconnect/auth after network change;
- report RSSI;
- proactive audio plays without voice request;
- duplicate proactive event does not replay;
- existing voice conversation still works.

Until those real-device tests exist, every item in this physical list remains `PENDING_PHYSICAL_ESP` even if Backend unit/fake-device tests later pass.
