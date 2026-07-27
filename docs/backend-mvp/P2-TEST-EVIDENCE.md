# P2 — Audio Service bootstrap + faster-whisper STT Evidence

> **HISTORICAL PHASE RECORD — NOT A CURRENT EXECUTION INSTRUCTION.** This file records the P1–P5 state/ownership at the time it was written. References to “P6” or old runtime defaults inside this record are historical. For current execution order and ownership, use `../NEXT-ACTION.md`, `IMPLEMENTATION-STATUS.md`, and `../roadmap/P6-P10-ROADMAP.md`.

**Date:** 2026-07-19
**Status:** VERIFIED — LOCAL FUNCTIONAL
**Authorization:** P2 only, explicit user instruction
**Real faster-whisper inference:** PROVEN locally
**Deployment benchmark:** NOT RUN; remains P6 scope

## Scope verified

- FastAPI Audio Service app factory under `audio-service/`.
- Environment validation for internal service token, host/port, model cache paths, and faster-whisper defaults.
- Internal `X-Internal-Service-Token` authentication using constant-time comparison.
- `/health` with STT state only; Kokoro/RVC/FFmpeg remain false/not implemented for P2.
- `POST /stt/transcribe` with raw `audio/wav` body.
- WAV validation: RIFF/WAVE, PCM signed 16-bit little-endian, 16 kHz, mono.
- STT response schema for speech/no-speech, language, probability, and duration.
- Real `FasterWhisperTranscriber` adapter used by `/stt/transcribe`.
- Canonical P2 settings: `small` multilingual, CPU, `int8`, language auto-detect, task `transcribe`, VAD enabled, beam size 5.
- Model cache/bootstrap path under ignored `audio-service/models/`.

No Kokoro, RVC, FFmpeg TTS/MP3 pipeline, Hermes integration, VPS deployment, firmware, physical ESP32 work, Spotify, WhatsApp, mobile app, PostgreSQL, or Prisma was implemented.

## Model evidence

| Field | Value |
|---|---|
| Model | `small` multilingual |
| Repository | `Systran/faster-whisper-small` |
| Revision | `536b0662742c02347bc0e980a01041f333bce120` |
| Device | `cpu` |
| Compute type | `int8` |
| Language | auto-detect |
| Task | `transcribe` |
| VAD | enabled |
| Beam size | `5` |
| Cache path | `audio-service/models/hf-cache/hub/models--Systran--faster-whisper-small` |
| Snapshot path | `audio-service/models/hf-cache/hub/models--Systran--faster-whisper-small/snapshots/536b0662742c02347bc0e980a01041f333bce120` |
| Cached files | `10` |
| Cached bytes | `486213279` |
| Git status | model/cache/audio/result artifacts ignored; not committed |

`small.en` was not used.

## Real inference fixtures

All fixtures were WAV PCM signed 16-bit little-endian, 16 kHz, mono. Speech fixtures were generated for local verification only under ignored `audio-service/temp/real-inference-fixtures/`.

| Fixture | Duration | Transcript | Detected language | Language probability | Speech detected | Inference duration | Peak RSS | Result |
|---|---:|---|---|---:|---|---:|---:|---|
| `english.wav` | 4.032s | `Hello BMO, please help me remember the meeting tomorrow.` | `en` | 0.9942911863327026 | true | 6.305s | 608079872 | PASS |
| `indonesian.wav` | 5.184s | `Halo BMO, tolong bantu aku mengingat jadwal hari ini.` | `id` | 0.8635951280593872 | true | 5.802s | 610783232 | PASS |
| `mixed.wav` | 4.920s | `BMO, tolong remin aku about the meeting tomorrow.` | `id` | 0.8430900573730469 | true | 5.789s | 611401728 | PASS |
| `silence.wav` | 2.000s | `` | — | 0.0 | false | 2.648s | 608440320 | PASS |
| `noise.wav` | 2.000s | `` | — | 0.0 | false | 2.643s | 608358400 | PASS |

Mixed Indonesian-English was accepted as useful speech even though the detected dominant language was Indonesian. Silence and noise were not forwarded as valid speech.

## Cache/restart evidence

```text
Command: cd audio-service && <workspace-python> scripts/bootstrap_whisper.py --allow-download --models-dir .\models --manifest .\temp\MODEL_MANIFEST.bootstrap-first.json
Exit code: 0
Result: model loaded; cache created under audio-service/models/.
```

```text
Command: cd audio-service && HF_HUB_OFFLINE=1 <workspace-python> scripts/bootstrap_whisper.py --allow-download --models-dir .\models --manifest .\temp\MODEL_MANIFEST.bootstrap-second-offline.json
Exit code: 0
Result: model loaded from existing cache.
Before: 10 files / 486213279 bytes.
After: 10 files / 486213279 bytes.
```

```text
Command: cd audio-service && HF_HUB_OFFLINE=1 <workspace-python> scripts/verify_real_inference.py --models-dir .\models --fixtures-dir .\temp\real-inference-fixtures --results .\temp\p2-real-inference-final-offline.json --skip-generate
Exit code: 0
Result: all five real-inference fixtures passed through real FasterWhisperTranscriber and /stt/transcribe.
Before: 10 files / 486213279 bytes.
After: 10 files / 486213279 bytes.
```

Run kedua memakai cache yang sudah tersedia dan tidak mengunduh model ulang.

## Regression command evidence

Fresh regression commands rerun before the verification commit:

```text
Command: python scripts/verify-backend-mvp-docs.py
Exit code: 0
Result: PASS; verified package files, exact source hashes, semantic migration §1–§33, canonical decisions, internal path, verification taxonomy, and authorization gate.
```

```text
Command: cd backend && npm test
Exit code: 0
Result: 10 test files passed; 50 tests passed; 0 failed; 0 skipped.
```

```text
Command: cd backend && npm run typecheck
Exit code: 0
Result: TypeScript typecheck passed.
```

```text
Command: cd backend && npm run build
Exit code: 0
Result: TypeScript build passed.
```

```text
Command: cd backend && npm audit
Exit code: 0
Result: found 0 vulnerabilities.
```

```text
Command: cd backend && npm run fake-esp32
Exit code: 0
Result: fake ESP32 authenticated, uploaded WAV, saw thinking/audio_ready, downloaded audio/mpeg dummy MP3, and sent playback_done.
```

```text
Command: cd audio-service && <workspace-python> -m pytest
Exit code: 0
Result: 22 tests passed; 0 failed; 0 skipped.
```

```text
Command: cd audio-service && <workspace-python> -m compileall app tests scripts
Exit code: 0
Result: app, tests, and scripts compile.
```

```text
Command: cd audio-service && <workspace-python> -m pip check
Exit code: 0
Result: No broken requirements found.
```

## Mock vs real inference

Mock/test-double evidence remains useful for unit and integration coverage:

- Unit and integration tests use deterministic fake transcribers for English, Indonesian, mixed-language, and no-speech cases.
- Adapter tests use a stub `WhisperModel` to prove constructor/transcribe arguments without downloading model weights.

Real inference evidence now proves:

- real `faster-whisper==1.2.1` runtime;
- real `Systran/faster-whisper-small` multilingual model cache;
- real `/stt/transcribe` endpoint using `FasterWhisperTranscriber`;
- English, Indonesian, mixed Indonesian-English, silence, and noise behavior.

## Remaining non-local verification

- VPS latency/resource benchmark was not run and remains P6 scope.
- Physical ESP32, firmware, decoder, speaker playback, and progressive hardware playback remain `HW-INTEGRATION-01`, dependent on P6 staging endpoint availability.
- P3–P6 remain `NOT AUTHORIZED`.
