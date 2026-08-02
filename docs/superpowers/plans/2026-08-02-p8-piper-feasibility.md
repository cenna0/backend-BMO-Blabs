# P8 Piper Prudence Feasibility Implementation Plan

**Status:** completed locally on 2026-08-02; no merge or push.

**Goal:** Build and execute a pinned, isolated Piper Prudence feasibility benchmark
while production P7 remains online and unchanged.

**Architecture:** A hash-validating controller launches a persistent JSON-lines Piper
worker, validates every WAV, converts through fixed FFmpeg settings, records process
and cgroup telemetry, and is supervised by a host-side production/safety monitor.
Private listening artifacts and model files remain outside Git.

**Tech Stack:** Python 3.10, Piper 1.6.0 Python API, ONNX Runtime CPU, FFmpeg/ffprobe,
Docker, pytest, JSON/JSON Lines.

---

### Task 1: Lock runtime and asset contracts

**Files:**
- Create: `piper-candidate/requirements-runtime.lock`
- Create: `piper-candidate/requirements-verify.lock`
- Create: `piper-candidate/bmo_piper/manifest.py`
- Test: `piper-candidate/tests/test_manifest.py`

- [x] Write tests proving exact asset hashes, speaker `prudence: 0`, four speakers,
  22,050 Hz, and rejection of missing, changed, or escaping files.
- [x] Run `pytest piper-candidate/tests/test_manifest.py -q` and observe failure because
  `manifest.py` does not exist.
- [x] Implement strict JSON manifest/config verification with no download path.
- [x] Rerun the focused test and require all cases to pass.

### Task 2: Implement synthesis and audio boundaries

**Files:**
- Create: `piper-candidate/bmo_piper/engine.py`
- Create: `piper-candidate/bmo_piper/audio.py`
- Create: `piper-candidate/bmo_piper/ffmpeg.py`
- Test: `piper-candidate/tests/test_engine.py`
- Test: `piper-candidate/tests/test_audio.py`
- Test: `piper-candidate/tests/test_ffmpeg.py`

- [x] Write failing tests for speaker selection, empty/malformed text, output escape,
  WAV validation/metrics, fixed MP3 command, timeout, failure, and cleanup.
- [x] Run the three focused modules and confirm failures are due to missing behavior.
- [x] Implement the minimal CPU Piper adapter, validators, metrics, and fixed FFmpeg
  converter with process-group timeout cleanup.
- [x] Rerun the focused modules and require all cases to pass.

### Task 3: Implement the persistent worker and benchmark

**Files:**
- Create: `piper-candidate/bmo_piper/worker.py`
- Create: `piper-candidate/bmo_piper/process.py`
- Create: `piper-candidate/bmo_piper/benchmark.py`
- Create: `piper-candidate/comparison-text.json`
- Test: `piper-candidate/tests/test_process.py`
- Test: `piper-candidate/tests/test_benchmark.py`

- [x] Write failing tests for load-once behavior, JSON protocol bounds, request
  timeout, child cleanup, cold/warm separation, stability counters, and summaries.
- [x] Run focused tests and observe the expected missing-module failures.
- [x] Implement the persistent process controller, request sampler, cold/warm/20-run
  orchestration, and machine-readable output.
- [x] Rerun focused tests and require all cases to pass.

### Task 4: Build the isolated image and host monitor

**Files:**
- Create: `piper-candidate/Dockerfile`
- Create: `piper-candidate/Dockerfile.dockerignore`
- Create: `piper-candidate/bmo_piper/host_monitor.py`
- Test: `piper-candidate/tests/test_packaging.py`
- Test: `piper-candidate/tests/test_host_monitor.py`

- [x] Write failing tests for digest pins, non-root/Tini runtime, no runtime download,
  no ports, restart policy input, thresholds, and production stop conditions.
- [x] Implement the multi-stage test/final image and fail-closed host monitor.
- [x] Build the test target, run the full candidate suite, then build and identify the
  final candidate image.

### Task 5: Provision, benchmark, compare, and bundle

**Files:**
- Create outside Git: `/opt/bmo/temp/p8-piper-feasibility/assets/PIPER_ASSET_MANIFEST.json`
- Create outside Git: `/opt/bmo/temp/p8-piper-feasibility/evidence/benchmark-results.json`
- Create outside Git: `/opt/bmo/temp/p8-piper-feasibility/listening/`

- [x] Verify/download each pinned asset once, write exact hashes/sizes/licenses, and
  prove subsequent inference works with `--network none`.
- [x] Record host baseline and run basic, cold, warm, continuous, 20-request,
  failure, and shutdown tests under the monitor.
- [x] Generate identical-text production Kokoro references only while idle, validate
  all audio, locate/validate legacy short RVC references, and assemble the private
  blind archive with a separate key and checksum file.
- [x] Remove the candidate and rerun the complete production gate.

### Task 6: Evidence, hygiene, and one local checkpoint

**Files:**
- Create: `docs/backend-mvp/P8-PIPER-FEASIBILITY-EVIDENCE.md`
- Modify if evidence requires it: `docs/roadmap/P8-EXECUTION-SPEC.md`
- Modify if evidence requires it: `docs/backend-mvp/CURRENT-RUNTIME-CONFIG.md`
- Modify if evidence requires it: `docs/hardware-handoff/CURRENT-STATUS.md`

- [x] Document measured evidence, license position, Kokoro/RVC limitations, 12 GB
  projection, archive identity, unresolved risks, and exactly one decision gate.
- [x] Run all candidate tests, compileall, pip checks, offline identity, ffprobe,
  documentation, secret/artifact/large-file, contract, PRD, diff, and scope gates.
- At checkpoint completion, stage the complete scoped change once and create the
  single operator-requested local commit
  `feat(p8): evaluate Piper Prudence voice feasibility`.
- At final handoff, verify the Piper and RVC worktrees are clean, unmerged, and
  unpushed; confirm production P7 is unchanged and no candidate remains.
