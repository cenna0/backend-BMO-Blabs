# Audio Service model manifest

**Last verified:** 2026-07-25
**Phase:** P5 manual STT accuracy validation
**Status:** local real-inference and multilingual regression evidence recorded; model files not committed

## faster-whisper STT

| Field | Value |
|---|---|
| Model | `medium` multilingual |
| Repository | `Systran/faster-whisper-medium` |
| Revision | `08e178d48790749d25932bbc082711ddcfdfbc4f` |
| Device | `cpu` |
| Compute type | `int8` |
| Language | auto-detect |
| Task | `transcribe` |
| VAD | enabled |
| Beam size | `5` |
| Hotwords | `BMO` |
| Condition on previous text | library default, `true` |
| Cache path | `audio-service/models/hf-cache/hub/models--Systran--faster-whisper-medium` |
| Snapshot path | `audio-service/models/hf-cache/hub/models--Systran--faster-whisper-medium/snapshots/08e178d48790749d25932bbc082711ddcfdfbc4f` |
| Cached files | `10` |
| Cached bytes | `1530572644` |

The cache directory is ignored by `audio-service/.gitignore` through `models/`.

## Bootstrap evidence

```text
Command: $env:WHISPER_MODEL='medium'; .\.venv\Scripts\python.exe scripts\bootstrap_whisper.py --allow-download --models-dir .\models --manifest .\temp\MODEL_MANIFEST.medium-investigation.json
Exit code: 0
```

`medium.en` was not used. The selected model remains multilingual and leaves `language=None` for automatic English, Indonesian, and mixed-language detection.

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
