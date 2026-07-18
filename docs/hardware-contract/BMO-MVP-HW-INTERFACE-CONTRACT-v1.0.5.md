# BMO MVP — Kontrak Antarmuka Hardware ↔ Backend

**Versi:** 1.0.5
**Tanggal:** 2026-07-18
**Cakupan:** Pipeline suara MVP
**Ditujukan untuk:** Tim hardware/firmware ESP32-S3 dan tim backend BMO

> Bahasa dokumen ini adalah Bahasa Indonesia. Nama event, header HTTP, field JSON, dan kode error tetap menggunakan English agar konsisten di implementasi. BMO sendiri akan berbicara dalam English.

## 0. Status Keputusan Dokumen

Dokumen ini membedakan dua jenis keputusan:

**Keputusan yang sudah dikunci dari diskusi:**

- ESP32 membuka WebSocket ke backend dan autentikasi melalui message JSON, bukan token di URL.
- Upload audio berupa satu file WAV utuh melalui HTTP raw body `audio/wav`, bukan `multipart/form-data` dan bukan audio chunk WebSocket.
- Rekaman berhenti setelah diam 2,5 detik atau maksimal 60 detik; format input WAV adalah PCM signed 16-bit little-endian, 16 kHz, mono.
- Upload ditolak jika WebSocket device belum tersambung dan terautentikasi.
- ESP32 membuat UUID v4 sebagai `X-Request-Id` dan memakai ID yang sama saat retry rekaman yang sama.
- Backend hanya menyimpan state request di memory untuk MVP.
- Backend mengirim URL MP3 melalui WebSocket; ESP32 mengunduh MP3 melalui HTTP.
- Mode display MVP hanya `idle`, `thinking`, `speaking`, dan `error`; tidak ada mode `listening` terpisah.
- Mode `speaking` dimulai oleh firmware ketika playback benar-benar mulai.
- Download MP3 diulang satu kali dari awal jika gagal; HTTP Range/resume belum dipakai.
- BMO selalu berbicara dalam English.
- Error ditampilkan melalui ekspresi hardware dan audio error lokal.

**Baseline teknis yang masih boleh disesuaikan setelah benchmark:**

- auth timeout 5 detik;
- heartbeat 60 detik dan dua missed pong;
- retry upload maksimal dua kali setelah percobaan awal;
- batas ukuran upload 3 MB;
- MP3 mono 24 kHz/96 kbps;
- timeout upload 90 detik;
- retention tombstone request 10 menit.

Perubahan terhadap keputusan yang sudah dikunci harus dibahas bersama. Nilai baseline boleh diubah jika hasil test ESP32/VPS membuktikan konfigurasi lain lebih stabil, tanpa mengubah bentuk endpoint dan event utama.

Detail seperti `backend_state`, SHA-256 body, tombstone request, dan HTTP `410 AUDIO_EXPIRED` adalah guardrail teknis yang ditambahkan saat audit agar implementasi tidak ambigu. Detail tersebut tidak mengubah alur utama yang sudah disepakati.

> Untuk pipeline suara MVP, dokumen ini menjadi kontrak yang lebih baru daripada Bab 5 dan Bab 9 PRD v1.1.0 yang masih menyebut audio chunk WebSocket.

---

## 1. Tujuan MVP

BMO harus mampu:

1. Mendeteksi wake word secara lokal di ESP32-S3.
2. Merekam suara user secara utuh.
3. Menghentikan rekaman setelah user diam selama **2,5 detik**, dengan batas keras **60 detik**.
4. Mengirim satu file WAV utuh ke backend melalui HTTP.
5. Menerima URL MP3 sementara dari backend melalui WebSocket.
6. Mengambil MP3 melalui HTTP secara bertahap sambil memutarnya.
7. Memberi tahu backend ketika playback selesai atau gagal.

Pada MVP ini **tidak ada audio chunk melalui WebSocket**. Audio input dikirim sebagai satu file WAV utuh.

---

## 2. Gambaran Komunikasi

```text
ESP32-S3 BMO                         Backend VPS
     │                                    │
     │── buka WebSocket ─────────────────►│
     │── authenticate ───────────────────►│
     │◄─ authenticated ───────────────────│
     │                                    │
     │  [wake word + rekam lokal]         │
     │                                    │
     │── HTTP POST raw WAV ──────────────►│
     │◄─ HTTP 202 processing ─────────────│
     │◄─ display_status: thinking ────────│
     │                                    │
     │◄─ audio_ready + URL sementara ─────│
     │── HTTP GET MP3 ───────────────────►│
     │◄─ byte MP3 ────────────────────────│
     │                                    │
     │  [mode speaking + playback lokal]  │
     │                                    │
     │── audio_playback_done ────────────►│
     │                                    │
     │  [kembali idle secara lokal]       │
```

Pembagian protokol:

| Kebutuhan | Protokol |
|---|---|
| Autentikasi device dan event kecil real-time | WebSocket |
| Upload file WAV utuh | HTTP POST |
| Mengambil audio MP3 hasil TTS | HTTP GET |

Backend **tidak membuka koneksi baru ke IP lokal ESP32**. ESP32 yang membuka dan mempertahankan koneksi WebSocket ke backend.

---

## 3. Identitas Device

Kredensial awal MVP:

```text
device_id: bmo-001
device_token: secret acak unik
```

`device_token` digunakan untuk:

- autentikasi WebSocket;
- autentikasi upload WAV.

Aturan:

- Jangan simpan token di repository publik.
- Jangan taruh token di query string atau URL WebSocket.
- Simpan token di konfigurasi firmware yang aman.

---

## 4. Kontrak WebSocket

### 4.1 Endpoint

Sebelum domain tersedia:

```text
ws://<IP_VPS>:3000/ws
```

Setelah domain dan TLS tersedia:

```text
wss://<DOMAIN_API_BMO>/ws
```

ESP32 adalah **WebSocket client**. Backend adalah **WebSocket server**.

### 4.2 Autentikasi

Setelah koneksi WebSocket terbuka, ESP32 wajib mengirim autentikasi maksimal dalam **5 detik**.

ESP32 → Backend:

```json
{
  "event": "authenticate",
  "device_id": "bmo-001",
  "device_token": "<device-secret>"
}
```

Backend → ESP32 jika berhasil:

```json
{
  "event": "authenticated",
  "status": "ok",
  "device_id": "bmo-001",
  "backend_state": "idle",
  "active_request_id": null
}
```

`backend_state` bernilai `idle`, `thinking`, atau `audio_ready`. Field ini dipakai untuk sinkronisasi setelah reconnect atau backend restart:

- `idle`: firmware membersihkan request lokal yang tidak lagi dikenali backend dan kembali ke `idle`;
- `thinking`: backend kemudian mengirim ulang `display_status: thinking` untuk `active_request_id`;
- `audio_ready`: backend kemudian mengirim ulang event `audio_ready` jika MP3 masih valid.

Backend → ESP32 jika gagal:

```json
{
  "event": "authentication_failed",
  "error": "INVALID_DEVICE_CREDENTIALS"
}
```

Setelah autentikasi gagal, backend menutup koneksi.

Close code custom yang dipakai agar firmware dapat membedakan penyebab:

```text
4001  AUTHENTICATION_REQUIRED   pesan pertama bukan authenticate / belum auth
4003  INVALID_CREDENTIALS       device_id atau device_token salah
4008  AUTHENTICATION_TIMEOUT    authenticate tidak diterima dalam 5 detik
```

Firmware tetap wajib membaca event JSON bila sempat diterima, lalu memakai close code sebagai fallback diagnosis dan melakukan reconnect hanya untuk kondisi yang masuk akal.

### 4.3 Koneksi ganda

Jika `bmo-001` membuka koneksi baru sementara koneksi lama masih aktif:

1. Koneksi terbaru yang sudah terautentikasi menjadi koneksi aktif.
2. Backend mencoba mengirim event berikut ke koneksi lama:

```json
{
  "event": "connection_replaced",
  "reason": "NEW_CONNECTION_ESTABLISHED"
}
```

3. Backend menutup koneksi lama.
4. Semua event selanjutnya dikirim melalui koneksi baru.

### 4.4 Heartbeat

Backend mengirim native WebSocket `ping` setiap **60 detik**.

- ESP32 wajib membalas dengan `pong`.
- Jika ESP32 gagal membalas **2 kali berturut-turut**, backend menutup koneksi.
- ESP32 kemudian melakukan reconnect otomatis.

Delay reconnect:

```text
1s → 2s → 4s → 8s → 16s → maksimal 30s
```

Setelah koneksi terautentikasi kembali, delay di-reset ke 1 detik.

Tidak ada application-level idle timeout satu jam pada MVP. Selama ping/pong sehat, WebSocket tetap dipertahankan walaupun tidak ada voice request.

---

## 5. Perilaku Rekaman Lokal

### 5.1 Mode layar

```text
idle       default; layar tetap memakai mode ini saat wake word/rekaman lokal
→ thinking setelah backend menerima upload
→ speaking saat audio MP3 benar-benar mulai diputar
→ idle     setelah playback selesai

error      dipakai saat request/playback gagal, lalu kembali ke idle
```

Tanggung jawab mode:

| Mode | Pengendali |
|---|---|
| `idle` | Firmware lokal |
| `thinking` | Backend melalui WebSocket |
| `speaking` | Firmware lokal saat playback dimulai |
| `error` | Firmware lokal setelah menerima event error |

Wake word dan proses rekaman tetap merupakan state internal firmware, tetapi **bukan mode display terpisah**. Firmware mengatur `speaking`, `error`, dan kembali ke `idle`; backend hanya memerintahkan `thinking`.

### 5.2 Kapan rekaman berhenti

Rekaman dihentikan saat kondisi pertama terpenuhi:

- user diam selama **2,5 detik**; atau
- durasi rekaman mencapai **60 detik**.

### 5.3 Format WAV wajib

```text
Container    : WAV (RIFF)
Codec        : PCM signed 16-bit little-endian
Sample rate  : 16.000 Hz
Channel      : mono
Ukuran maks  : 3 MB
Durasi maks  : 60 detik
```

Jangan mengirim MP3, AAC, base64, JSON audio, atau audio chunk melalui WebSocket pada MVP ini.

---

## 6. Upload WAV Utuh

### 6.1 Request ID

Sebelum upload rekaman baru, ESP32 membuat UUID v4:

```text
550e8400-e29b-41d4-a716-446655440000
```

Aturan:

- Rekaman baru menggunakan request ID baru.
- Retry untuk rekaman yang sama wajib memakai request ID yang sama.
- Tujuannya mencegah satu rekaman diproses dua kali.

### 6.2 Endpoint HTTP

Sebelum domain:

```text
POST http://<IP_VPS>:3000/api/v1/voice
```

Setelah domain:

```text
POST https://<DOMAIN_API_BMO>/api/v1/voice
```

### 6.3 Header request

```http
POST /api/v1/voice HTTP/1.1
Host: <backend-host>
X-Device-Id: bmo-001
X-Device-Token: <device-secret>
X-Request-Id: <uuid-v4>
Content-Type: audio/wav
Content-Length: <ukuran-byte-wav>
```

Body HTTP langsung berisi byte file WAV:

```text
[RIFF/WAV binary bytes]
```

Jangan menggunakan `multipart/form-data`.

### 6.4 Respons sukses

```http
HTTP/1.1 202 Accepted
Content-Type: application/json
```

```json
{
  "request_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "processing"
}
```

Setelah itu backend mengirim melalui WebSocket:

```json
{
  "event": "display_status",
  "request_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "thinking"
}
```

> **Catatan urutan:** HTTP response dan event WebSocket melewati dua koneksi berbeda. Walaupun backend mengirim HTTP `202` terlebih dahulu, firmware tidak boleh mengasumsikan urutan kedatangannya. `display_status: thinking` dapat tiba sesaat sebelum atau sesudah HTTP `202`. Selalu korelasikan keduanya menggunakan `request_id`.

### 6.5 Retry dan idempotency

Jika upload gagal sebelum ESP32 menerima respons valid:

1. Pastikan WebSocket masih terhubung dan terautentikasi.
2. Upload ulang WAV yang sama.
3. Gunakan `X-Request-Id` yang sama.

Jika backend sudah pernah menerima request ID tersebut, backend tidak membuat pipeline kedua. Duplicate request yang valid dibalas dengan **HTTP `200 OK`** dan status publik request lama:

```json
{
  "request_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "processing | audio_ready | completed | failed | expired",
  "duplicate": true,
  "error_code": null
}
```

Status internal backend seperti `accepted`, `transcribing`, `thinking`, dan `generating_voice` semuanya dipetakan menjadi status publik `processing`. Jika status `failed`, `error_code` berisi kode kegagalan terakhir.

Urutan validasi backend wajib seperti ini:

1. autentikasi device;
2. cek apakah kombinasi `device_id + request_id` sudah ada;
3. jika duplicate, kembalikan status request lama;
4. baru cek apakah device memiliki request lain dan balas `DEVICE_BUSY`.

Dengan urutan ini, retry request yang sama tidak salah dianggap sebagai request baru saat device masih busy.

Jika status lama sudah `audio_ready` dan MP3 belum expired, backend juga mengirim ulang event `audio_ready` melalui WebSocket. Backend menyimpan tombstone request yang sudah selesai selama baseline **10 menit** supaya retry terlambat tidak membuat pipeline kedua.

Backend menghitung SHA-256 body WAV. Jika `device_id + request_id` sama tetapi byte WAV berbeda, backend membalas `REQUEST_ID_CONFLICT`. Firmware tidak perlu mengirim header hash tambahan.

Baseline retry upload jika koneksi HTTP putus tanpa respons valid adalah maksimal **3 total attempts**:

```text
percobaan awal → tunggu 1 detik → retry 1 → tunggu 2 detik → retry 2 → gagal final
```

Semua retry wajib memakai WAV dan `X-Request-Id` yang sama.

### 6.6 Error upload

#### WebSocket belum tersambung atau belum terautentikasi

```http
HTTP/1.1 409 Conflict
```

```json
{
  "error": "WEBSOCKET_NOT_CONNECTED",
  "message": "Device must reconnect before uploading audio."
}
```

Kode canonical hanya `WEBSOCKET_NOT_CONNECTED`. Jangan implementasikan alias `WEBSOCKET_NOT_READY` agar firmware dan backend tidak memiliki dua nama untuk kondisi yang sama.

#### Device masih sibuk memproses request sebelumnya

```http
HTTP/1.1 409 Conflict
```

```json
{
  "error": "DEVICE_BUSY",
  "message": "Previous voice request is still processing."
}
```

#### Kredensial salah

```http
HTTP/1.1 401 Unauthorized
```

```json
{
  "error": "INVALID_DEVICE_CREDENTIALS"
}
```

#### Header wajib tidak lengkap

```http
HTTP/1.1 400 Bad Request
```

```json
{
  "error": "MISSING_REQUIRED_HEADER"
}
```

#### Request ID bukan UUID v4

```http
HTTP/1.1 400 Bad Request
```

```json
{
  "error": "INVALID_REQUEST_ID"
}
```

#### Request ID bentrok

Terjadi jika request ID yang sama dipakai oleh device lain atau dipakai ulang dengan ukuran audio yang berbeda.

```http
HTTP/1.1 409 Conflict
```

```json
{
  "error": "REQUEST_ID_CONFLICT"
}
```

#### Content-Type salah

```http
HTTP/1.1 415 Unsupported Media Type
```

```json
{
  "error": "UNSUPPORTED_AUDIO_TYPE",
  "expected": "audio/wav"
}
```

#### File terlalu besar

```http
HTTP/1.1 413 Payload Too Large
```

```json
{
  "error": "AUDIO_TOO_LARGE",
  "max_bytes": 3145728
}
```

#### Format WAV tidak sesuai

```http
HTTP/1.1 422 Unprocessable Entity
```

```json
{
  "error": "INVALID_AUDIO_FORMAT",
  "expected": "WAV PCM 16-bit, 16 kHz, mono"
}
```

### 6.7 Tindakan firmware berdasarkan hasil upload

| Kondisi | Tindakan firmware |
|---|---|
| Tidak ada HTTP response/network putus | Retry maksimal 2 kali dengan request ID yang sama |
| `200` duplicate + `processing` | Tetap tunggu event WebSocket untuk request yang sama |
| `200` duplicate + `audio_ready` | Tunggu/konsumsi ulang event `audio_ready`; jangan memulai playback kedua jika sudah download/play |
| `200` duplicate + `completed` | Bersihkan request lokal dan kembali `idle` |
| `200` duplicate + `failed`/`expired` | Tampilkan error lokal berdasarkan `error_code`, lalu kembali `idle` |
| `202` accepted | Tunggu event WebSocket untuk request ID yang sama |
| `409 WEBSOCKET_NOT_CONNECTED` | Reconnect + autentikasi WebSocket, lalu retry upload yang sama |
| `409 DEVICE_BUSY` | Jangan retry sebagai request baru; tunggu request aktif selesai |
| `409 REQUEST_ID_CONFLICT` | Buang request ID tersebut, tampilkan error lokal, dan buat ID baru hanya untuk rekaman baru |
| `400/413/415/422` | Jangan retry byte WAV yang sama; tampilkan error lokal dan kembali `idle` |
| `401` | Jangan retry sampai device token/config diperbaiki |
| `5xx` | Retry maksimal 2 kali dengan request ID yang sama; setelah itu error lokal |

Timeout upload HTTP baseline: **90 detik**.

---

## 7. Menerima Hasil TTS

Backend membuat **satu audio TTS utuh terlebih dahulu**. Backend tidak membuat TTS per kata atau per potongan kalimat supaya intonasi tetap natural.

### 7.1 Event `audio_ready`

Backend → ESP32:

```json
{
  "event": "audio_ready",
  "request_id": "550e8400-e29b-41d4-a716-446655440000",
  "audio_url": "http://<IP_VPS>:3000/audio/6b6a1bc8-55b0-4e88-b62e-289ae089fd54.mp3",
  "format": "mp3",
  "expires_in_seconds": 300
}
```

Setelah domain tersedia, URL wajib menggunakan HTTPS.

`expires_in_seconds` adalah sisa TTL pada saat event dikirim, bukan selalu angka awal 300. Saat event dikirim ulang setelah reconnect, backend wajib mengirim sisa waktu yang sebenarnya.

Nama/path audio menggunakan UUID acak dan tidak sama dengan request ID.

Firmware wajib menyimpan state lokal minimal berikut selama satu interaksi:

```text
current_request_id
playback_state: waiting | downloading | playing | done_pending_send | failed_pending_send
```

Jika event `audio_ready` untuk request ID yang sama diterima ulang akibat reconnect:

- saat `downloading` atau `playing`: jangan mulai playback kedua; abaikan event duplicate;
- saat `done_pending_send`: kirim ulang `audio_playback_done`;
- saat `failed_pending_send`: kirim ulang `audio_playback_failed`;
- saat belum pernah mulai download: gunakan URL terbaru selama belum expired.

Ini mencegah satu jawaban BMO diputar dua kali ketika hanya koneksi WebSocket yang sempat putus.

MVP tidak memakai event acknowledgment terpisah seperti `audio_ready_received`. Keandalan `audio_ready` ditangani melalui sinkronisasi state saat reconnect, pengiriman ulang event bila file masih valid, dan deduplikasi berdasarkan `request_id` di firmware.

### 7.2 Mengambil dan memutar MP3

ESP32 melakukan:

```http
GET /audio/<random-uuid>.mp3
```

Respons sukses:

```http
HTTP/1.1 200 OK
Content-Type: audio/mpeg
Content-Length: <ukuran-byte-mp3>
Cache-Control: no-store, private, max-age=0
```

Jika URL sudah melewati TTL:

```http
HTTP/1.1 410 Gone
Content-Type: application/json
```

```json
{
  "error": "AUDIO_EXPIRED"
}
```

Firmware memperlakukan HTTP `410` sebagai kegagalan final untuk URL tersebut, tidak melakukan retry download kedua, memainkan error lokal, lalu kembali `idle`.

Target encoding awal MVP:

```text
Codec       : MP3
Channel     : mono
Sample rate : 24 kHz
Bitrate     : 96 kbps
```

Nilai sample rate dan bitrate harus dibuat configurable di backend. Tim hardware wajib menguji decoder ESP32 terhadap target awal tersebut; jika decoder tidak stabil, backend menyesuaikan output tanpa mengubah event atau endpoint.

MP3 sudah selesai dibuat penuh di server. ESP32 boleh membacanya secara progresif ke buffer kecil sambil memutar byte yang sudah tersedia.

Rekomendasi:

1. Buffer awal sekitar **32–64 KB** atau **0,5–1 detik audio**.
2. Mulai playback.
3. Terus isi buffer sambil decoder berjalan.
4. Masuk mode `speaking` tepat saat playback benar-benar dimulai.

Membaca file HTTP secara bertahap tidak mengubah intonasi TTS karena TTS telah dibuat utuh sebelumnya.

### 7.3 Playback selesai

Setelah playback selesai, firmware:

1. mengubah layar ke `idle`;
2. membersihkan buffer lokal;
3. mengirim event berikut:

```json
{
  "event": "audio_playback_done",
  "request_id": "550e8400-e29b-41d4-a716-446655440000"
}
```

Backend lalu:

- menghapus MP3;
- melepas status busy device;
- menandai request selesai.

`audio_playback_done` boleh dikirim ulang setelah reconnect jika firmware belum yakin event sebelumnya sampai. Backend wajib menanganinya secara idempotent dan tidak menganggap duplicate sebagai error fatal.

### 7.4 Retry download/playback

Jika download MP3 gagal:

1. Buang buffer yang belum lengkap.
2. Tunggu 1 detik.
3. Download ulang dari awal sebanyak **1 kali**.
4. HTTP Range/resume tidak wajib untuk MVP.

Jika retry masih gagal:

```json
{
  "event": "audio_playback_failed",
  "request_id": "550e8400-e29b-41d4-a716-446655440000",
  "reason": "DOWNLOAD_FAILED"
}
```

Alasan kegagalan yang valid:

```text
DOWNLOAD_FAILED
DECODE_FAILED
PLAYBACK_FAILED
```

Firmware kemudian selalu menampilkan ekspresi error. Firmware mencoba memainkan audio error lokal jika subsistem audio masih berfungsi; untuk `PLAYBACK_FAILED`, ekspresi error tetap wajib walaupun audio error tidak dapat diputar. Setelah itu firmware kembali ke `idle`.

---

## 8. Event Error dari Backend

Backend → ESP32:

```json
{
  "event": "request_failed",
  "request_id": "550e8400-e29b-41d4-a716-446655440000",
  "code": "NO_SPEECH",
  "recoverable": true
}
```

Kode error MVP:

```text
NO_SPEECH
INVALID_AUDIO
STT_FAILED
HERMES_FAILED
TTS_FAILED
AUDIO_EXPIRED
PIPELINE_TIMEOUT
INTERNAL_ERROR
```

Perilaku firmware:

| Kode | Tampilan | Audio lokal |
|---|---|---|
| `NO_SPEECH` | Ekspresi error | “Sorry, it is too noisy. BMO cannot hear you.” |
| Error lain yang recoverable | Ekspresi error | “Oh no. BMO could not answer. Please try again.” |

Audio error disimpan lokal di BMO agar tetap dapat dimainkan walaupun backend/TTS gagal.

Setelah audio error selesai, firmware kembali ke `idle`.

---

## 9. Reconnect Saat Respons Masih Diproses

Jika WebSocket putus ketika backend masih memproses request:

1. ESP32 melakukan reconnect.
2. ESP32 autentikasi ulang.
3. Backend mengecek pending request untuk `bmo-001`.
4. Jika request masih diproses, backend mengirim ulang `display_status: thinking`.
5. Jika MP3 sudah tersedia dan belum expired, backend mengirim ulang `audio_ready`.
6. ESP32 mengambil dan memutar audio seperti biasa.

Jika ESP32 sedang `downloading` atau `playing` untuk request yang sama ketika reconnect, jangan mulai playback kedua. Gunakan aturan duplicate `audio_ready` pada Bagian 7.1. Jika playback sebenarnya sudah selesai tetapi event completion belum terkirim, kirim ulang `audio_playback_done` setelah autentikasi berhasil.

Jika backend sempat restart, request store in-memory dapat hilang. Dalam kondisi itu `authenticated.backend_state` akan bernilai `idle`; firmware harus membatalkan request lokal yang menggantung dan kembali ke `idle`. Ini adalah keterbatasan MVP yang diterima.

MP3 memiliki TTL **5 menit**. Jika sudah expired, backend mengirim `request_failed` dengan code `AUDIO_EXPIRED` dan firmware kembali ke `idle` setelah memainkan error lokal.

---

## 10. Satu Request Aktif per Device

Pada MVP, BMO hanya boleh memiliki satu request aktif:

```text
idle (termasuk rekaman lokal) → thinking → speaking → idle
```

Selama `thinking` atau `speaking`:

- wake word baru boleh diabaikan;
- upload baru tidak dilakukan;
- backend menolak request baru dengan `DEVICE_BUSY`.

---

## 11. Checklist Implementasi Firmware

- [ ] Connect ke Wi-Fi.
- [ ] Connect WebSocket ke `/ws`.
- [ ] Kirim `authenticate` maksimal 5 detik setelah connect.
- [ ] Tangani reconnect dengan exponential backoff.
- [ ] Balas native WebSocket ping dengan pong.
- [ ] Koneksi terbaru menggantikan koneksi lama.
- [ ] Deteksi wake word secara lokal.
- [ ] Mulai rekaman tanpa membuat mode display `listening`; layar tetap pada mode `idle`.
- [ ] Rekam WAV PCM 16-bit, 16 kHz, mono.
- [ ] Stop setelah diam 2,5 detik atau maksimal 60 detik.
- [ ] Generate UUID v4 untuk `X-Request-Id`.
- [ ] Upload raw WAV melalui HTTP POST.
- [ ] Tangani HTTP 202 dan seluruh error code.
- [ ] Tangani `display_status: thinking`.
- [ ] Tangani `audio_ready`, termasuk duplicate event setelah reconnect.
- [ ] Decoder lulus tes MP3 mono 24 kHz 96 kbps, atau laporkan format alternatif yang stabil.
- [ ] Buffer awal MP3 sebelum playback.
- [ ] Ubah layar ke `speaking` saat playback dimulai.
- [ ] Kirim `audio_playback_done` setelah selesai dan kirim ulang setelah reconnect bila perlu.
- [ ] Retry download MP3 maksimal 1 kali.
- [ ] Kirim `audio_playback_failed` jika gagal.
- [ ] Simpan audio error lokal.
- [ ] Kembali ke `idle` setelah selesai atau gagal.

---

## 12. Diagram State MVP

```text
DISPLAY: IDLE
    │
    ├─ wake word → rekam lokal (display tetap IDLE)
    │                 │
    │        diam 2,5s / maksimal 60s
    │                 ▼
    │             upload WAV
    │                 │
    │              HTTP 202
    ▼                 ▼
DISPLAY: THINKING  ← display_status
    │
    │ audio_ready + playback benar-benar mulai
    ▼
DISPLAY: SPEAKING
    │
    ├─ playback_done ─────────────► DISPLAY: IDLE
    └─ request/playback gagal ────► DISPLAY: ERROR → DISPLAY: IDLE
```

---

## 13. Di Luar Cakupan Dokumen Ini

- Implementasi wake word.
- Detail wiring mic, speaker, amplifier, dan layar.
- Sinkronisasi animasi mulut tingkat lanjut.
- Spotify/Bluetooth music.
- Mobile app.
- WhatsApp.
- Audio chunk WebSocket.
- Multi-device provisioning.
- OTA firmware update.

---

## 14. Ringkasan Endpoint dan Event

### Endpoint

```text
WS   /ws
POST /api/v1/voice
GET  /audio/:audioId.mp3
```

### ESP32 → Backend

```text
authenticate
audio_playback_done
audio_playback_failed
```

### Backend → ESP32

```text
authenticated
authentication_failed
connection_replaced
display_status
audio_ready
request_failed
```

---

## Changelog

| Versi | Perubahan |
|---|---|
| 1.0.0 | Kontrak awal MVP |
| 1.0.1 | Seluruh penjelasan diubah ke Bahasa Indonesia; istilah teknis protokol tetap English |
| 1.0.2 | Menambah race-handling HTTP/WS, tombstone idempotency, target MP3, cache policy, dan perilaku reconnect saat processing |
| 1.0.3 | Menambah deduplikasi `audio_ready`, replay completion setelah reconnect, status HTTP duplicate yang exact, retry matrix upload, `REQUEST_ID_CONFLICT`, dan kode `AUDIO_EXPIRED` |
| 1.0.4 | Memisahkan keputusan locked dan baseline, mengunci hanya empat mode display (`idle`, `thinking`, `speaking`, `error`), menambah sinkronisasi state setelah reconnect/restart, status publik duplicate, hash body untuk idempotency, HTTP 410 audio expired, canonical `WEBSOCKET_NOT_CONNECTED`, penegasan tidak ada idle timeout satu jam, dan menyamakan kalimat error noise dengan hasil diskusi |
| 1.0.5 | Audit ulang terhadap seluruh percakapan: menegaskan raw WAV body tanpa multipart, rekaman 2,5/60 detik dan format WAV sebagai keputusan locked, memindahkan batas 3 MB ke baseline, menambah close code WebSocket canonical, serta menegaskan tidak ada event `audio_ready_received` pada MVP |
