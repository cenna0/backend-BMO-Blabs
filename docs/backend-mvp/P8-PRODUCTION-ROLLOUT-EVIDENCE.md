# P8 — Piper Prudence Production Rollout Evidence

**Classification:** `P8_PIPER_PRODUCTION_VERIFIED`
**Execution date:** 2026-08-03
**Operator approval:** explicit manual listening approval recorded in this report
**Scope:** fixed Piper primary TTS integration, Kokoro fallback, production canary,
acceptance, and bounded soak. RVC was not deployed.

The Piper implementation, isolated smoke test, production replacement canary,
fallback/recovery tests, public regression, final-main deployment, and bounded
soaks passed. GitHub synchronization was completed with a repository-scoped
deploy key, and the final production image was built from the exact verified
main revision. P7 remains retained as the deterministic rollback state.

This report is sanitized. It contains no device token, Hermes API key,
internal-service token, authorization header, transcript, provider credential,
raw environment file, listening sample, model archive, or secret value.

## 1. Decision and locked MVP scope

The operator manually listened to the Piper Prudence comparison bundle and
explicitly approved the voice for BMO for personal, noncommercial use. This is
an operator listening approval, not a numeric score; no numeric listening score
is claimed.

The fixed production configuration is:

```text
TTS_PRIMARY_ENGINE=piper
PIPER_MODEL=en_GB-semaine-medium
PIPER_SPEAKER=prudence
PIPER_SPEAKER_ID=0
TTS_FALLBACK_ENGINE=kokoro
KOKORO_VOICE=af_heart
KOKORO_SPEED=0.80
RVC_ENABLED=false
```

Voice selection, multiple Piper models, multiple exposed speakers, database
persistence, mobile voice settings, P9, and P10 were not implemented. P9 is
the next major phase and requires separate authorization.

## 2. Source chain and architecture

```text
Original main                 cfbd718f3206ccdc1ea8157b2dc177f235d8181f
Piper feasibility commit      c82b21287d8893a5a090464b6126c5e42e45cd8e
Production branch             feat/p8-piper-production
Production worktree           /opt/bmo/app/.worktrees/p8-piper-production
Production implementation     4e2cbda3f8eb02e27120821a11233e7848699249
```

The production integration uses an integrated persistent Piper worker inside
the Audio Service. The worker is private, supervised by the Audio Service,
loads the pinned model once, serializes synthesis, validates WAV output, and
uses the existing FFmpeg/audio lifecycle. This is the simplest rollback-safe
architecture for the current service: it adds no public port or sidecar
network, keeps failure handling at the existing TTS boundary, and permits a
worker failure to be recovered or routed to Kokoro without changing Backend,
Hermes, or hardware behavior.

Piper accepts only the centralized fixed configuration. Callers cannot provide
model paths or speaker IDs. The worker has bounded startup/request/shutdown
behavior, request-local temporary paths, exact cleanup, no runtime downloads,
non-root execution, read-only model assets, read-only root filesystem, dropped
capabilities, no-new-privileges, bounded logs, PID/CPU/memory limits, and no
automatic restart loop during the initial canary.

## 3. Immutable Piper assets

Production assets are outside Git at `/opt/bmo/models/piper`, mounted read-only.
The model directory is not writable by the runtime user and no model archive,
weight, listening audio, or cache is in Git.

```text
Engine upstream: https://github.com/OHF-Voice/piper1-gpl
Engine release:  v1.6.0
Engine commit:   f04d52c5528ac7cf2d73757f57990ff490f75005
Voice upstream:  https://huggingface.co/rhasspy/piper-voices
Voice revision:  9f967d15e9ccdf43078586d1476ee70f314401bd
Manifest:        audio-service/PIPER_ASSET_MANIFEST.json
Manifest SHA256: 9e92d11f5010448b3ab978648a8a4e300501b227f73b60794b9039ca39b27383
```

```text
en_GB-semaine-medium.onnx
  d6dab6f3b92db43ea3f78c7f20dc8eadb47a1f15d8a1c9d451cf3ccd201a2f66
en_GB-semaine-medium.onnx.json
  6425dcb878684043b77d772b173ae006d86a583b110303edda48b8438ecee5ee
MODEL_CARD
  d3c370c9c73b69347f9487cc24b0cfa5f2a400c47d209f0aa4ce20123562e46d
DFKI-SEMAINE-LICENSE.md
  c0b81b610f4d9e0e0bb29ac4441106d0b4fb570b67d95f253df0c5db68c92eca
```

The engine is GPL-3.0-or-later. The voice model card and DFKI SEMAINE dataset
license are retained with the provisioned assets. The approved usage position
is personal/noncommercial operator use; this report does not claim commercial
rights.

The model emits mono 22,050 Hz WAV. The production contract remains mono
24,000 Hz target 96 kbps MP3 after the existing FFmpeg step.

## 4. Protected rollback

The exact P7 Kokoro rollback bundle is protected outside Git at:

```text
/opt/bmo/temp/p8-piper-production/rollback
```

It includes a sanitized P7 snapshot, exact local image reference, configuration
references and checksums, a rollback procedure, and an offline verifier. The
P7 image remains locally available:

```text
bmo-audio@sha256:62d8b48feb978e303831e20dc558cb95d3240af9a3cf09e8dcd0c82142986e7e
Audio env checksum: 3ced8033d38533d473abdbe53cacb6c3cf3ea58fb40fb2368a50abcc0b3af15c
P7 Compose checksum: 3040cf3ea479536cbae0cfd7a0d35d11ab9bed7df69ba285e6496cf6354b855c
```

The offline rollback references were verified before each maintenance window.
The exact P7 image and original configuration references remain locally
available and were retained after the successful Piper deployment.

## 5. Candidate and resource controls

```text
Candidate source: ff55eb4ea1c8d58e96b647d0c03f471dd4c58994
Candidate tag:    bmo-audio:p8-piper-candidate-ff55eb4
Candidate image:  sha256:024f2035e185e2b1b3ee35ae0f30668b5373d5d334fa65a6b5edb47a8ceee367
Image size:       736893724 bytes
Runtime user:     bmo
Entrypoint:       /usr/bin/tini -g --
```

The candidate used the exact production environment references, loopback-only
`127.0.0.1:8001`, no runtime downloads, read-only model mount, no-new-
privileges, all capabilities dropped, read-only root, `pids_limit=128`,
`cpus=4`, `mem_limit=5g`, and `memswap_limit=5g`. The initial canary used
restart policy `no`; final deployment uses the approved normal policy only
after readiness.

The first overlapping isolated test was stopped because the already-running
P7 Audio Service plus the Piper candidate drove host `MemAvailable` below the
emergency gate. The candidate was terminated immediately, P7 stayed healthy,
and no OOM counter increment occurred. The authorized replacement-shaped
isolation with P7 stopped then passed all isolated gates. This is recorded as
the reason not to run overlapping P7/candidate Audio containers on this
8.3 GiB, no-swap host.

## 6. Isolated production-shaped smoke

The candidate ran on a private alternate network/port with P7 stopped and no
public exposure. It passed readiness, offline hash verification, Whisper,
Piper short/medium/long/30-second requests, Kokoro fallback, Piper recovery,
FFmpeg/MP3 validation, cleanup, and bounded shutdown.

```text
Short:       Piper 0.911 s; mono/24 kHz/96 kbps MP3; 4.752 s duration
Medium:      Piper 1.053 s; mono/24 kHz/96 kbps MP3; 10.944 s duration
Long:        Piper 2.704 s; mono/24 kHz/96 kbps MP3; 14.640 s duration
Continuous:  2.892 s synthesis; mono/24 kHz/96 kbps MP3; 30.216 s duration
Recovery:    3.745 s after worker failure; next warm request 0.828 s
Sequential:  20/20 Piper requests; stable worker PID; no reload per request
Queueing:    2 bounded requests; both valid; serialized without corruption
Shutdown:    active synthesis stopped within 20 s; exit 143; no orphan worker
```

The isolated candidate had approximately 2.2 GiB fully loaded memory and at
least approximately 3.925 GiB host `MemAvailable` during the 20-request run.

## 7. Production maintenance, acceptance, and soak

Maintenance began at `2026-08-03T06:33:47+02:00`. Only the Audio Service was
replaced. Backend, Hermes, Caddy, monitoring, and unrelated infrastructure
remained running. Candidate readiness completed in approximately 26 seconds;
restart count stayed zero and `OOMKilled=false`.

Primary production requests all returned valid MP3 and internal Piper metadata:

```text
short:        200, Piper, 0.844 s, 57,357 bytes, 4.752 s
medium:       200, Piper, 0.982 s, 112,077 bytes, 9.312 s
long:         200, Piper, 2.030 s, 185,517 bytes, 15.432 s
continuous:   200, Piper, 2.983 s, 363,213 bytes, 30.240 s
```

The forced active-worker failure returned a successful Kokoro response using
`af_heart` at `0.80`: HTTP 200, valid mono 24 kHz target 96 kbps MP3, 50.68 s
including the bounded fallback path, with no hardware-visible error. After
restoring normal operation, Piper recovered and returned four subsequent
successful requests: 3.557 s reload/recovery, then 0.885 s, 1.334 s, and
2.714 s warm requests.

The full public request path passed with real WAV input through Whisper,
Hermes, Piper, FFmpeg, the existing audio lifecycle, and `audio_ready`. The
sanitized backend timing record showed STT 69.102 s, Hermes 8.167 s, TTS 1.703
s, total 78.994 s; the TTS engine was Piper and `rvc_applied=false`.

The native Node 22 public equivalent passed 12/12 live checks: health,
hidden internal routes, invalid/valid WebSocket authentication, upload,
active-request conflict, `display_status`, `audio_ready`, MP3 retrieval,
playback completion, and completed-audio unavailability. The committed P7
TypeScript verifier could not run in the immutable production Backend image
because that image intentionally omits the dev-only `tsx` runner; the native
equivalent exercised the live contract without changing the image.

The initial production soak passed:

```text
Duration:       1842.9 seconds
Samples:        29
Piper probes:   all successful, no unexpected fallback
Fallback probe: Kokoro success, followed by Piper recovery
OOM delta:      0
Restart count:  0
Container:      healthy throughout
Public:         /health=200, /livez=404, /readyz=404 throughout
```

Observed production canary ranges were approximately:

```text
Candidate memory.current: 4.320–4.390 GiB
Host MemAvailable:        2.596–2.689 GiB
Processes:                3
File descriptors:         25
Temporary files:          0
```

The host no-swap safety gates were never crossed during the replacement
canary. Kernel OOM counter delta was zero. The minimum relevant free disk was
21.64 GB before cache cleanup and 22.28 GB after unused Docker build-cache
cleanup; the 20 GB stop gate remained satisfied.

## 8. Repository authentication and synchronization

GitHub repository: `cenna0/backend-BMO-Blabs` (public; `main` unprotected at
the time of integration). Repository access was established with the existing
dedicated Ed25519 deploy key; no key was regenerated.

```text
Deploy-key title:       BMO Production VPS
Public fingerprint:     SHA256:4s/5+Ehv8qA2+6dKTBuSSf7sko43oJBazAavWP6PyAw
Private-key path:       /home/bmo-admin/.ssh/github_bmo_deploy
Origin:                 git@github-bmo:cenna0/backend-BMO-Blabs.git
Remote main before work: cfbd718f3206ccdc1ea8157b2dc177f235d8181f
Feature branch pushed:  4e2cbda3f8eb02e27120821a11233e7848699249
```

The private key, device code, GitHub token, credential files, and secret
environment values are not recorded. A temporary GitHub CLI device session
was used only to attach the existing public key with write access, then was
logged out and its temporary credential directory was removed. Subsequent
`ssh`, `git ls-remote`, and `git fetch` operations succeeded through the
repository-specific alias.

## 9. Final-main revalidation

After authentication, the preserved production implementation was revalidated
without repeating feasibility work. The temporary candidate used source
`4e2cbda3f8eb02e27120821a11233e7848699249` and image digest
`sha256:460b7ac9d42cde89347630c959e925c3f4ea1c3c6ffe8e9c1b4d48e51a707b8e`.

```text
Audio/Piper automated tests: 103 passed, 2 warnings
Public live regression:      12/12 passed
Short/long/continuous:       Piper, valid MP3, no fallback
Forced failure:              Kokoro af_heart / 0.80, HTTP 200
Recovery:                    Piper, warm worker recovered
Warm sequential probes:      5/5 Piper
Revalidation soak:           640.7 s, 10/10 Piper samples
Fallback/recovery soak probe: Kokoro success followed by Piper success
OOM delta:                   0
Candidate restarts:          0
Candidate health:            healthy throughout
Public health routes:        200 / 404 / 404
Processes / descriptors:     3 / 25, flat
Temporary files:             0 throughout
Minimum host MemAvailable:   approximately 3.227 GiB
```

The public regression preserved the existing WebSocket and audio lifecycle:
invalid and valid authentication, upload, active-request conflict,
`display_status`, `audio_ready`, MP3 retrieval, playback completion, and
completed-audio unavailability all passed. The final image, deployed source
label, and remote `main` equality are recorded by the final deployment
verifier and closure report.

## 10. Acceptance matrix and repository gates

Passed before closure:

- Audio Service and Piper tests: `103 passed, 2 warnings`;
- compileall, runtime and Piper dependency `pip check`, offline/no-download
  checks, FFmpeg/ffprobe MP3 validation;
- fixed configuration, exact speaker mapping, manifest hashes, model-loaded-
  once, fallback, malformed/zero-byte/invalid-duration output, cleanup,
  process-tree, failure, and shutdown tests;
- 20 sequential production Piper requests with no OOM, restart, process,
  descriptor, temporary-file, or retained-memory growth;
- bounded two-request queueing/concurrency with no ID/output mix-up;
- public/hardware contract regression, including unchanged request/audio IDs,
  lifecycle events, playback behavior, retry/conflict handling, and MP3
  contract;
- Hardware Contract SHA-256:
  `633e398a7fa39a3ebc469af7f9ca46fd04890339bb132ec7de2c2286207c6a44`;
- PRD v1.2.4 remained unchanged at the repository verifier's pinned hash;
- no model/audio/cache/secret/generated artifact entered Git.

The RVC branch `feat/p8-rvc-foundation` at
`8420d4192a16025f439c040cd7a32a50b41fe52b` was not merged, deployed, or
rerun. RVC remains disabled and its archived evidence remains preserved.

## 11. Closure

The final Piper image was built from the exact final `main` revision, deployed
as the running production Audio Service, and passed final smoke and the
15-minute post-redeployment soak. Local `main` equals remote `main`, the
running image source label equals that revision, and the P7 image remains
available for offline rollback.

Final classification: `P8_PIPER_PRODUCTION_VERIFIED`.

Piper Prudence is the fixed primary production TTS. Kokoro `af_heart` at speed
`0.80` is the automatic fallback. RVC is disabled. The public Backend,
WebSocket, hardware events, authentication, IDs, lifecycle, playback, retry,
TTL, and error contracts are unchanged.
