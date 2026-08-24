# BMO Voice Runtime Configuration

**Updated:** 2026-08-24
**Status:** SOURCE MIGRATED; CANDIDATE BUILT; PROMOTION BLOCKED_RESOURCE

This is the current runtime target. The immutable production Audio image remains
available for rollback while the parallel candidate waits for the memory gate.

## Canonical pipeline

```text
ESP WAV
→ faster-whisper STT
→ Hermes
→ Piper TTS
→ FFmpeg
→ mono 24 kHz MP3
→ ESP playback
```

Piper is the only TTS engine. A synthesis error is exposed as `TTS_FAILED`;
there is no second TTS path and no request-level voice selector.

## faster-whisper

```env
WHISPER_MODEL=medium
WHISPER_HOTWORDS=BMO
WHISPER_DEVICE=cpu
WHISPER_COMPUTE_TYPE=int8
WHISPER_CPU_THREADS=4
WHISPER_WORKERS=1
WHISPER_BEAM_SIZE=5
WHISPER_VAD=true
```

Pinned repository: `Systran/faster-whisper-medium`
Pinned revision: `08e178d48790749d25932bbc082711ddcfdfbc4f`
Language: auto-detect; task: transcribe.

## Piper

```env
TTS_PRIMARY_ENGINE=piper
PIPER_MODEL=en_GB-semaine-medium
PIPER_SPEAKER=prudence
PIPER_SPEAKER_ID=0
PIPER_ENGINE_REVISION=f04d52c5528ac7cf2d73757f57990ff490f75005
PIPER_VOICE_REVISION=9f967d15e9ccdf43078586d1476ee70f314401bd
PIPER_MANIFEST_PATH=/opt/bmo/models/piper/PIPER_ASSET_MANIFEST.json
```

Piper assets and the faster-whisper runtime snapshot are mounted read-only.
Model downloads are disabled. `X-TTS-Engine: piper` is retained as
observability metadata only and is not a new consumer contract.

## Audio Service health contract

- `/livez` and `/health` prove only that the process responds with `status: ok`.
- `/readyz` returns HTTP 200 only when `stt_loaded`, `piper_loaded`, and
  `ffmpeg_available` are all true and `status` is `ok`.
- The backend and ESP-facing MP3 lifecycle remain unchanged.

## Rollout state

The candidate image was built from the Piper-only source. Candidate execution is
allowed only after host `MemAvailable` is at least 4 GiB. After readiness, the
measurement must remain at least 1.5 GiB with no OOM/resource pressure. The
previous production image digest remains retained for deterministic rollback.
