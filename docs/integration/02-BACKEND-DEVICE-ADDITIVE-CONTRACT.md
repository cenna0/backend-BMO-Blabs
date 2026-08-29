# Joy Backend API Service ↔ ESP32 Additive Device Contract

**Version:** 3.0.0  
**Status:** `PRODUCTION_VERIFIED`  
**Base WebSocket URL:** `wss://api.personalbmo.web.id/ws`  
**Audio Upload Endpoint:** `POST https://api.personalbmo.web.id/api/v1/voice`  
**Audio Download Endpoint:** `GET https://api.personalbmo.web.id/audio/:audioId.mp3`

---

## 1. Architectural Principles & Compatibility

This contract specifies all bidirectional WebSocket events and HTTP endpoints between the physical Joy ESP32 device and the Joy Backend Gateway. All events are strictly additive and backwards-compatible with the Joy MVP hardware contract.

---

## 2. Full Inbound Event Inventory (ESP32 → Backend)

### 2.1 Authentication & Session
- **`authenticate`**:
  ```json
  {
    "event": "authenticate",
    "device_id": "joy-001",
    "device_token": "secret-device-token"
  }
  ```
  Must be sent within 5,000 ms of WebSocket connection establishment.

### 2.2 Playback Lifecycle
- **`audio_playback_done`**:
  ```json
  {
    "event": "audio_playback_done",
    "request_id": "uuid"
  }
  ```
- **`audio_playback_failed`**:
  ```json
  {
    "event": "audio_playback_failed",
    "request_id": "uuid",
    "reason": "DOWNLOAD_FAILED" | "DECODE_FAILED" | "PLAYBACK_FAILED"
  }
  ```

### 2.3 Voice Capture & Reservation Protocol
- **`voice_reserve`**:
  ```json
  {
    "event": "voice_reserve",
    "request_id": "uuid"
  }
  ```
  Initiates a capture lease request prior to streaming audio.
- **`voice_cancel`**:
  ```json
  {
    "event": "voice_cancel",
    "request_id": "uuid",
    "lease_id": "uuid",
    "reserve_receipt": "receipt-string",
    "reason": "NO_SPEECH" | "LOCAL_ABORT" | "UPLOAD_HANDOFF_FAILED"
  }
  ```

### 2.4 Proactive Speech Delivery Lifecycle
- **`proactive_offer_accepted`**:
  ```json
  {
    "event": "proactive_offer_accepted",
    "delivery_id": "uuid",
    "attempt_id": "uuid",
    "offer_receipt": "receipt-string"
  }
  ```
- **`proactive_done`**:
  ```json
  {
    "event": "proactive_done",
    "source": "SCHEDULE",
    "delivery_id": "uuid",
    "attempt_id": "uuid",
    "lease_id": "uuid",
    "audio_receipt": "receipt-string",
    "reason": "COMPLETED"
  }
  ```
- **`proactive_failed`**:
  ```json
  {
    "event": "proactive_failed",
    "source": "SCHEDULE",
    "delivery_id": "uuid",
    "attempt_id": "uuid",
    "lease_id": "uuid",
    "audio_receipt": "receipt-string",
    "reason": "DOWNLOAD_FAILED" | "DECODE_FAILED" | "PLAYBACK_FAILED" | "CANCELLED" | "LEASE_EXPIRED" | "WATCHDOG_STALLED"
  }
  ```

### 2.5 Hardware Diagnostics, Telemetry & Settings
- **`device_telemetry`**:
  ```json
  {
    "event": "device_telemetry",
    "firmware_version": "1.4.0",

    "wifi_connected": true,
    "wifi_rssi": -62,
    "battery_percent": null

  }
  ```
- **`device_log`**:
  ```json
  {
    "event": "device_log",
    "level": "INFO" | "WARN" | "ERROR",
    "code": "VOICE_PIPELINE",
    "message": "I2S DMA buffer drained successfully",
    "timestamp": "2026-08-29T10:00:00.000Z",
    "metadata": {"buffer": "drained"}
  }
  ```
- **`device_settings_applied`**:
  ```json
  {
    "event": "device_settings_applied",
    "version": 2

  }
  ```
- **`wifi_configuration_received`**:
  ```json
  {
    "event": "wifi_configuration_received",
    "configuration_id": "uuid"
  }
  ```
- **`wifi_configuration_result`**:
  ```json
  {
    "event": "wifi_configuration_result",
    "configuration_id": "uuid",
    "status": "CONNECTED" | "ROLLED_BACK" | "FAILED",
    "rssi": -62,
    "reason": "AUTH_FAILED" | "SSID_NOT_FOUND" | "DHCP_FAILED" | "CONNECT_TIMEOUT" | "INTERNAL_ERROR"
  }
  ```
- **`pairing_mode_request`**:
  ```json
  {
    "event": "pairing_mode_request"
  }
  ```

---

## 3. Full Outbound Event Inventory (Backend → ESP32)

### 3.1 Authentication & Status
- **`authenticated`**:
  ```json
  {
    "event": "authenticated",
    "status": "ok",
    "device_id": "joy-001",
    "backend_state": "idle",
    "active_request_id": null
  }
  ```
- **`authentication_failed`**:
  ```json
  {
    "event": "authentication_failed",
    "error": "INVALID_DEVICE_CREDENTIALS"
  }
  ```
- **`connection_replaced`**:
  ```json
  {
    "event": "connection_replaced",
    "reason": "NEW_CONNECTION_ESTABLISHED"
  }
  ```
- **`display_status`**:
  ```json
  {
    "event": "display_status",
    "request_id": "uuid",
    "status": "thinking"
  }
  ```

### 3.2 Voice Pipeline Turn Responses
- **`audio_ready`**:
  ```json
  {
    "event": "audio_ready",
    "request_id": "uuid",
    "audio_url": "https://api.personalbmo.web.id/audio/uuid.mp3",
    "format": "mp3",
    "expires_in_seconds": 300,
    "transcript": "Halo Joy apa kabar?",
    "response_text": "Aku baik banget! Kamu gimana hari ini?",
    "text": "Aku baik banget! Kamu gimana hari ini?"
  }
  ```
- **`request_failed`**:
  ```json
  {
    "event": "request_failed",
    "request_id": "uuid",
    "code": "NO_SPEECH" | "INVALID_AUDIO" | "STT_FAILED" | "HERMES_FAILED" | "TTS_FAILED" | "AUDIO_EXPIRED" | "PIPELINE_TIMEOUT" | "INTERNAL_ERROR",
    "recoverable": true
  }
  ```

### 3.3 Voice Reservation Responses
- **`voice_reserve_accepted`**:
  ```json
  {
    "event": "voice_reserve_accepted",
    "request_id": "uuid",
    "lease_id": "uuid",
    "reserve_receipt": "receipt-string",
    "capture_lease_duration_seconds": 45,
    "capture_lease_expires_at": "2026-08-27T10:00:45.000Z"
  }
  ```
- **`voice_reserve_rejected`**:
  ```json
  {
    "event": "voice_reserve_rejected",
    "request_id": "uuid",
    "reason": "UNAUTHENTICATED" | "NOT_IDLE" | "BUSY" | "STALE_REQUEST"
  }
  ```
- **`voice_reserve_expired`**:
  ```json
  {
    "event": "voice_reserve_expired",
    "request_id": "uuid",
    "lease_id": "uuid",
    "reserve_receipt": "receipt-string"
  }
  ```

### 3.4 Proactive Speech Delivery
- **`proactive_offer`**:
  ```json
  {
    "event": "proactive_offer",
    "delivery_id": "uuid",
    "attempt_id": "uuid",
    "offer_receipt": "receipt-string",
    "expires_at_ms": 1724750030000
  }
  ```
- **`proactive_audio_ready`**:
  ```json
  {
    "event": "proactive_audio_ready",
    "source": "SCHEDULE",
    "delivery_id": "uuid",
    "attempt_id": "uuid",
    "lease_id": "uuid",
    "audio_url": "https://api.personalbmo.web.id/audio/uuid.mp3",
    "audio_receipt": "receipt-string",
    "expires_at_ms": 1724750300000
  }
  ```
- **`proactive_cancel`**:
  ```json
  {
    "event": "proactive_cancel",
    "source": "SCHEDULE",
    "delivery_id": "uuid",
    "attempt_id": "uuid",
    "lease_id": "uuid"
  }
  ```

### 3.5 Device Configuration & Pairing
- **`pairing_code`**:
  ```json
  {
    "event": "pairing_code",
    "code": "123456",
    "expires_at": "2026-08-27T10:10:00.000Z"
  }
  ```
- **`pairing_completed`**:
  ```json
  {
    "event": "pairing_completed",
    "status": "ok",
    "device_id": "joy-001",
    "backend_state": "idle",
    "active_request_id": null
  }
  ```
- **`device_settings`**:
  ```json
  {
    "event": "device_settings",
    "version": 2
    "settings": {
      "playback_volume": 85
    }
  }
  ```
- **`wifi_configuration`**:
  ```json
  {
    "event": "wifi_configuration",
    "configuration_id": "uuid",
    "ssid": "Home-WiFi",
    "security": "WPA_PSK",
    "password": "decrypted-password"
  }
  ```
- **`display_qr`**:
  ```json
  {
    "event": "display_qr",
    "qr": "2@abc...xyz,123...",
    "expires_at": "2026-08-27T10:10:00.000Z"
  }
  ```
  Instructs the ESP32 to render the WhatsApp pairing QR code directly on its 320x240 LCD display via `qrcodegen`.
- **`clear_qr`**:
  ```json
  {
    "event": "clear_qr"
  }
  ```
  Instructs the ESP32 to clear the QR code display overlay and return to the normal IDLE face animation after WhatsApp pairing confirms or expires.

---

## 4. HTTP Voice Upload Contract (`POST /api/v1/voice`)

### Headers
\`\`\`http
Content-Type: audio/wav
X-Device-Id: joy-001
X-Device-Token: <deviceToken>
X-Request-Id: <uuid-v4>
X-Voice-Lease-Id: <uuid-v4> (optional with voice reservation)
X-Voice-Reserve-Receipt: <string> (optional with voice reservation)
\`\`\`

### Audio Constraints
- Format: WAV PCM 16-bit signed, Little-Endian, Mono.
- Sampling rate: 16,000 Hz (16 kHz).
- Maximum duration: 60 seconds (max ~1.92 MB).
- Server response: `202 Accepted` immediately, processing asynchronously.
