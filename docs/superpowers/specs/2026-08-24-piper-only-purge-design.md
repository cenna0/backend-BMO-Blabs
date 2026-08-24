# BMO Piper-Only Audio Cleanup and Kokoro/RVC Purge Design

Date: 2026-08-24
Status: Approved design; implementation pending
Supersedes the runtime scope of `2026-08-24-remove-rvc-design.md`.

## Goal

Move production BMO to one verified audio path:

```text
ESP / voice input
→ faster-whisper STT
→ Hermes
→ Piper TTS
→ FFmpeg
→ MP3
→ ESP playback
```

The final active production state is faster-whisper, Hermes, Piper-only TTS,
and FFmpeg. Local Kokoro and RVC implementations, configuration, bootstrap,
tests, dependencies, model artifacts, and active documentation are removed or
made explicitly historical. The existing `main` history, remote, unrelated
working-tree changes, PostgreSQL, Hermes, faster-whisper, Piper, and FFmpeg are
preserved.

## Current context and constraints

- Production audio is `bmo-audio@sha256:62ad9adead83d863ab2bf28a2ac75e5a116dc68bab8ff06eec81b7a0407ddb34`.
- The production image is built from `audio-service/Dockerfile` and the
  current service uses Piper primary with Kokoro fallback.
- The observed production audio RSS is approximately 2.217 GiB.
- The observed host baseline is approximately 7.8 GiB total, 2.9 GiB
  `MemAvailable`, and no swap.
- Current model sizes include approximately 1.53 GiB faster-whisper,
  328 MiB Kokoro, and 74 MiB Piper.
- The repository has unrelated dirty P9/Spotify/WhatsApp changes. The
  migration must capture `git status --short`, `git diff`, and
  `git diff --cached` before modification and use task-specific staging.
- No external consumer requires the legacy RVC/Kokoro compatibility fields.
- No database schema or data change is required.

## Runtime architecture

The Audio Service is changed in place and built as a new immutable candidate
image. Its TTS graph contains only:

```text
TtsOrchestrator(PiperSynthesizer, FfmpegConverter)
```

Piper synthesis errors terminate the request with `TTS_FAILED`; FFmpeg is not
called after a Piper failure and no fallback engine is attempted. FFmpeg errors
also become `TTS_FAILED`. Successful responses remain MP3 and retain
`X-TTS-Engine: piper` as optional observability metadata.

The backend Audio Service client no longer sends `use_rvc` and no longer
parses or propagates RVC-applied state. The WebSocket `audio_ready` MP3
contract and the `TTS_FAILED` request failure code remain unchanged for ESP.

## Liveness and readiness contract

- `/livez` proves only that the Audio Service process can serve requests.
- `/health` is a process-level health endpoint and does not require model
  readiness.
- `/readyz` is the dependency gate. It returns HTTP 200 only when
  `stt_loaded`, `piper_loaded`, and `ffmpeg_available` are all true; otherwise
  it returns HTTP 503. It has no Kokoro or RVC fields.
- Backend health/readiness consumers remove `rvc` and use the new audio
  readiness contract without requiring `kokoro_loaded` or `rvc_available`.

## Candidate rollout and memory gates

Candidate build is allowed while production remains live. Candidate runtime is
not allowed to start until the operator captures:

```text
free -h
free -b
docker stats --no-stream
```

Protected workloads include `bmo-production-*`, production PostgreSQL,
Hermes, and required operational services. Only a non-production workload
proved unused by read-only inspection may be stopped; no unrelated volumes,
images, or data are deleted.

The hard pre-start gate is `MemAvailable >= 4 GiB`. If it fails, candidate
audio is not started, production is not stopped, artifacts are not purged,
and the result is `BLOCKED_RESOURCE`. Unit tests and image build may still be
completed.

When the gate passes, the candidate Audio Service runs on an isolated port
(8002), with read-only mounts for the existing Whisper and Piper model assets,
an isolated writable TTS temp path, and offline runtime settings:

```text
MODEL_DOWNLOAD_ALLOWED=false
HF_HUB_OFFLINE=1
TRANSFORMERS_OFFLINE=1
ORT_DISABLE_ALL_NETWORK=1
```

The candidate must not download or mount Kokoro/RVC assets. Candidate
full-pipeline requests must point explicitly to port 8002, never production
port 8001.

After candidate `/readyz` returns 200, capture `MemAvailable` again. If it is
below 1.5 GiB, or if `OOMKilled`, container restart/health failure, or other
observable kernel/container resource pressure is detected, stop the candidate
and return `BLOCKED_RESOURCE`.

Before promotion, record the exact old production image digest and exact
candidate digest. Promotion changes only the production Audio Service image
to the candidate digest and keeps the old image available for deterministic
rollback. Post-promotion verification must pass before any old-image cleanup
or model/cache purge.

Rollback restores the recorded old digest and recreates only the production
Audio Service. No database rollback is involved.

## Verification matrix

The implementation must provide evidence for:

1. Audio unit tests: Piper success, Piper failure to `TTS_FAILED` without
   fallback, FFmpeg success/failure, valid MP3, cleanup, and warm-up.
2. API tests: authentication, `/livez`, process-level `/health`, `/readyz`
   success/failure, STT, TTS, and strict removal of RVC/Kokoro contract fields.
3. Real candidate checks: candidate `/readyz`, real faster-whisper STT, real
   Piper WAV synthesis, real FFmpeg MP3 encoding, and MP3 format validation.
4. Candidate backend/Hermes/fake-ESP flow: WAV → candidate STT → Hermes →
   candidate Piper → candidate FFmpeg → MP3 → `audio_ready`; failures include
   `TTS_FAILED`.
5. Post-promotion production smoke test through the production backend and
   fake ESP, followed by `/livez`, `/health`, `/readyz`, Hermes, PostgreSQL,
   and backend checks.
6. Resource evidence: audio memory, host `MemAvailable`, image size, and disk
   usage before and after.

## Cleanup boundary

Only after candidate and post-promotion production verification pass:

- delete Kokoro/RVC runtime source, config, bootstrap, tests, active manifests,
  and active documentation semantics;
- remove dependencies proven exclusive to Kokoro/RVC across Python imports,
  subprocess commands, Docker/system packages, bootstrap scripts, and runtime
  startup paths;
- selectively delete Kokoro model/cache and RVC model/archive/index/temp
  artifacts, retaining shared Whisper/Piper/HuggingFace cache content;
- update active documentation to Piper-only and mark retained historical
  evidence `DEPRECATED`, `HISTORICAL ONLY`, and `DO NOT IMPLEMENT`;
- delete only verified RVC-specific local branches and stale local
  remote-tracking refs. Do not alter the remote, rewrite `main`, expire
  reflogs, or prune unreachable Git objects.

## Semantic acceptance rule

The final workspace must have zero active Kokoro/RVC references in runtime
source, configuration, tests, Docker/bootstrap paths, health/readiness, or
backend/ESP contracts. Remaining matches are allowed only in clearly marked
historical/deprecated documentation/evidence and immutable Git history. Each
remaining match is reviewed manually.

## Non-goals

- Changing Hermes, faster-whisper behavior, Piper voice assets, FFmpeg
  encoding, PostgreSQL schema/data, ESP playback format, or unrelated P9,
  Spotify, and WhatsApp work.
- Deleting the old production image before post-promotion verification.
- Aggressive Git reflog expiration, object pruning, force pushes, or remote
  branch deletion.
