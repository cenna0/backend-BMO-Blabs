# BMO Voice MVP — Current Runtime Configuration

**Updated:** 2026-07-26  
**Status:** CURRENT DEPLOYMENT TARGET  
**Scope:** STT/TTS runtime values only; public hardware contract is unchanged.

This file is the quickest source for runtime values that were superseded after the original P2/P3 implementation. Historical evidence may still contain the old values because those files preserve what was actually tested at that phase.

## STT

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

Behavior:

- multilingual model;
- `language=None` / auto-detect;
- English, Indonesian, dan mixed input tetap supported;
- hotword `BMO` memakai parameter `hotwords` faster-whisper dan bukan transcript replacement;
- `medium + BMO` supersedes the historical P2 `small` default.

Evidence: `P5-STT-ACCURACY-INVESTIGATION.md`. The real regression matrix passed English, Indonesian, mixed, silence, and noise. The accuracy improvement increased cold/warm latency and memory, so VPS resource benchmark is still mandatory.

## Kokoro

```env
KOKORO_LANG_CODE=a
KOKORO_VOICE=af_heart
KOKORO_SPEED=0.80
```

`0.80` was selected by manual listening after comparing `0.90`, `0.85`, `0.80`, and `0.75`. It is now the target deployment value. The original evidence statement that production default was still `1.0` describes the state at that earlier test run; it has been superseded by the later project decision.

Real RVC remains a separate verification gate. Revalidate perceived tempo after RVC is integrated.

## Hardware impact

None. These runtime changes do **not** change:

- `WS /ws`;
- `POST /api/v1/voice`;
- `GET /audio/:audioId.mp3`;
- WAV input contract;
- WebSocket event schemas;
- MP3 transport contract;
- retry/idempotency/error behavior.

The Hardware Contract v1.0.5 therefore remains unchanged.
