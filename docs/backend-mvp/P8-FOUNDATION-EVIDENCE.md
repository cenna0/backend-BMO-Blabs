# P8 RVC Foundation Evidence (Draft)

Status: **FOUNDATION CHECKPOINTED; CANARY REQUIRES A LARGER HOST**

The foundation is preserved in local checkpoint
`d7c207cef2c68c05a8799a6cd87d6d2fb906934b`. The Prompt 3 Tini/test changes were
retained uncommitted for Prompt 4 closure review and are included in the local RVC
closure commit that contains this evidence. This does not mark P8 verified, approve
voice quality, enable RVC in production, or authorize deployment.

## Scope and isolation

- Branch: `feat/p8-rvc-foundation`
- Worktree: `/opt/bmo/app/.worktrees/p8-rvc-foundation`
- Base SHA: `cfbd718f3206ccdc1ea8157b2dc177f235d8181f`
- Primary checkout: clean and unchanged
- Candidate asset root (outside Git):
  `/opt/bmo/temp/p8-rvc-foundation-candidate`
- Production containers, environment, model directories, image selection, firewall,
  proxy, Hermes, and public ports were not changed or restarted.

## Initial production sanity

- Ubuntu 24.04.4 LTS, Linux 6.8.0-124-generic, 4 logical CPUs.
- RAM: 8,326,950,912 bytes; no swap. Initial MemAvailable was approximately
  3.06 GiB.
- Initial relevant free disk was approximately 59.1 GiB, always above the 20 GiB
  stop threshold.
- Docker 29.6.2 and Compose 5.3.1.
- Backend and Audio Service healthy with `RestartCount=0`.
- Backend image remained
  `sha256:e981751498fca13bf1f1c1c046a6874a490b3e681aeef9787a53181059506fd7`.
- Audio image remained
  `sha256:62d8b48feb978e303831e20dc558cb95d3240af9a3cf09e8dcd0c82142986e7e`.
- Running OCI revision remained `4d7b472adc4c2243d8f7364032a491ad70efb6d3`.
- Public `/health` returned 200 with RVC unavailable; `/livez` and `/readyz`
  returned 404 as expected at the public backend.
- Hermes `hermes-gateway.service` was active and its loopback health endpoint
  returned version 0.19.0.
- Ports 3000, 8001, and 8642 were loopback-only.
- Production `RVC_ENABLED=false` was confirmed without printing secrets.

## Current implementation gap audit

### Adapter before this checkpoint

- `RVC_INFER_COMMAND` was parsed with `shlex` and invoked without `shell=True`,
  which avoided shell interpolation, but it still permitted an arbitrary executable.
- Arguments were an array, but the executable and supporting asset boundary was not
  pinned to one engine.
- Timeout handling did not terminate and reap the complete child process group.
- stdout/stderr capture was unbounded and raw stderr/path details could reach logs.
- The child inherited the Audio Service environment, including its internal token.
- RVC success meant only that a non-empty file existed; WAV structure, duration,
  finite samples, amplitude, location, and size were not validated.
- Temporary orchestration cleanup existed, and ordinary RVC exceptions fell back to
  Kokoro, but malformed output could survive until FFmpeg and fail the request.
- A missing index was not represented as a clearly optional, tested contract.

### Bootstrap before this checkpoint

- The locked archive source, revision, expected size, and SHA-256 were present, and
  download required explicit operator action.
- Extraction lacked complete normalized-path, duplicate, link/special-file,
  executable, member-count, per-member size, total-size, and unexpected-extension
  controls.
- Extraction was not atomic and exact extracted hashes/permissions were not enforced
  on idempotent reruns.
- HuBERT and RMVPE did not have immutable materialization records.

### Packaging and runtime before this checkpoint

- The P7 Python 3.10.20 runtime lock was pinned and offline Whisper/Kokoro were
  verified, but no RVC dependency environment or exact RVC engine existed.
- P7 used Torch 2.13.0+cpu and NumPy 2.2.6. A matched RVC Torch/Torchaudio pair,
  FAISS, librosa, numba, PyWorld, and RMVPE dependencies were absent.
- Production had a read-only model mount, writable cache/temp paths, non-root UID,
  and no RVC assets. The Audio Service received its internal service token but no
  device, Hermes, Telegram, or provider credentials.
- RVC availability/readiness was based on shallow local checks rather than a signed
  candidate manifest and exact artifact hashes.

### Existing evidence

- P3 proved the Kokoro/FFmpeg pipeline and a mocked/external-command RVC fallback
  boundary. It did not run the locked RVC model.
- P7 proved immutable offline Whisper/Kokoro startup, resource observations, and
  production Kokoro-only operation. It did not install or execute RVC.
- Before this checkpoint no exact engine, support-asset provenance, safe checkpoint
  load, real RVC WAV, or real RVC-to-MP3 result had been verified.

## Selected engine

- Repository: `RVC-Project/Retrieval-based-Voice-Conversion`
- Exact revision: `7b284a634667c34103eaaeed972b48ccdb4b893e`
- License: MIT
- Interface: repository library `rvc.modules.vc.modules.VC`, wrapped by the local
  deterministic `/app/scripts/rvc_infer.py` worker.
- Python: upstream declares Python `^3.10`; candidate is Python 3.10.20.
- Device: fixed to CPU.
- Fairseq source: `Tps-F/fairseq` revision
  `ff08af27e302625a27d3502b0791a9367c8af0c7`, MIT.

The official upstream was selected because it owns the RVC implementation, exposes a
library/CLI path without requiring its Web UI server, explicitly targets Python 3.10
at this revision, supports RVC v2/f0 checkpoints and FAISS indexes, and passed the
locked-model smoke. Current upstream WebUI tags targeting Python 3.12, mutable helper
packages that auto-download models, and unpinned community wrappers were rejected.

The exported engine source is fetched and verified by full commit SHA during the
candidate build. No archive script or model-repository code is executed.

## Locked BMO model inspection

- Repository: `Freaky98/CGO-adventure-time-BMO-rvc-v2-420e`
- Revision: `82a8bc529bd41b930589188ead30f073d4f99fc0`
- Archive: `CGO-adventure-time-BMO-rvc-v2-420e.zip`
- Archive bytes: 63,780,149
- Archive SHA-256:
  `dadb3507d3f836836b16c5605ace8d383e57eddcc92dc2a5fc4406e1c49d27f0`
- License metadata: `openrail`; minimal community model card.

The archive had two root-level regular non-executable members, no duplicates,
traversal, links, devices, scripts, or nested archives, and 63,779,791 total
uncompressed bytes:

| Artifact | Bytes | SHA-256 |
|---|---:|---|
| `CGO_e420_s2520.pth` | 55,226,492 | `1fb66eb767b994e2aa470fdb0cdf793424f57503e8a67e7ee47f10c64278b260` |
| `added_IVF69_Flat_nprobe_1_CGO_v2.index` | 8,553,299 | `3cd9589905a8bef196d66749361e96bebfe852509a8e74df2e3952332440dd3d` |

Safe checkpoint metadata identified RVC v2, f0 enabled, target 40 kHz, 457 tensor
weights, and speaker embedding shape `[109, 256]`. The index is a trained
`IndexIVFFlat`, dimension 768, `ntotal=2708`, `nlist=69`, and `nprobe=1`.

## Supporting assets

Both assets come from the support repository used by the official engine Docker
configuration:

- Repository: `lj1995/VoiceConversionWebUI`
- Revision: `88e42f0cb3662ddc0dd263a4814206ce96d53214`
- Repository license: MIT

| Role | Filename | Bytes | SHA-256 | Candidate runtime path |
|---|---|---:|---|---|
| HuBERT content features | `hubert_base.pt` | 189,507,909 | `f54b40fd2802423a5643779c4861af1e9ee9c1564dc9d32f54f20b5ffba7db96` | `rvc/support/hubert_base.pt` |
| RMVPE f0 estimation | `rmvpe.pt` | 181,184,272 | `6d62215f4306e3ca278246188607209f09af3dc77ed4232efdd069798c4ec193` | `rvc/support/rmvpe.pt` |

The candidate manifest is
`/opt/bmo/temp/p8-rvc-foundation-candidate/runtime/MODEL_MANIFEST.rvc.json`, SHA-256
`3b72958a73ee39d9f428298c1b91c4aca532c94825f9170f162246eec69673ce`.
It is a separate four-artifact candidate set and does not alter the approved P7
seven-artifact fingerprint.

## Checkpoint loading security

- Model and RMVPE checkpoints had no unsupported unsafe globals under Torch's
  weights-only scanner.
- HuBERT required only
  `fairseq.data.dictionary.Dictionary`; that exact class is the sole allowlisted
  global.
- `TORCH_FORCE_WEIGHTS_ONLY_LOAD=1` is enforced in the worker environment and all
  three support/model checkpoints loaded successfully with weights-only behavior.
- No unsafe pickle load was used on the host. No model was loaded in a process with
  production secrets.
- Inspection and inference used disposable non-root, no-network containers with a
  read-only root, bounded writable paths, no Docker socket, no public port, and no
  production environment file.

## Dependency lock and image

The P7 `requirements-runtime.lock` is unchanged. RVC runs in a separate
`/opt/rvc-venv` so its older compatible scientific stack does not mutate Whisper or
Kokoro.

Key exact RVC dependencies are:

- Torch `2.11.0+cpu` and Torchaudio `2.11.0+cpu` from the official CPU wheel index.
- NumPy `1.26.3`, FAISS CPU `1.7.4`, librosa `0.10.1`, SoundFile `0.12.1`.
- Numba `0.58.1`, llvmlite `0.41.1`, SciPy `1.15.3`, PyWorld `0.3.4`.
- PyAV `11.0.0`, praat-parselmouth package `praat-parselmouth` `0.4.3`, and
  torchcrepe `0.0.22`.
- Fairseq `0.12.2` from full revision
  `ff08af27e302625a27d3502b0791a9367c8af0c7` with no floating Git reference.

`requirements-rvc.lock` and the build lock use exact versions and hashes where pip
supports them; the Git lock uses a full SHA. Both the P7 and RVC environments pass
`pip check`. Torch reports `2.11.0+cpu`, CUDA unavailable, with no NVIDIA package or
Triton installed.

Final candidate image:

- Tag: `bmo-audio:p8-rvc-foundation-candidate`
- ID: `sha256:6b7a93b2fccb0a6d2254c884d1292857998358bf8ed5b3473c0289987aa54639`
- Size: 1,213,934,976 bytes
- User: `bmo` (UID/GID 10001)
- OCI revision label: `cfbd718f3206ccdc1ea8157b2dc177f235d8181f`
- RVC engine label: `7b284a634667c34103eaaeed972b48ccdb4b893e`

The final image started with `network=none`, a read-only root filesystem, no
published ports, no production secrets, and `/livez=200`. Runtime download flags
were disabled and network was absent. The container was intentionally stopped after
the startup proof; it did not OOM or restart. Because P7 model warm-up was still in
progress, graceful stop did not complete within Docker's 10-second grace period and
Docker ended the disposable container with exit 137. Graceful shutdown during model
warm-up was not assessed by this foundation checkpoint.

## Hardening implemented

### Adapter

- Fixed worker executable and script; no arbitrary configured executable.
- Array arguments only and no shell execution or command interpolation.
- Canonical request-local input/output validation, including paths with spaces and
  shell metacharacters.
- Minimal child environment with no inherited device/internal/provider secrets.
- Offline flags, CPU-only device, weights-only checkpoint policy, and request-local
  Numba cache.
- New process session, group TERM then KILL, wait/reap, Linux child-subreaper support,
  and regression-tested descendant cleanup.
- 120-second default timeout and bounded captured stdout/stderr; captured content is
  discarded and errors are sanitized.
- Exact manifest/path/size/hash verification with a best-effort file-cache release
  after hashing.
- WAV validation before FFmpeg: regular approved path, bounded size, WAV format and
  subtype, sane channels/rate/duration, finite samples, and bounded amplitude.
- Output cleanup on non-zero exit, timeout, validation failure, and exceptions.
- Malformed/failed RVC always returns to the Kokoro/FFmpeg path.

### Bootstrap

- Explicit local sources or opt-in `--allow-download`; default runtime never
  downloads.
- Exact archive size and hash before extraction.
- Normalized path and Windows/absolute/traversal/null/backslash rejection.
- Link/special/device/encrypted/executable rejection.
- Case-insensitive duplicate-path and duplicate-basename rejection.
- Maximum 32 members, 128 MiB per member, and 256 MiB total uncompressed size.
- Only one `.pth` and at most one optional `.index`; no scripts or nested content.
- Streaming inspection/hashing and `O_EXCL`/`O_NOFOLLOW` extraction into an atomic
  staging directory.
- Exact extracted sizes/hashes, 0444 files, 0555 asset directory, immutable support
  assets, deterministic manifest, and verified idempotent offline reruns.

## Automated tests

New or expanded coverage includes:

- Adapter disabled/missing components, optional and invalid indexes, manifest
  integrity, exact argv, spaces/metacharacters, environment isolation, non-zero exit,
  bounded stderr, timeout, group termination/reaping, missing/empty/malformed/NaN/
  unreasonable WAVs, success, and output cleanup.
- WAV and MP3 structure, duration, finite/amplitude, codec, mono, 24 kHz, and 96 kbps
  validation.
- Archive size/hash, unsafe paths, null, links, duplicates, member/size bounds,
  scripts, required/optional artifacts, exact hashes, atomic permissions,
  idempotency, and offline rerun.
- Worker weights-only loading, exact CPU/RMVPE/index arguments, optional index,
  approved output path, invalid engine output, PCM16 encoding, and sanitized errors.
- TTS fallback state/cleanup/log sanitization and API success/fallback headers.
- Existing Whisper, Kokoro, FFmpeg, health, auth, STT, and API regression suites.

Results:

- Full Audio Service pytest: **167 passed**, one expected `zipfile` duplicate-name
  warning, 0 failed.
- Compileall for `app/` and `scripts/`: pass.
- P7 environment `pip check`: pass.
- RVC environment `pip check`: pass.
- Documentation verifier: pass after retaining the P7 guarded model/index
  placeholders in `.env.audio.example`.

## Technical smoke inference

Text: `Hi! BMO is ready to help.`

The final-image verification used the exact candidate image, no network, a read-only
root, non-root UID, no public ports, no production secrets, CPU, `f0_up_key=0`,
`f0_method=rmvpe`, the locked index, and a 120-second adapter timeout.

Flow passed:

`real Kokoro WAV -> pinned RVC worker -> validated RVC WAV -> existing FFmpeg -> validated MP3`

Final RVC WAV:

- Path outside Git:
  `/opt/bmo/temp/p8-rvc-foundation-candidate/evidence/listening/p8-foundation-rvc-final.wav`
- 224,044 bytes; SHA-256
  `be0614b4106f32cf65d324378ca81d19092010e4ca8237bd02e09e7d3561dc41`
- Mono PCM16, 40,000 Hz, 112,000 frames, 2.8 seconds.
- Peak normalized amplitude: 0.406707763671875; finite samples.

Final MP3:

- Path outside Git:
  `/opt/bmo/temp/p8-rvc-foundation-candidate/evidence/listening/p8-foundation-rvc-final.mp3`
- 34,605 bytes; SHA-256
  `a7b0b3d13ebd8dbd3cdee0e2da12a2f6b8300e31160a9db651680ce411fac206`
- MP3, mono, 24,000 Hz, 96,000 bps, 2.856 seconds.

Sanitized preliminary observations (not a benchmark):

- Separate Kokoro timing repeat: 25.955 seconds; isolated peak 1,741,381,632 bytes.
- Final-image RVC: 33.939 seconds; isolated adapter-container peak
  2,830,909,440 bytes under a 2,700 MiB cgroup limit.
- FFmpeg: 0.439 seconds.
- Sequential stage sum: 60.333 seconds.
- Co-resident Whisper + Kokoro + RVC memory was deliberately not measured here.

Forced `/bin/false` RVC failure passed through the real orchestrator fallback:

- Request succeeded; `rvc_applied=false`; engine `kokoro`.
- MP3, mono, 24,000 Hz, 96,000 bps, 2.88 seconds.
- Path outside Git:
  `/opt/bmo/temp/p8-rvc-foundation-candidate/evidence/listening/p8-foundation-forced-fallback-final.mp3`
- No request directory remained and no RVC process was orphaned.

Machine-readable evidence is outside Git at
`/opt/bmo/temp/p8-rvc-foundation-candidate/evidence/p8-foundation-smoke.json`.
No listening or quality approval is claimed.

## Files changed

- `.env.audio.example`
- `audio-service/.dockerignore`
- `audio-service/Dockerfile`
- `audio-service/app/audio_validation.py`
- `audio-service/app/config.py`
- `audio-service/app/ffmpeg.py`
- `audio-service/app/rvc.py`
- `audio-service/app/rvc_assets.py`
- `audio-service/app/tts.py`
- `audio-service/requirements-rvc-build.in`
- `audio-service/requirements-rvc-build.lock`
- `audio-service/requirements-rvc-git.lock`
- `audio-service/requirements-rvc.in`
- `audio-service/requirements-rvc.lock`
- `audio-service/scripts/bootstrap_rvc.py`
- `audio-service/scripts/rvc_infer.py`
- `audio-service/scripts/verify_rvc_foundation.py`
- `audio-service/tests/test_audio_validation.py`
- `audio-service/tests/test_config.py`
- `audio-service/tests/test_ffmpeg.py`
- `audio-service/tests/test_rvc.py`
- `audio-service/tests/test_rvc_assets.py`
- `audio-service/tests/test_rvc_bootstrap.py`
- `audio-service/tests/test_rvc_worker.py`
- `audio-service/tests/test_tts.py`
- `audio-service/tests/test_tts_api.py`
- `docs/backend-mvp/P8-FOUNDATION-EVIDENCE.md`
- `docs/superpowers/plans/2026-08-01-p8-rvc-foundation.md`

No model, archive, generated audio, test venv, or candidate image content is in Git.

## Known risks and Prompt 2 work

- The BMO model is a minimally documented community artifact with only `openrail`
  metadata. Legal/provenance review and replacement, if desired, require an explicit
  separate decision.
- Technical runs produced valid but not byte-identical RVC audio. Voice quality,
  stability, and acceptability are not approved.
- The isolated RVC adapter reached approximately 2.831 GB; the separate Kokoro repeat
  reached approximately 1.741 GB. The current host has no swap and production Audio
  already uses approximately 3.6 GiB. These numbers must not be added together or
  treated as production headroom proof.
- The official engine attempts best-effort config rewrites before selecting CPU; the
  read-only image rejects those writes and inference still succeeds. Worker output is
  bounded and sanitized.
- The base image is digest-pinned and Python dependencies are locked, but Debian apt
  package repository snapshots are not yet pinned to a dated snapshot.
- First-use Numba compilation needs a writable request-scoped cache and materially
  affects cold-start memory. The cache is cleaned with the request in normal service
  operation.
- The disposable offline-startup container required SIGKILL after the 10-second stop
  grace period while P7 model warm-up was in progress (`OOMKilled=false`). Prompt 2
  should distinguish ordinary warm-up duration from a shutdown responsiveness issue.

Prompt 2 must perform listening review, sample retention/selection, parameter tuning,
repeated cold/warm latency tests, complete CPU/RAM/disk measurements, combined
Whisper/Kokoro/RVC residency, concurrency and timeout tests, production-headroom
analysis, and the production-suitability decision. Public fake-ESP32 regression,
deployment, production enablement, and physical ESP32 testing remain outside this
checkpoint.

## Production unchanged

Final read-only sanity showed:

- Public `/health=200`, `/livez=404`, and `/readyz=404`.
- Backend and Audio Service healthy, `RestartCount=0`, `OOMKilled=false`.
- Approved backend/audio image digests and running revision unchanged.
- Production `RVC_ENABLED=false` and `MODEL_DOWNLOAD_ALLOWED=false`.
- Ports 3000, 8001, and 8642 remained loopback-only; Hermes remained healthy.
- Final MemAvailable was 3,232,079,872 bytes; free disk was 45,917,601,792 bytes.
- Local main, `origin/main`, and live `refs/heads/main` all remained
  `cfbd718f3206ccdc1ea8157b2dc177f235d8181f`; the primary checkout remained clean.

No commit, merge, push, remote branch, deployment, image replacement, or live
environment change was performed.

## Prompt 2 candidate amendment — 2026-08-02

The foundation implementation was extended in the same uncommitted worktree with
validated engine tuning arguments, objective audio guardrails, whole-pipeline
serialization, and a fixed-command PID 1 supervisor. Focused foundation review still
passed, and the final quality candidate is
`bmo-audio:p8-rvc-quality-candidate` with image ID
`sha256:cfb1a3518c05612137712700adc1e657d92322bc3adb319f93659abd866a791e`.
The immutable model manifest remains
`3b72958a73ee39d9f428298c1b91c4aca532c94825f9170f162246eec69673ce`.

Prompt 2 then established that safe completion of the resource/quality benchmark is
blocked on this host while production remains online: one candidate-only RVC pilot
was cgroup-OOM-killed at 2,500 MiB, and host `MemAvailable` fell below the declared
reserve. The production containers did not restart and remained healthy. This does
not invalidate the isolated technical foundation proof, but it prevents production
candidacy, full listening-candidate selection, or a completed combined-residency
claim. See `docs/backend-mvp/P8-QUALITY-BENCHMARK-EVIDENCE.md`.

## Prompt 3 canary amendment — 2026-08-02

The authorized replacement canary removed P7 Audio residency before starting the P8
candidate. The rebuilt image used native Tini as PID 1 and passed six immediate-start
stops in 125–190 ms, but the first full replacement request reached its 5 GiB cgroup
limit during real RVC inference. Docker recorded `OOMKilled=true`, the kernel
`oom_kill` counter increased from 5 to 6, and the monitor immediately invoked P7
rollback. Host `MemAvailable` was still 1,562,701,824 bytes at the OOM sample, so no
host warning/controlled/emergency threshold was crossed before the stricter cgroup
limit stopped the candidate.

P7 was restored on the exact approved image with `RVC_ENABLED=false`; Backend, Audio,
Hermes, public routing, checksums, model artifacts, and loopback listeners all passed
the final restoration audit. The parameter matrix, complete listening bundle,
20-request stability run, real-inference SIGTERM matrix, and long-form artifact were
not run after the mandatory abort. See
`docs/backend-mvp/P8-CANARY-EVIDENCE.md` for the complete result.
