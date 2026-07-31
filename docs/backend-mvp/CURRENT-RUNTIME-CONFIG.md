# BMO Voice MVP — Current Runtime Configuration

**Updated:** 2026-07-31
**Status:** VERIFIED P7 PRODUCTION BASELINE
**Scope:** STT/TTS runtime values only; the public hardware contract is unchanged.

These are the actual values verified in P7 production, not future deployment
targets. Historical evidence may contain older values because it preserves what
was tested at that earlier phase.

## Whisper STT

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

```text
Repository: Systran/faster-whisper-medium
Revision: 08e178d48790749d25932bbc082711ddcfdfbc4f
Language: None / auto-detect
Task: transcribe
```

Behavior:

- the multilingual `medium` model runs on CPU with INT8 compute;
- English, Indonesian, and mixed input remain supported through language
  auto-detection;
- hotword `BMO` uses the faster-whisper `hotwords` parameter and is not a
  transcript replacement;
- `medium + BMO` supersedes the historical P2 `small` default.

The P5 real regression matrix passed English, Indonesian, mixed, silence, and
noise. P7 then verified the pinned model in production, offline, including real
inference and the final 61-minute resource soak.

## Kokoro TTS

```env
KOKORO_LANG_CODE=a
KOKORO_VOICE=af_heart
KOKORO_SPEED=0.80
```

```text
Repository: hexgrad/Kokoro-82M
Revision: f3ff3571791e39611d31c381e3a41a3af07b4987
Sample rate: 24000 Hz
Runtime dependency: en_core_web_sm==3.8.0
```

`0.80` was selected by manual listening after comparing `0.90`, `0.85`,
`0.80`, and `0.75`, then verified as the P7 production value. The original
evidence statement that production default was still `1.0` describes the state
at that earlier test run and remains historical.

## Production model policy and RVC state

```env
MODEL_DOWNLOAD_ALLOWED=false
HF_HUB_OFFLINE=1
TRANSFORMERS_OFFLINE=1
RVC_ENABLED=false
```

Whisper and Kokoro run from exact curated, read-only production artifacts.
Runtime model downloads are disabled. The approved curated model fingerprint
is:

```text
d2761b191eed48e85128e774aa7057153d8e8994e2e4f40c07ffb05731ae7e9f
```

Real RVC inference remains unverified and belongs to P8. P8 may change
RVC-specific runtime configuration only after the engine, dependencies, model
paths, inference, fallback, quality, resource, and rollout gates pass. It must
not silently change the verified Whisper/Kokoro baseline or hardware contract.

P7 production/resource verification passed with `13/13` soak samples, zero new
OOM events, zero backend/audio restarts, minimum `MemAvailable` 3.209 GiB, and
minimum relevant free disk 59.137 GiB. The earlier requirement to benchmark
these values before deployment verification is therefore satisfied.
RVC-specific resource benchmarking remains mandatory in P8.

## Hardware impact

None. These runtime values do **not** change:

- `WS /ws`;
- `POST /api/v1/voice`;
- `GET /audio/:audioId.mp3`;
- WAV input contract;
- WebSocket event schemas;
- MP3 transport contract;
- retry/idempotency/error behavior.

Hardware Contract v1.0.5 remains unchanged.
