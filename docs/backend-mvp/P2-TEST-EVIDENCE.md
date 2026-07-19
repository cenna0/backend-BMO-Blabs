# P2 — Audio Service bootstrap + faster-whisper STT Evidence

**Date:** 2026-07-19  
**Status:** IMPLEMENTED — not VERIFIED  
**Authorization:** P2 only, explicit user instruction  
**Real faster-whisper inference:** NOT PROVEN

## Scope delivered

- FastAPI Audio Service app factory under `audio-service/`.
- Environment validation for internal service token, host/port, model cache paths, and faster-whisper defaults.
- Internal `X-Internal-Service-Token` authentication using constant-time comparison.
- `/health` with STT state only; Kokoro/RVC/FFmpeg remain false/not implemented for P2.
- `POST /stt/transcribe` with raw `audio/wav` body.
- WAV validation: RIFF/WAVE, PCM, 16-bit, 16 kHz, mono.
- STT response schema for speech/no-speech, language, probability, and duration.
- Transcriber protocol isolating deterministic tests from real faster-whisper runtime.
- Real `FasterWhisperTranscriber` adapter with canonical P2 settings: `small`, CPU, `int8`, 4 threads, 1 worker, beam size 5, `language=None`, `task=transcribe`, VAD enabled.
- Bootstrap/cache dry-run script for model cache paths and manifest metadata.

No Kokoro, RVC, FFmpeg TTS/MP3 pipeline, Hermes integration, VPS deployment, firmware, physical ESP32 work, Spotify, WhatsApp, mobile app, PostgreSQL, or Prisma was implemented.

## Mock vs real inference

Mock/test-double evidence:

- Unit and integration tests use deterministic fake transcribers for English, Indonesian, mixed-language, and no-speech cases.
- Adapter tests use a stub `WhisperModel` to prove constructor/transcribe arguments without downloading model weights.

Real inference evidence:

- `faster-whisper==1.2.1` dependency installed in the local test runtime.
- Real model download and real audio inference were not run.
- P2 must remain `IMPLEMENTED`, not `VERIFIED`, until real faster-whisper inference against English, Indonesian, mixed-language, silence/noise samples is proven.

## Command evidence

```text
Command: cd audio-service && <workspace-python> -m pytest
Exit code: 0
Result: 22 tests passed; 0 failed; 0 skipped.
Fresh rerun: 2026-07-19
```

```text
Command: cd audio-service && <workspace-python> -m compileall app scripts
Exit code: 0
Result: app and scripts compile.
Fresh rerun: 2026-07-19
```

```text
Command: cd audio-service && <workspace-python> -m pip check
Exit code: 0
Result: No broken requirements found.
Fresh rerun: 2026-07-19
```

```text
Command: cd audio-service && <workspace-python> scripts/bootstrap_whisper.py --dry-run --models-dir .\models --manifest .\temp\bootstrap-manifest.json
Exit code: 0
Result: {"status": "dry_run", "manifest": "temp\\bootstrap-manifest.json"}
Manifest: model=small, device=cpu, compute_type=int8, cpu_threads=4, workers=1, beam_size=5, vad=true.
Fresh rerun: 2026-07-19
```

## Required final verification still open

- Real faster-whisper `small` multilingual inference.
- English WAV sample.
- Indonesian WAV sample.
- Mixed Indonesian-English WAV sample.
- Silence/noise no-speech sample using real model/VAD.
- Model manifest with actual source/revision/size/SHA256 after real model cache bootstrap.
