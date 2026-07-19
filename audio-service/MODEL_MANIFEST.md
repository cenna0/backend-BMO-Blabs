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
