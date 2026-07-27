# P3 — Kokoro + FFmpeg + RVC fallback Evidence

> **HISTORICAL PHASE RECORD — NOT A CURRENT EXECUTION INSTRUCTION.** This file records the P1–P5 state/ownership at the time it was written. References to “P6” or old runtime defaults inside this record are historical. For current execution order and ownership, use `../NEXT-ACTION.md`, `IMPLEMENTATION-STATUS.md`, and `../roadmap/P6-P10-ROADMAP.md`.

**Date:** 2026-07-19
**Status:** IMPLEMENTED — not VERIFIED
**Authorization:** P3 only, explicit user instruction
**Real Kokoro:** PROVEN locally
**Real FFmpeg:** PROVEN locally
**RVC model archive:** PROVEN downloaded, size-checked, SHA-256 checked, inspected, and safely extracted
**Real RVC inference:** not verified; local RVC inference command/runtime unavailable
**Deployment benchmark:** NOT RUN; remains P6 scope

## Scope delivered

- Kokoro American English TTS adapter with `KPipeline(lang_code="a")`.
- Kokoro voice `af_heart`.
- Kokoro waveform segment merge into one complete 24 kHz mono WAV.
- TTS text validation: trim whitespace, non-empty, maximum 600 characters, maximum three sentences, plain text.
- FFmpeg conversion to MP3 mono 24 kHz 96 kbps.
- Configurable MP3 output settings.
- RVC model bootstrap with exact Hugging Face revision, size and SHA-256 verification before extract, archive inspection, safe extraction of only `.pth` and `.index`.
- RVC command adapter using the documented `rvc infer` CLI shape when a runtime command is configured.
- Kokoro-only fallback when RVC is unavailable or fails.
- Internal authenticated `POST /tts/synthesize`.
- Result headers: `Content-Type: audio/mpeg`, `X-RVC-Applied`, `X-TTS-Engine`.
- P3 health state: `ok`, `degraded`, `error`.
- Cleanup of intermediate WAV/RVC/MP3 work files through `finally`.
- Unit and integration tests for P3.

No Express backend integration, Hermes integration, public backend interface change, deployment VPS, firmware, physical ESP32 work, database, Spotify, WhatsApp, mobile app, or P4–P6 work was implemented.

## Dependency versions

| Dependency | Version |
|---|---|
| `kokoro` | `0.9.4` |
| `soundfile` | `0.13.1` |
| `torch` | `2.13.0` |
| `huggingface_hub` | `1.24.0` |
| `en_core_web_sm` | `3.8.0` |
| `faster-whisper` | `1.2.1` |
| `fastapi` | `0.139.2` |

## Kokoro evidence

| Field | Value |
|---|---|
| Source repo | `hexgrad/Kokoro-82M` |
| Revision | `f3ff3571791e39611d31c381e3a41a3af07b4987` |
| Language | American English, `a` |
| Voice | `af_heart` |
| Output WAV | 24 kHz mono PCM |
| Cache path | `audio-service/models/hf-cache/hub/models--hexgrad--Kokoro-82M` |
| Cached files | `7` |
| Cached bytes | `327738042` |

## RVC model evidence

| Field | Value |
|---|---|
| Repository | `Freaky98/CGO-adventure-time-BMO-rvc-v2-420e` |
| Revision | `82a8bc529bd41b930589188ead30f073d4f99fc0` |
| Archive | `CGO-adventure-time-BMO-rvc-v2-420e.zip` |
| Expected size | `63780149` |
| Actual size | `63780149` |
| Expected SHA-256 | `dadb3507d3f836836b16c5605ace8d383e57eddcc92dc2a5fc4406e1c49d27f0` |
| Actual SHA-256 | `dadb3507d3f836836b16c5605ace8d383e57eddcc92dc2a5fc4406e1c49d27f0` |
| Extracted `.pth` | `CGO_e420_s2520.pth`, 55226492 bytes, SHA-256 `1fb66eb767b994e2aa470fdb0cdf793424f57503e8a67e7ee47f10c64278b260` |
| Extracted `.index` | `added_IVF69_Flat_nprobe_1_CGO_v2.index`, 8553299 bytes, SHA-256 `3cd9589905a8bef196d66749361e96bebfe852509a8e74df2e3952332440dd3d` |
| Git status | archive/model/cache ignored through `audio-service/models/`; not committed |

Archive scripts or non-model files were not extracted or executed.

## Real local voice output evidence

Command:

```text
cd audio-service
HF_HUB_OFFLINE=1 <workspace-python> scripts/verify_voice_pipeline.py --models-dir .\models --temp-dir .\temp\p3-real-voice-second --results .\temp\p3-real-voice-results-second-offline.json
Exit code: 0
```

| Text | Output mode | Duration | Kokoro time | RVC time | FFmpeg time | Size | Codec | Sample rate | Channels | Bitrate | `rvc_applied` | Result |
|---|---|---:|---:|---:|---:|---:|---|---:|---:|---:|---|---|
| `Hi! BMO is ready to help.` | Kokoro-only | 2.350s | 19.728s | — | 0.083s | 29133 | mp3 | 24000 | 1 | 96000 | false | PASS |
| `Do not worry. BMO is right here with you.` | Kokoro-only | 3.100s | 2.341s | — | 0.104s | 38349 | mp3 | 24000 | 1 | 96000 | false | PASS |
| `Yay! BMO found the answer.` | Kokoro-only | 2.425958s | 1.844s | — | 0.083s | 30285 | mp3 | 24000 | 1 | 96000 | false | PASS |
| `Hi! BMO is ready to help.` | forced RVC failure fallback | 2.350s | 1.499s | — | 0.082s | 29133 | mp3 | 24000 | 1 | 96000 | false | PASS |

`ffprobe` was run against every generated MP3 and confirmed `codec_name=mp3`, `sample_rate=24000`, `channels=1`, and `bit_rate=96000`.

## Cache/restart evidence

Second run used local cache with `HF_HUB_OFFLINE=1`.

```text
Kokoro/HF cache before: 21 files / 813957214 bytes
Kokoro/HF cache after:  21 files / 813957214 bytes
RVC cache before:       6 files / 127560264 bytes
RVC cache after:        6 files / 127560264 bytes
```

No model file, archive, generated WAV, generated MP3, JSON result, temp file, `node_modules`, or `dist` artifact is intended for Git.

## Health evidence

| Scenario | Expected status | Evidence |
|---|---|---|
| STT + Kokoro + FFmpeg + RVC ready | `ok` | unit/integration health test |
| STT + Kokoro + FFmpeg ready, RVC unavailable | `degraded` | unit/integration health test and real run `actual_after_run=degraded` |
| Kokoro or FFmpeg unavailable | `error` | unit/integration health test |

## Mock vs real evidence

Real evidence:

- real Kokoro package and model cache;
- real `af_heart` voice generation;
- real FFmpeg conversion;
- real ffprobe metadata checks;
- real RVC archive download and cryptographic verification.

Mock/test-double evidence:

- unit tests use fake Kokoro, fake FFmpeg, and fake RVC to prove orchestration, headers, cleanup, success RVC path, and forced-failure fallback deterministically;
- RVC real inference is not mocked as success and is not claimed.

## Command evidence

```text
Command: python scripts/verify-backend-mvp-docs.py
Exit code: 0
Result: PASS; verified package files, exact source hashes, semantic migration §1–§33, canonical decisions, internal path, verification taxonomy, and authorization gate.
```

```text
Command: cd audio-service && <workspace-python> scripts/bootstrap_rvc.py --allow-download --models-dir .\models --manifest .\temp\MODEL_MANIFEST.rvc-bootstrap.json
Exit code: 0
Result: RVC archive downloaded, size/SHA-256 verified, contents inspected, `.pth` and `.index` extracted.
```

```text
Command: cd audio-service && <workspace-python> scripts/verify_voice_pipeline.py --models-dir .\models --temp-dir .\temp\p3-real-voice --results .\temp\p3-real-voice-results.json
Exit code: 0
Result: real Kokoro-only MP3 and forced RVC fallback passed; real RVC unavailable.
```

```text
Command: cd audio-service && HF_HUB_OFFLINE=1 <workspace-python> scripts/verify_voice_pipeline.py --models-dir .\models --temp-dir .\temp\p3-real-voice-second --results .\temp\p3-real-voice-results-second-offline.json
Exit code: 0
Result: second run used local cache; Kokoro-only MP3 and forced fallback passed; real RVC unavailable.
```

```text
Command: ffprobe for all MP3 outputs in audio-service/temp/p3-real-voice-second/outputs
Exit code: 0
Result: all outputs are MP3, 24 kHz, mono, 96 kbps.
```

```text
Command: cd audio-service && <workspace-python> -m pytest
Exit code: 0
Result: 47 tests passed; 0 failed; 0 skipped.
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

## Blocker for verification

P3 remains `IMPLEMENTED — not VERIFIED` because real RVC inference did not run. The exact BMO RVC model archive was downloaded, hash-verified, inspected, and extracted, but local environment has no configured/installed RVC inference runtime command (`rvc infer`). The implemented adapter will run documented RVC CLI inference when `RVC_INFER_COMMAND` is configured, using the inspected `.pth` and optional `.index`.

P3 can only become `VERIFIED — LOCAL FUNCTIONAL` after real Kokoro + real RVC + real FFmpeg succeeds end-to-end and all regressions remain pass.
