# BMO Backend MVP — Public API and WebSocket Contract

**Versi:** 1.0.1  
**Status:** CANONICAL BACKEND INTERFACE  
**Authority eksternal:** Hardware Contract v1.0.5

> **Status:** Canonical backend MVP documentation package  
> **Derived from:** Backend Implementation v1.0.5, Hardware Contract v1.0.5, PRD v1.2.4  
> **Scope:** Backend voice MVP only. Firmware, mobile app, Spotify, WhatsApp, PostgreSQL, dan Prisma tidak diimplementasikan dalam package ini.


## Cara menggunakan file ini

File ini berisi kewajiban backend pada public REST API, WebSocket, upload WAV, idempotency, public state, dan error mapping. Jika detail public interface berbeda dari file ini, hardware contract versi terbaru menang dan mismatch harus dilaporkan sebelum coding dilanjutkan.

Agent tidak boleh menambahkan event, alias error, endpoint, acknowledgment, audio WebSocket, atau field wajib baru tanpa approval user.

## 15. Public Backend API

Implementasikan kontrak dari `../hardware-contract/BMO-MVP-HW-INTERFACE-CONTRACT-v1.0.5.md`.

Route wajib:

```text
GET  /health
WS   /ws
POST /api/v1/voice
GET  /audio/:audioId.mp3
```

Untuk route audio, kirim minimal:

```http
Content-Type: audio/mpeg
Content-Length: <bytes>
Cache-Control: no-store, private, max-age=0
```

Jangan aktifkan directory listing. Hanya UUID audio valid yang boleh diakses.

### 15.1 `GET /health`

Jangan bocorkan secret:

```json
{
  "status": "ok",
  "backend": "ok",
  "hermes": "ok",
  "audio_service": "ok",
  "rvc": "available"
}
```

Gunakan `degraded` jika RVC unavailable tetapi Kokoro fallback bekerja.

---

## 16. Persyaratan WebSocket

Implementasikan:

- autentikasi message maksimal 5 detik setelah connect;
- close code canonical: `4001` auth required, `4003` invalid credentials, `4008` auth timeout;
- koneksi terautentikasi terbaru menang;
- device registry in-memory;
- native ping setiap 60 detik;
- tutup koneksi setelah 2 missed pong;
- tidak menerapkan idle timeout satu jam selama ping/pong sehat;
- respons `authenticated` menyertakan `backend_state` dan `active_request_id` untuk sinkronisasi setelah reconnect/restart;
- backend hanya mengirim mode display `thinking`; `idle`, `speaking`, dan `error` dikendalikan firmware;
- tidak membuat atau mengirim mode display `listening`;
- kirim ulang pending `audio_ready` setelah reconnect jika MP3 masih valid;
- jangan membuat event `audio_ready_received`; reliability memakai reconnect state sync + deduplikasi `request_id`;
- validasi schema JSON;
- batas ukuran message kecil karena audio tidak dikirim melalui WebSocket.

ESP32 → Backend:

```text
authenticate
audio_playback_done
audio_playback_failed
```

Backend → ESP32:

```text
authenticated
authentication_failed
connection_replaced
display_status
audio_ready
request_failed
```

Jangan mengirim WAV atau MP3 melalui WebSocket.

### 16.1 Schema event canonical

ESP32 → Backend, autentikasi:

```json
{
  "event": "authenticate",
  "device_id": "bmo-001",
  "device_token": "<device-secret>"
}
```

Backend → ESP32, autentikasi sukses:

```json
{
  "event": "authenticated",
  "status": "ok",
  "device_id": "bmo-001",
  "backend_state": "idle | thinking | audio_ready",
  "active_request_id": null
}
```

Jika `backend_state` bukan `idle`, `active_request_id` wajib berisi UUID request aktif. Setelah respons auth, kirim ulang event state yang relevan.

Backend → ESP32, autentikasi gagal:

```json
{
  "event": "authentication_failed",
  "error": "INVALID_DEVICE_CREDENTIALS"
}
```

Setelah event tersebut, tutup socket dengan `4003`. Jika auth tidak dikirim dalam 5 detik gunakan `4008`; jika client mengirim event lain sebelum auth gunakan `4001`.

Backend → koneksi lama ketika koneksi baru mengambil alih:

```json
{
  "event": "connection_replaced",
  "reason": "NEW_CONNECTION_ESTABLISHED"
}
```

Backend → ESP32, mode thinking:

```json
{
  "event": "display_status",
  "request_id": "<uuid-v4>",
  "status": "thinking"
}
```

Backend → ESP32, audio siap:

```json
{
  "event": "audio_ready",
  "request_id": "<uuid-v4>",
  "audio_url": "https://api.personalbmo.web.id/audio/<audio-uuid>.mp3",
  "format": "mp3",
  "expires_in_seconds": 300
}
```

Hitung `expires_in_seconds` dari `expires_at - now` setiap kali event dikirim. Pada resend setelah reconnect, jangan mereset TTL menjadi 300 detik.

ESP32 → Backend, playback selesai:

```json
{
  "event": "audio_playback_done",
  "request_id": "<uuid-v4>"
}
```

ESP32 → Backend, playback gagal:

```json
{
  "event": "audio_playback_failed",
  "request_id": "<uuid-v4>",
  "reason": "DOWNLOAD_FAILED | DECODE_FAILED | PLAYBACK_FAILED"
}
```

Saat menerima `audio_playback_failed`, backend **tidak** mengirim ulang `audio_ready` dan tidak membuat MP3 baru. ESP32 sudah melakukan satu retry download dari awal sebelum mengirim event tersebut. Backend menghapus MP3, menandai request gagal, melepas busy state, dan menerima duplicate event secara idempotent.

Backend → ESP32, pipeline gagal:

```json
{
  "event": "request_failed",
  "request_id": "<uuid-v4>",
  "code": "NO_SPEECH | INVALID_AUDIO | STT_FAILED | HERMES_FAILED | TTS_FAILED | AUDIO_EXPIRED | PIPELINE_TIMEOUT | INTERNAL_ERROR",
  "recoverable": true
}
```

Schema `authentication_failed` dan `connection_replaced` harus sama persis dengan HW contract. Tolak event unknown atau schema invalid tanpa menjatuhkan seluruh process backend.

---

## 17. Persyaratan Upload Voice

`POST /api/v1/voice` menerima raw WAV bytes.

Header wajib:

```text
X-Device-Id
X-Device-Token
X-Request-Id
Content-Type: audio/wav
Content-Length
```

Validasi:

```text
WAV RIFF
PCM signed 16-bit little-endian
16 kHz
mono
maksimal 3 MB
maksimal 60 detik
request ID harus UUID v4
WebSocket harus aktif dan terautentikasi
satu request aktif per device
```

Cek WebSocket dua kali: sebelum menerima body besar dan sekali lagi setelah WAV selesai divalidasi tepat sebelum request state dibuat/HTTP `202` dikirim. Jika koneksi hilang di tengah upload, hapus file sementara dan return `409 WEBSOCKET_NOT_CONNECTED`.

Return `202 Accepted` segera setelah upload aman diterima dan request state dibuat. Pipeline dijalankan asynchronous.

Karena HTTP dan WebSocket merupakan koneksi terpisah, firmware dapat menerima `display_status: thinking` sebelum atau sesudah HTTP `202`. Seluruh event wajib memakai `request_id`; backend dan fake ESP32 test harus menguji kedua kemungkinan urutan.

Idempotency:

- request pertama yang valid: `202 Accepted`;
- duplicate `device_id + request_id` yang valid: `200 OK` dengan `duplicate:true` dan status publik aktual;
- status internal `accepted`, `transcribing`, `thinking`, dan `generating_voice` dipetakan menjadi status publik `processing`;
- request ID sama + device sama tidak boleh membuat pipeline baru;
- backend menghitung SHA-256 body WAV dan menyimpannya sebagai `input_sha256`;
- request ID sama dengan body hash berbeda: `409 REQUEST_ID_CONFLICT`;
- jika status `audio_ready` dan file belum expired, kirim ulang `audio_ready`;
- request ID sama dari device lain: `409 REQUEST_ID_CONFLICT`;
- tombstone completed/failed/expired dipertahankan baseline minimal 10 menit.

Urutan validasi wajib:

1. validasi credentials dan header dasar;
2. cek duplicate `device_id + request_id`;
3. jika duplicate, return status existing tanpa terkena `DEVICE_BUSY`;
4. jika request ID baru, baru cek satu request aktif per device.

Untuk duplicate request, baca body dengan batas 3 MB dan bandingkan SHA-256 terhadap request awal. `Content-Length` berbeda boleh menjadi early rejection, tetapi hash body adalah pemeriksaan final. Jika berbeda, return `409 REQUEST_ID_CONFLICT` dan jangan memulai pipeline baru.

### 17.1 HTTP response canonical

| Kondisi | HTTP | Error/status |
|---|---:|---|
| Request baru valid | `202` | `{"request_id":"<uuid>","status":"processing"}` |
| Duplicate valid | `200` | `{"request_id":"<uuid>","status":"processing|audio_ready|completed|failed|expired","duplicate":true,"error_code":null}` |
| WebSocket belum aktif/auth | `409` | `WEBSOCKET_NOT_CONNECTED` |
| Device masih memproses request lain | `409` | `DEVICE_BUSY` |
| Device credential salah | `401` | `INVALID_DEVICE_CREDENTIALS` |
| Header wajib hilang | `400` | `MISSING_REQUIRED_HEADER` |
| Request ID bukan UUID v4 | `400` | `INVALID_REQUEST_ID` |
| Request ID sama tetapi device/body berbeda | `409` | `REQUEST_ID_CONFLICT` |
| Content-Type bukan `audio/wav` | `415` | `UNSUPPORTED_AUDIO_TYPE` |
| Body lebih dari 3 MB | `413` | `AUDIO_TOO_LARGE` |
| WAV/PCM metadata tidak valid | `422` | `INVALID_AUDIO_FORMAT` |
| Error backend tak terduga sebelum accept | `500` | `INTERNAL_ERROR` |

Untuk `WEBSOCKET_NOT_CONNECTED`, gunakan body exact:

```json
{
  "error": "WEBSOCKET_NOT_CONNECTED",
  "message": "Device must reconnect before uploading audio."
}
```

Gunakan hanya kode `WEBSOCKET_NOT_CONNECTED`; jangan membuat alias `WEBSOCKET_NOT_READY`.

Jangan return `202` sebelum seluruh raw body diterima, ukuran/hash selesai dihitung, file WAV tersimpan aman, dan request state berhasil dibuat.

---

## 22. Mapping Error

| Sumber | Kode ke ESP32 |
|---|---|
| WAV rusak atau tidak sesuai | `INVALID_AUDIO` |
| Tidak ada speech/noise | `NO_SPEECH` |
| STT crash/timeout | `STT_FAILED` |
| Hermes network/HTTP/invalid output/provider error | `HERMES_FAILED` |
| Kokoro dan fallback gagal | `TTS_FAILED` |
| MP3 expired sebelum playback | `AUDIO_EXPIRED` |
| Total timeout | `PIPELINE_TIMEOUT` |
| Error tak terduga | `INTERNAL_ERROR` |

Event:

```json
{
  "event": "request_failed",
  "request_id": "<uuid>",
  "code": "HERMES_FAILED",
  "recoverable": true
}
```

Firmware yang memainkan voice error lokal dan ekspresi error.

---
