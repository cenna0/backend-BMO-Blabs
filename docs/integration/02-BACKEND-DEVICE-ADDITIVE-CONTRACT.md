# BMO Backend API Service ↔ ESP32 Additive Device Contract

**Version:** 2.0.0
**Date:** 2026-08-20
**Rule:** Additive only. This file describes the Backend API service ↔ ESP32 protocol. Existing `BMO-MVP-HW-INTERFACE-CONTRACT-v1.0.5` voice behavior remains valid.

**Implementation state:** The exact source-defined Wi-Fi, log, telemetry,
settings, and pairing handlers are implemented in the promoted P9 runtime.
Firmware behavior and real-device acceptance remain `PENDING_PHYSICAL_ESP`;
this document must not be read as evidence that an ESP32 supports them.

**Current lifecycle:** Code-only enrollment is deployed in the production
Backend from immutable image source revision
`d1473d04f4b76ccb52cc8eeaff52a268504310f0`. That provenance is not current
Git HEAD.
Migration `20260818110000_pairing_code_only_enrollment` is applied in
production. Backend health and soak verification passed. Physical firmware
acceptance remains `PENDING_PHYSICAL_ESP`; the physical contract remains
separate from Mobile `/api/v1/ws` and existing hardware `/ws` voice behavior.

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

The current source-defined event inventory is exact.

ESP32 → Backend:

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

Backend → ESP32:

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

`backend/src/websocket/events.ts` is the event-name authority. Do not add an
event from a plan or design unless source is changed and the canonical docs are
updated in the same source change.

Current defaults are a 5-second auth timeout, 60-second native ping interval,
two missed pongs, and 8,192-byte JSON payload limit. Close behavior uses code
`4008` for `AUTHENTICATION_TIMEOUT`, `4001` for
`AUTHENTICATION_REQUIRED`/invalid pre-auth messages, `4003` for
`INVALID_CREDENTIALS`, and policy code `1008` for invalid post-auth messages.
A newer valid connection replaces the old one.

## 1.1 Application-device binding

Existing `/ws` authentication remains backward-compatible. The deployed
Backend can issue code-only enrollment after a valid legacy hardware
authentication; no firmware acceptance has been recorded.

The Backend resolves authenticated hardware/device identity to the application
`Device` row before allowing DB-owned additive features. The resolver rule is:

```text
Device.hardwareId == authenticated device_id
AND Device.status == ACTIVE
AND Device.tokenHash == SHA-256(authenticated device_token)
```

The resolved `Device.userId` owns every subsequent DB operation. Matching only a client-supplied UUID, pairing ID, or mobile-selected device ID is insufficient.

If no active owned application device can be bound:

- existing voice behavior remains available if it was already valid under the current voice contract;
- Backend must not deliver owner-specific Wi-Fi credentials or settings;
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
ACTIVE Device and normal application-bound settings and Wi-Fi behavior resume.
Owner-specific additive events remain blocked on the old
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

# 5. Generic proactive delivery boundary

Backend persists and arbitrates `CHAT`, `SCHEDULE`, and `WHATSAPP` delivery
intents with database idempotency, expiry, and user/device ownership. The
current hardware source schema does **not** define a proactive-audio event
family or install a physical sender.

Therefore `proactive_audio_ready`, `proactive_playback_done`, and
`proactive_playback_failed` are not current `/ws` events and must not be
implemented from historical plans. A future source change must define payloads,
tests, compatibility, documentation, and physical acceptance together.

Current Mobile `proactive_delivery_status` describes Backend-durable delivery
state; it is not evidence of a hardware event or physical playback.

---

# 6. Device settings sync

Production persistence and Backend source define versioned playback-volume
delivery and acknowledgement. Physical firmware application remains
`PENDING_PHYSICAL_ESP`.

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
- no non-source proactive hardware event is emitted;
- telemetry updates latest status;
- log ingestion bounded/rate-limited;
- device settings versioning works.

Physical ESP32 tests:

- receive Wi-Fi config;
- rollback bad Wi-Fi;
- reconnect/auth after network change;
- report RSSI;
- existing voice conversation still works.

Until those real-device tests exist, every item in this physical list remains `PENDING_PHYSICAL_ESP` even if Backend unit/fake-device tests later pass.
