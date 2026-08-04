# BMO Voice MVP — Current Runtime Configuration

**Updated:** 2026-08-03
**Status:** VERIFIED P8 PRODUCTION — PIPER PRIMARY; KOKORO FALLBACK
**Scope:** STT/TTS runtime values only; the public hardware contract is unchanged.

These are the actual values currently deployed in production. Piper Prudence
is the fixed primary; Kokoro remains the automatic fallback.

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

## Primary Piper TTS

```env
TTS_PRIMARY_ENGINE=piper
PIPER_MODEL=en_GB-semaine-medium
PIPER_SPEAKER=prudence
PIPER_SPEAKER_ID=0
PIPER_ENGINE_VERSION=1.6.0
PIPER_ENGINE_REVISION=f04d52c5528ac7cf2d73757f57990ff490f75005
PIPER_VOICE_REVISION=9f967d15e9ccdf43078586d1476ee70f314401bd
PIPER_ASSET_MANIFEST_PATH=/opt/bmo/models/piper/PIPER_ASSET_MANIFEST.json
```

Piper is the single fixed production voice approved by explicit operator
listening approval for personal, noncommercial use. The integrated worker
loads the pinned model once and keeps it warm for serialized requests. No
voice selector, speaker catalog, model registry, arbitrary model path, or
request-level voice choice exists.

The exact ONNX, config, model-card, dataset-license, and manifest hashes are
recorded in [`P8-PRODUCTION-ROLLOUT-EVIDENCE.md`](P8-PRODUCTION-ROLLOUT-EVIDENCE.md)
and `audio-service/PIPER_ASSET_MANIFEST.json`. Assets are provisioned outside
Git and mounted read-only; runtime model downloads are disabled.

## Kokoro fallback TTS

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

RVC is archived experimental work, is not a production dependency, and is not
enabled. Production keeps `RVC_ENABLED=false`; Piper failure routes
automatically to Kokoro `af_heart` at speed `0.80`. The compact RVC evidence
and Git history remain archived for provenance only.
Historical status: Real RVC inference remains unverified; this does not
describe a current production runtime.

P8 production/resource verification passed with zero new OOM events, zero
Audio restarts, safe host reserve, and no material process, descriptor, memory,
or temporary-file growth. The P7 rollback image remains available locally.

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

## P9 voice-settings boundary

P9 may add mobile-editable, Backend-validated settings for the fixed Prudence
profile, safe speech speed, playback volume, response-length preference,
preview, and reset-to-default. No voice selector, custom model, checkpoint,
voice cloning, RVC, or runtime model download is implemented by P9
architecture. Production values above remain authoritative until a later
implementation phase provides fresh evidence.

## P8 production result and archived experiments

The RVC canary was closed on its unmerged feature branch as
`P8_CANARY_NEEDS_LARGER_HOST`. It remains disabled in production.

The Piper feasibility branch was followed by the controlled production
integration branch `feat/p8-piper-production`. Its operator approval,
replacement canary, fallback/recovery tests, public regression, final-main
deployment, and soaks are recorded in
[`P8-PRODUCTION-ROLLOUT-EVIDENCE.md`](P8-PRODUCTION-ROLLOUT-EVIDENCE.md).
Piper is the current running primary.

The RVC experiment remains archived at
`feat/p8-rvc-foundation` / `8420d4192a16025f439c040cd7a32a50b41fe52b` with
classification `P8_CANARY_NEEDS_LARGER_HOST`. It was not merged or deployed.

Database persistence is not implemented. P9 PostgreSQL and persistent
user/device data remains the next major phase; mobile voice settings are not
implemented.
