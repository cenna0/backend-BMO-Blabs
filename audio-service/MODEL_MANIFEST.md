# Audio Service model manifest

**Last verified:** 2026-07-19
**Phase:** P2 — Audio Service bootstrap + faster-whisper STT
**Status:** local real-inference evidence recorded; model files not committed

## faster-whisper STT

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

The cache directory is ignored by `audio-service/.gitignore` through `models/`.

## Bootstrap evidence

```text
Command: scripts/bootstrap_whisper.py --allow-download --models-dir .\models --manifest .\temp\MODEL_MANIFEST.bootstrap-first.json
Exit code: 0
```

```text
Command: HF_HUB_OFFLINE=1 scripts/bootstrap_whisper.py --allow-download --models-dir .\models --manifest .\temp\MODEL_MANIFEST.bootstrap-second-offline.json
Exit code: 0
Before: 10 files / 486213279 bytes.
After: 10 files / 486213279 bytes.
```

`small.en` was not used.

## Kokoro TTS

| Field | Value |
|---|---|
| Package | `kokoro==0.9.4` |
| Model repository | `hexgrad/Kokoro-82M` |
| Revision | `f3ff3571791e39611d31c381e3a41a3af07b4987` |
| Language | American English, `a` |
| Voice | `af_heart` |
| Output WAV | 24 kHz mono PCM |
| Cache path | `audio-service/models/hf-cache/hub/models--hexgrad--Kokoro-82M` |
| Cached files | `7` |
| Cached bytes | `327738042` |

## RVC BMO model

| Field | Value |
|---|---|
| Repository | `Freaky98/CGO-adventure-time-BMO-rvc-v2-420e` |
| Revision | `82a8bc529bd41b930589188ead30f073d4f99fc0` |
| Archive | `CGO-adventure-time-BMO-rvc-v2-420e.zip` |
| Expected size | `63780149` |
| Actual size | `63780149` |
| Expected SHA-256 | `dadb3507d3f836836b16c5605ace8d383e57eddcc92dc2a5fc4406e1c49d27f0` |
| Actual SHA-256 | `dadb3507d3f836836b16c5605ace8d383e57eddcc92dc2a5fc4406e1c49d27f0` |
| `.pth` asset | `CGO_e420_s2520.pth`, 55226492 bytes, SHA-256 `1fb66eb767b994e2aa470fdb0cdf793424f57503e8a67e7ee47f10c64278b260` |
| `.index` asset | `added_IVF69_Flat_nprobe_1_CGO_v2.index`, 8553299 bytes, SHA-256 `3cd9589905a8bef196d66749361e96bebfe852509a8e74df2e3952332440dd3d` |
| Cache/archive path | `audio-service/models/rvc-bmo` |
| Runtime inference | Not verified locally; `RVC_INFER_COMMAND` / `rvc infer` unavailable |

Only `.pth` and `.index` assets were extracted. Scripts from the archive were not executed. The archive, extracted model assets, cache, and generated audio are ignored by `audio-service/.gitignore` through `models/` and `temp/`.
