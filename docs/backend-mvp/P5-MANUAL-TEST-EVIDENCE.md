# P5 Manual Test Evidence

> **HISTORICAL PHASE RECORD — NOT A CURRENT EXECUTION INSTRUCTION.** This file records the P1–P5 state/ownership at the time it was written. References to “P6” or old runtime defaults inside this record are historical. For current execution order and ownership, use `../NEXT-ACTION.md`, `IMPLEMENTATION-STATUS.md`, and `../roadmap/P6-P10-ROADMAP.md`.

**Tanggal:** 2026-07-25  
**Commit yang diuji:** `3f26cc55c7c9d0a727ce4347743ba5a008b72a54` (`feat: implement P5 reliability security and lifecycle`)  
**Status akhir:** `MANUALLY VERIFIED — LOCAL`
**User Acceptance Test:** `USER ACCEPTANCE TEST — PASSED`

## 1. Preflight dan scope

- Commit diminta tersedia dan menjadi `HEAD`.
- Preflight awal clean: `main...origin/main [ahead 1]`, tanpa perubahan tracked.
- `docs.zip` untracked yang sudah ada sebelum validasi disimpan reversibel sebagai `stash@{0}`; tidak dihapus.
- Tidak ada VPS, firewall, port forwarding, internet exposure, P6, Spotify, WhatsApp, database, mobile app, atau firmware work.
- Setelah validasi semua proses lokal dihentikan; tidak ada listener tersisa pada `3000`, `3001`, `8001`, atau `8642`.

## 2. Command dan health

Command yang dipakai:

```powershell
npm run build                         # D:\codex\BMO\backend
powershell.exe -NoProfile -ExecutionPolicy Bypass -File D:\codex\BMO\manual-validation\start-backend-real.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File D:\codex\BMO\manual-validation\start-backend-hardware.ps1
.\.venv\Scripts\python.exe -m uvicorn app.main:create_app --factory --host 127.0.0.1 --port 8001
npm run hermes-fixture                # D:\codex\BMO\backend
```

### Real Audio Service

Initial:

```json
{"status":"loading","stt_loaded":false,"kokoro_loaded":false,"rvc_available":false,"ffmpeg_available":true}
```

Setelah real STT English dan real TTS Kokoro:

```json
{"status":"degraded","stt_loaded":true,"kokoro_loaded":true,"rvc_available":false,"ffmpeg_available":true}
```

Interpretasi: faster-whisper, Kokoro, dan FFmpeg real lokal tersedia. RVC unavailable; tidak ada klaim RVC real.

Auth Audio Service juga diuji manual: missing token `401`, wrong token `403`.

### Backend real pipeline

```json
{"status":"degraded","backend":"ok","hermes":"configured","audio_service":"configured","rvc":"delegated_to_audio_service"}
```

`configured` bukan bukti Hermes real. Pipeline memakai Hermes-compatible fixture lokal di `127.0.0.1:8642`; fixture menerima request dan mengembalikan fixed response.

### Backend hardware test

```json
{"status":"ok","backend":"ok","hermes":"bypassed","audio_service":"bypassed","rvc":"bypassed"}
```

Ini bukti backend hardware-test path, bukan bukti STT/Hermes/Kokoro/RVC.

## 3. MV-02 — full happy path real

Sample: `english.wav`, 129,102 bytes. Request ID: `36c0c010-cc41-4782-96a7-d37096619d69`.

Observed sequence:

1. WebSocket connect `ws://127.0.0.1:3000/ws`.
2. Authenticate sukses: `authenticated`, `status: ok`.
3. Upload valid WAV: HTTP `202`, body `{"request_id":"36c0c010-cc41-4782-96a7-d37096619d69","status":"processing"}`.
4. WebSocket `display_status`, `status: thinking`.
5. WebSocket `audio_ready`, `format: mp3`.
6. Download MP3: HTTP `200`, `Content-Type: audio/mpeg`, 62,541 bytes.
7. Salinan listenable disimpan di:

   `D:\codex\BMO\manual-validation\audio\happy-path-english-real-audio-service.mp3`

8. `audio_playback_done` terkirim.
9. Backend log: `speech_detected:true`, `language:"en"`, `rvc_applied:false`, `tts_engine:"kokoro"`, total `11,130 ms`.
10. Setelah playback, `backend-real-temp` kosong; MP3 temporary dan input WAV terhapus.

ffprobe salinan MP3:

```json
{
  "streams": [{
    "codec_name": "mp3",
    "sample_rate": "24000",
    "channels": 1,
    "duration": "5.125000",
    "bit_rate": "96000"
  }]
}
```

Follow-up upload `202` setelah cleanup dibuktikan oleh hardware matrix berikutnya; device tidak `busy` setelah playback done.

Tambahan direct TTS real tersimpan di:

`D:\codex\BMO\manual-validation\audio\audio-service-real-kokoro.mp3`

Ukuran 38,061 bytes; ffprobe `mp3`, 24 kHz, mono, 96 kbps, durasi `3.075000` s.

## 4. Real Audio Service sample matrix

Endpoint: `POST http://127.0.0.1:8001/stt/transcribe`, token internal valid, HTTP `200` untuk semua sample.

| Sample | speech | language | Text/result |
|---|---:|---|---|
| English | true | `en` | `Hello BMO, please help me remember the meeting tomorrow.` |
| Indonesian | true | `id` | `Halo BMO, tolong bantu aku mengingat jadwal hari ini.` |
| Mixed Indonesian-English | true | `id` | `BMO, tolong remin aku about the meeting tomorrow.` |
| Silence | false | `null` | empty text |
| Noise | false | `null` | empty text |

Ini bukti STT real saja. Tidak berarti backend pipeline untuk silence/noise akan menghasilkan audio; pipeline memetakan no-speech ke failure.

## 5. Hardware-test sample matrix

Runner manual:

```powershell
node D:\codex\BMO\manual-validation\manual-client.mjs sample-matrix
```

Untuk English, Indonesian, mixed, silence, dan noise: upload `202`, `display_status: thinking`, `audio_ready`, download `200 audio/mpeg` 4,077 bytes, lalu setelah `audio_playback_done` GET audio menjadi `404`. Salinan dummy MP3 ada di `D:\codex\BMO\manual-validation\audio\hardware-*-rerun.mp3`.

Interpretasi: validasi HTTP/WSS, state, cleanup, dan no-busy lifecycle. Audio hasil adalah dummy fixture; sample content tidak diproses STT dalam mode ini.

## 6. Required manual negative/reconnect/lifecycle tests

| Test | Evidence nyata | Hasil |
|---|---|---|
| Invalid credentials | WS `authentication_failed` / `INVALID_DEVICE_CREDENTIALS`, close `4003` / `INVALID_CREDENTIALS`; HTTP upload `401` / `INVALID_DEVICE_CREDENTIALS` | PASS |
| WebSocket tidak tersambung | HTTP `409` / `WEBSOCKET_NOT_CONNECTED` | PASS |
| Invalid WAV | HTTP `422` / `INVALID_AUDIO_FORMAT`, expected PCM 16 kHz mono | PASS |
| Duplicate request | ID `fcb3f7cc-0f20-4f97-8b6f-e73ef719d11d`: first `202`, second same body `200`, `duplicate:true`, status `audio_ready` | PASS |
| Request ID conflict | ID `b37f906f-5a84-43b3-8434-9ee630cd5ae9`: first `202`, different body second `409 REQUEST_ID_CONFLICT`; original `audio_ready` tetap diterima | PASS |
| Reconnect saat thinking | ID `f2143dec-e1c7-4ae0-8466-5c6217a1a1f2`: reconnect auth `backend_state:"thinking"`, active ID sama, lalu `audio_ready` dan download `200` / 62,541 bytes | PASS |
| Reconnect saat audio_ready | ID `84d5ef2c-e01b-4f43-8a05-28a860801f16`: reconnect auth `backend_state:"audio_ready"`, `audio_ready` resend | PASS |
| Playback failed | ID `82480ae2-f262-41c4-a5bf-9528ae906071`: `audio_playback_failed PLAYBACK_FAILED`, GET old audio `404`, follow-up upload `202` | PASS |
| Audio expired | ID `7c229275-e076-4dca-91dd-43764490a115`: event `request_failed AUDIO_EXPIRED`, GET old audio `410`, follow-up upload `202` | PASS |

Playback-failed follow-up ID `aa6de1b7-6cbb-468d-b50e-53f171fdc200`; expired follow-up ID `b8b539a7-e6af-4f50-a740-8f04bba09049`. Keduanya menerima `audio_ready` sebelum sesi ditutup.

## 7. Real vs mocked/unavailable boundary

**Real dan berhasil dibuktikan lokal:** backend HTTP/WebSocket, request store/lifecycle, local faster-whisper STT, local Kokoro TTS, local FFmpeg MP3, ffprobe.

**Mock/fixture/bypass:** Hermes-compatible fixture di port `8642`; hardware-test dummy MP3; dependency fields `bypassed` pada hardware health.

**Tidak tersedia / tidak diklaim:** Hermes real service; RVC real inference. Audio Service health `degraded` hanya karena `rvc_available:false`.

## 8. Git/output evidence

- Root `.gitignore` ditambah `manual-validation/`.
- Output audio dan temporary manual runner tetap di-ignore Git.
- `git status --short` tidak menampilkan `manual-validation/`.
- Perubahan tracked/untracked yang disengaja:
  - `.gitignore`
  - `docs/backend-mvp/P5-MANUAL-TEST-PLAN.md`
  - `docs/backend-mvp/P5-MANUAL-TEST-EVIDENCE.md`
  - historical internal P5 manual-validation plan (not included in this handoff package)
- `docs.zip` pre-existing disimpan di `stash@{0}` dan tidak diubah.

## Final decision

`MANUALLY VERIFIED — LOCAL`.

Semua required manual test MV-01 sampai MV-12 dijalankan dengan evidence fresh. Pernyataan ini adalah hasil milestone P5 awal yang memakai Hermes fixture. Verifikasi teknis Hermes real dicatat pada addendum di bawah; RVC tetap belum diverifikasi.

## User Acceptance Test status

Status aktif mengikuti marker **User Acceptance Test** di bagian atas dokumen.

Runner user-operated untuk UAT Hermes real:

```powershell
node manual-validation/manual-client.mjs user-pipeline "<path-audio>"
powershell.exe -ExecutionPolicy Bypass -File manual-validation\run-user-pipeline.ps1
```

Status ini hanya boleh menjadi `USER ACCEPTANCE TEST — PASSED` setelah user menjalankan ulang runner dengan Hermes real, mendengarkan MP3, menjawab empat pertanyaan audio, memilih `pass`, dan cleanup/device-not-busy verification berhasil. Runner menyimpan JSON/Markdown ke `manual-validation\reports\`, memerlukan signature native Hermes real, dan tetap tidak mengklaim RVC real.

## 9. Addendum — Hermes real + Kokoro real

Tanggal: 2026-07-25.

- Fixture `scripts/hermes-fixture.ts` dihentikan.
- Hermes Agent real v0.16.0 berjalan pada `127.0.0.1:8642`, loopback-only.
- Native `/health` mengembalikan `status:"ok"`, `platform:"hermes-agent"`.
- Native `/v1/capabilities` mengiklankan `responses_api:true`.
- Runtime provider/model dari `hermes status`: OpenAI Codex / `gpt-5.6-luna`.
- Proses Hermes lokal; inferensi model memakai provider OpenAI Codex melalui internet.
- Direct `/v1/responses`: ID `resp_5fdb141901504081b8705aa812ba`, bukan signature fixture; output `Two plus two is 4!`; durasi 22.843 detik.
- Full pipeline teknis final request `e70f20c3-48c2-4537-a92f-ddaa9f184c1e`: upload HTTP `202`, `display_status:thinking`, reconnect state `thinking`, lalu `audio_ready`.
- MP3 Kokoro real: `D:\codex\BMO\manual-validation\audio\reconnect-thinking-english.mp3`.
- ffprobe: codec MP3, 24 kHz, mono, 96 kbps stream, durasi 3.625958 detik.
- Setelah `audio_playback_done`: URL temporary backend HTTP `404`; WebSocket auth melaporkan `backend_state:"idle"` dan `active_request_id:null`.
- Audio Service: `stt_loaded:true`, `kokoro_loaded:true`, `rvc_available:false`.
- Probe user runner mendeteksi `mode=real` dan Hermes API v0.16.0.
- UAT sebelumnya yang berstatus pass memakai Hermes fixture; tidak dipakai sebagai bukti UAT Hermes real.
- UAT Hermes real tetap `USER ACCEPTANCE TEST — PENDING` sampai user mendengarkan output baru dan memberi verdict.
- UAT Hermes real request `66a54c8f-0bec-42f2-8937-7238aa0be13d` menghasilkan MP3 2.2 detik. Report mencatat `volumeSpeedReasonable:false` tetapi verdict `pass`; feedback user setelah pemutaran menyatakan TTS terlalu cepat. PASS tersebut dibatalkan dan UAT kembali pending.
- Setelah perbandingan speed `0.90`, `0.85`, `0.80`, dan `0.75`, user memilih `KOKORO_SPEED=0.80` untuk runtime UAT lokal. Default production `1.0` tidak diubah.

## 2026-07-26 documentation decision

The original UAT evidence correctly records that production default `1.0` had not yet been changed at the time of that run. The later project decision promotes `KOKORO_SPEED=0.80` to the **current deployment target**. VPS deployment and real RVC integration must explicitly set/revalidate `0.80`; this addendum does not rewrite the historical test result.

