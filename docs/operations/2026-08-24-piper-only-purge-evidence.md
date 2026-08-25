# BMO Piper-Only Production Cutover and Kokoro Purge Evidence

**Result:** `BMO_PIPER_ONLY_PURGE_RESULT=PASS`
**Date:** 2026-08-25
**Repository:** `/opt/bmo/app`
**Branch:** `main`
**Source HEAD at preflight:** `4fcd1cb6a2b9b049e5c335ea5050532dacf63ab1`
**Evidence directory:** `/opt/bmo/temp/piper-only-cutover-evidence/20260825T095934Z`

## Final production state

- Production Audio image: `bmo-audio@sha256:24e1c4244ea8868f731d819ea75cb57c1e464b6df3bd9679d65fd4711643488c`.
- Audio endpoint: `127.0.0.1:8001`, container healthy, restart count `0`, OOM `false` at final check.
- Final Audio readiness: `{"status":"ok","stt_loaded":true,"piper_loaded":true,"ffmpeg_available":true}`.
- Final Backend readiness: `backend=ok`, `hermes=ok`, `audio_service=ok`, `database=ok`.
- Hermes health: `status=ok`, version `0.20.0`.
- Production PostgreSQL: healthy.
- Old production Audio image retained for rollback: `sha256:62ad9adead83d863ab2bf28a2ac75e5a116dc68bab8ff06eec81b7a0407ddb34`.
- Production Audio config was rewritten through an allowlist. Final config SHA-256: `255ef251786e13af4f93d2b3d9eccbe651cb46b9c9bd595b49ee9649678404ce`.
- Final config contains no `KOKORO_*`, `RVC_*`, fallback-engine, or RVC contract key.

## Verification evidence

Passed:

1. Piper-only Audio candidate image dependency probe: faster-whisper, Piper, ONNX Runtime, FFmpeg, and ffprobe present; Kokoro, spaCy, PyTorch, Transformers, and RVC binary absent.
2. Isolated candidate Audio readiness on port `8002`.
3. Isolated candidate real STT → Piper → FFmpeg verification. Piper returned `X-TTS-Engine: piper`; MP3 was mono, 24 kHz, 96 kbps target.
4. Production Audio real verifier after promotion:
   - STT HTTP 200, speech detected.
   - Piper TTS HTTP 200.
   - MP3: mono, 24 kHz, 96 kbps, 19,341 bytes.
   - Total request time: 51.194 seconds.
5. Native public production regression after promotion passed `12/12`: public health, hidden liveness/readiness, invalid and valid WebSocket authentication, upload, conflict handling, `display_status`, `audio_ready`, MP3 retrieval, playback completion, and completed-audio unavailability.
6. Final post-purge local health/readiness checks passed for Audio, Backend, Hermes, and PostgreSQL.

The repository-local `npm run fake-esp32` command could not run because the dirty source tree has an unrelated `GoogleAuthClient` import/export mismatch. The deployed public contract was verified with the native public regression instead. A later long-fixture rerun exceeded the verifier's 60-second event wait, and retries encountered the already-active request conflict; the production services remained healthy and the earlier complete 12/12 public regression had already passed against the promoted image.

## Candidate backend note

The pinned candidate Backend image exited before full isolated flow because its legacy `docker-entrypoint.sh` did not load `DATABASE_URL` from the P9 secret file. The production P9 Backend image was not replaced. The candidate overlay was corrected to use the P9 entrypoint, but a second isolated attempt was stopped by the 4 GiB pre-start memory gate before the corrected Backend was started. Production Backend plus promoted Piper Audio passed the public 12/12 flow, so no Backend promotion was needed.

## Legacy artifact purge

Deleted only reviewed Kokoro paths:

```text
/opt/bmo/models/runtime/kokoro-82m-af-heart
/opt/bmo/models/kokoro
/opt/bmo/models/hf-cache/hub/models--hexgrad--Kokoro-82M
/opt/bmo/models/hf-cache/hub/.locks/models--hexgrad--Kokoro-82M
```

Recorded pre-purge sizes:

```text
Kokoro runtime model: 327,738,002 bytes
Kokoro HuggingFace cache: 327,757,628 bytes
```

Post-purge scan found no Kokoro, RMVPE, or Hubert paths under active model/cache/temp roots. Piper assets remain at `/opt/bmo/models/piper`. `/opt/bmo/archive/p8-rvc` was intentionally retained as historical evidence. The old Docker rollback image was not deleted or pruned.

## Resource and storage evidence

```text
Pre-maintenance MemAvailable: 3,436,908,544 bytes
After authorized production-Audio stop: 5,664,288,768 bytes
Candidate post-ready floor observed: above 1.5 GiB
After promotion MemAvailable: 2,201,165,824 bytes
Final post-purge MemAvailable: 3,862,921,216 bytes
Swap: 0 bytes throughout

Models before: 3,793,408,273 bytes
Models after:  3,137,912,643 bytes
Reclaimed:       655,495,630 bytes
```

The production Audio was stopped only during the authorized maintenance window, then restored/promoted. Backend, PostgreSQL, Hermes, monitoring, and public service health were checked after the cutover.

## Intentional source changes

- `ops/deploy/piper-only-candidate-compose.yml`: candidate Backend now uses the P9 secret-loading entrypoint as required by the image contents; this was needed to make the isolated candidate topology internally consistent. The Backend image itself was not promoted.
- `audio-service/requirements-runtime.lock`: removed a stale legacy dependency comment; dependency graph remains unchanged.
- `docs/superpowers/plans/2026-08-25-piper-only-production-cutover.md`: complete execution plan.
- This evidence report.

Unrelated dirty P9/Spotify/WhatsApp files were not staged, reset, or edited.
