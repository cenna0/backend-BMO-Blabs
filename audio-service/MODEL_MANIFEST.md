# Audio Service model manifest

**Last verified:** 2026-08-24
**Status:** faster-whisper is the only bootstrapped runtime model; Piper assets are recorded separately in `PIPER_ASSET_MANIFEST.json`.

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
| Cache path | `/opt/bmo/cache/audio/huggingface/hub/models--Systran--faster-whisper-medium` |
| Runtime snapshot | `/opt/bmo/models/runtime/whisper-medium/08e178d48790749d25932bbc082711ddcfdfbc4f` |

The runtime snapshot is validated against the exact pinned artifact allowlist
before faster-whisper loads. Runtime download is disabled in production and
candidate containers.

## Piper TTS

Piper uses the fixed `en_GB-semaine-medium` Prudence voice. Its immutable
asset identity and license evidence are recorded in
`PIPER_ASSET_MANIFEST.json`; no alternate TTS engine is part of the runtime.

## Bootstrap

The only model bootstrap command is:

```text
scripts/bootstrap_whisper.py --allow-download --models-dir /opt/bmo/models --manifest /opt/bmo/models/runtime/MODEL_MANIFEST.json
```
