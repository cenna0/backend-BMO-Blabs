# P5-MANUAL-VALIDATION

> **HISTORICAL PHASE RECORD — NOT A CURRENT EXECUTION INSTRUCTION.** This file records the P1–P5 state/ownership at the time it was written. References to “P6” or old runtime defaults inside this record are historical. For current execution order and ownership, use `../NEXT-ACTION.md`, `IMPLEMENTATION-STATUS.md`, and `../roadmap/P6-P10-ROADMAP.md`.

## Tujuan

Membuktikan satu full happy path P5 pada laptop lokal melalui HTTP dan WebSocket, lalu menjalankan negative, reconnect, playback, TTL, dan hardware-test checks secara manual. Automated test bukan pengganti evidence di dokumen ini.

## Scope lock

- Hanya lokal dan loopback: `127.0.0.1`.
- Tidak membuka firewall, port forwarding, atau akses internet.
- Tidak deploy VPS dan tidak mengerjakan P6, Spotify, WhatsApp, database, mobile app, atau firmware.
- Hermes real dan RVC real harus dilaporkan terpisah dari fixture/unavailable.

## Topologi lokal

| Komponen | Endpoint | Mode |
|---|---|---|
| Backend real pipeline | `http://127.0.0.1:3000` / `ws://127.0.0.1:3000/ws` | real backend; Audio Service real; Hermes fixture |
| Backend hardware test | `http://127.0.0.1:3001` / `ws://127.0.0.1:3001/ws` | real backend lifecycle; dummy MP3; dependency bypass |
| Audio Service | `http://127.0.0.1:8001` | local cached faster-whisper, Kokoro, FFmpeg; RVC unavailable |
| Hermes fixture | `http://127.0.0.1:8642/v1/responses` | mock/fixture lokal, bukan Hermes real |

Semua service memakai `127.0.0.1`. Jangan mengganti host menjadi `0.0.0.0` saat validasi manual.

## Command paling sederhana

Prasyarat: Node.js 22, `backend\node_modules`, `audio-service\.venv`, model cache lokal, `ffprobe` di `PATH`.

### Audio Service

Terminal 1:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File D:\codex\BMO\manual-validation\start-audio-real.ps1
```

Startup lokal UAT menetapkan `KOKORO_SPEED=0.80`. Default production tidak diubah.

### Hermes fixture lokal

Terminal 2:

```powershell
cd D:\codex\BMO\backend
$env:HERMES_FIXTURE_HOST='127.0.0.1'
$env:HERMES_FIXTURE_PORT='8642'
$env:HERMES_FIXTURE_API_KEY='local-hermes-key'
npm run hermes-fixture
```

### Backend real pipeline

Terminal 3:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File D:\codex\BMO\manual-validation\start-backend-real.ps1
```

Script tersebut hanya memakai credential test lokal, `HARDWARE_TEST_MODE=false`, dan bind `127.0.0.1`.

### Backend hardware test mode

Stop backend real, lalu jalankan:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File D:\codex\BMO\manual-validation\start-backend-hardware.ps1
```

Endpoint laptop lokal hardware mode:

```text
GET  http://127.0.0.1:3001/health
WS   ws://127.0.0.1:3001/ws
POST http://127.0.0.1:3001/api/v1/voice
GET  http://127.0.0.1:3001/audio/<audioId>.mp3
```

Hardware mode memakai `backend\tests\fixtures\test-response.mp3`; STT, Hermes, Kokoro, dan RVC tidak dipanggil.

## Manual test matrix

| ID | Test | Mode | Pass criteria |
|---|---|---|---|
| MV-01 | Backend/Audio health | real + hardware | status dan dependency state tercatat; bind loopback |
| MV-02 | Full happy path English | real backend + real Audio Service + Hermes fixture | WS auth, HTTP `202`, `thinking`, `audio_ready`, MP3 `200`, ffprobe, saved copy, playback done, cleanup |
| MV-03 | Sample matrix | Audio Service real; backend hardware lifecycle | English, Indonesian, mixed, silence, noise diproses; hasil STT dipisah dari dummy lifecycle |
| MV-04 | Invalid credentials | hardware | WS `authentication_failed` + close `4003`; HTTP `401` |
| MV-05 | WebSocket tidak tersambung | hardware | upload `409 WEBSOCKET_NOT_CONNECTED` |
| MV-06 | Invalid WAV | hardware | upload `422 INVALID_AUDIO_FORMAT` |
| MV-07 | Duplicate request | hardware | body sama/request ID sama `200 duplicate:true`; tidak regenerate |
| MV-08 | Request ID conflict | hardware | body berbeda/request ID sama `409 REQUEST_ID_CONFLICT` |
| MV-09 | Reconnect saat thinking | real backend | reconnect auth reports `backend_state: thinking`, lalu `audio_ready` |
| MV-10 | Reconnect saat audio_ready | hardware | reconnect auth reports `audio_ready`, `audio_ready` dikirim ulang |
| MV-11 | Playback failed | hardware | MP3 dihapus, GET `404`, follow-up upload `202` |
| MV-12 | Audio expired | hardware, TTL 2 s | `request_failed AUDIO_EXPIRED`, GET `410`, follow-up upload `202` |

## Sample input

```text
D:\codex\BMO\audio-service\temp\real-inference-fixtures\english.wav
D:\codex\BMO\audio-service\temp\real-inference-fixtures\indonesian.wav
D:\codex\BMO\audio-service\temp\real-inference-fixtures\mixed.wav
D:\codex\BMO\audio-service\temp\real-inference-fixtures\silence.wav
D:\codex\BMO\audio-service\temp\real-inference-fixtures\noise.wav
```

Runner manual API/WebSocket:

```powershell
node D:\codex\BMO\manual-validation\manual-client.mjs negative-only
node D:\codex\BMO\manual-validation\manual-client.mjs sample-matrix
node D:\codex\BMO\manual-validation\manual-client.mjs duplicate-only
node D:\codex\BMO\manual-validation\manual-client.mjs conflict-only
node D:\codex\BMO\manual-validation\manual-client.mjs reconnect-audio-only
node D:\codex\BMO\manual-validation\manual-client.mjs playback-failed-only
node D:\codex\BMO\manual-validation\manual-client.mjs expired-only
node D:\codex\BMO\manual-validation\manual-client.mjs real-reconnect-thinking
```

Runner ini bukan test runner; ia mengirim request nyata ke service yang sedang hidup dan mencetak event/status yang diamati.

## User-operated UAT runner

Untuk menjalankan satu UAT tanpa memahami detail HTTP/WebSocket:

```powershell
node manual-validation/manual-client.mjs user-pipeline "<path-audio>"
```

Input WAV canonical dipakai langsung. WAV non-canonical, MP3, M4A, dan audio umum dikonversi otomatis dengan FFmpeg menjadi PCM signed 16-bit little-endian, 16 kHz, mono.

Wrapper file picker Windows:

```powershell
powershell.exe -ExecutionPolicy Bypass -File manual-validation\run-user-pipeline.ps1
```

Runner akan memeriksa Backend, Audio Service, dan Hermes endpoint; menjalankan STT langsung; menampilkan transcript/language/duration; meminta konfirmasi transcript; lalu mengelola WS auth, UUID, upload, event, download MP3, ffprobe, default Windows player, empat pertanyaan kualitas audio, playback done/failed, cleanup, dan device-not-busy probe.

Output:

```text
manual-validation/audio/user-pipeline-<timestamp>.mp3
manual-validation/reports/user-pipeline-<timestamp>.json
manual-validation/reports/user-pipeline-<timestamp>.md
```

Status tracked tetap `USER ACCEPTANCE TEST — PENDING` sampai user memilih `pass` setelah mendengarkan output baru. Runner sekarang menolak fixture dan hanya melanjutkan jika signature native Hermes real terverifikasi. RVC belum termasuk verifikasi real.

## Hermes real untuk UAT saat ini

- Endpoint: `http://127.0.0.1:8642/v1/responses`.
- Bind: `127.0.0.1` saja; tanpa firewall rule, forwarding, atau exposure internet.
- Hermes Agent: v0.16.0, native Responses API.
- Provider/model runtime: OpenAI Codex / `gpt-5.6-luna`.
- Hermes gateway berjalan lokal; inference model tetap memakai provider melalui internet.
- Pipeline yang diuji: faster-whisper real → Hermes real → Kokoro real → MP3.
- `rvc_available:false`; RVC tidak termasuk klaim UAT.
- Tabel fixture sebelumnya mendokumentasikan baseline P5 awal, bukan konfigurasi UAT Hermes real saat ini.

## Evidence rule

Untuk setiap test catat request ID, status HTTP, event WebSocket, URL audio, status download, ukuran byte, ffprobe, dan kondisi file setelah playback/expiry. Hanya klaim service real jika request langsung ke service real menghasilkan bukti.

## 2026-07-26 documentation decision

The original UAT evidence correctly records that production default `1.0` had not yet been changed at the time of that run. The later project decision promotes `KOKORO_SPEED=0.80` to the **current deployment target**. VPS deployment and real RVC integration must explicitly set/revalidate `0.80`; this addendum does not rewrite the historical test result.

