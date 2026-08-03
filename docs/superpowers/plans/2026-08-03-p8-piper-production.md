# P8 Piper Production Integration Implementation Plan

> **For agentic workers:** Execute this plan task-by-task with review checkpoints. Each task must leave the worktree testable and must not alter the public hardware contract.

**Goal:** Deploy Piper `en_GB-semaine-medium`, speaker `prudence` / ID `0`, as the fixed Audio Service primary TTS while retaining Kokoro `af_heart` at `0.80` as automatic fallback.

**Architecture:** Extend the existing Audio Service with a private, persistent Piper worker subprocess. The Audio Service starts the worker once from a read-only pinned asset mount, exchanges bounded JSON-lines requests over pipes, validates the 22,050 Hz WAV, and sends it through the existing FFmpeg converter. Piper-specific failures are sanitized and fall back to the existing Kokoro synthesizer; neither engine changes Backend routes, WebSocket events, IDs, or hardware payloads.

**Tech Stack:** Python 3.10, FastAPI, Piper 1.6.0, ONNX Runtime CPU, Kokoro, FFmpeg/ffprobe, Docker Compose, pytest, TypeScript public acceptance harness.

---

### Task 1: Lock centralized production configuration and contracts

**Files:**
- Modify: `audio-service/app/config.py`
- Modify: `.env.audio.example`
- Test: `audio-service/tests/test_config.py`

- [ ] Add failing tests asserting `tts_primary_engine=piper`, the exact Piper model/revision/voice/speaker ID, the exact Piper manifest path, Kokoro fallback `af_heart`/`0.80`, offline loading, and `rvc_enabled=False`; assert unapproved engine, voice, speaker, model, and arbitrary path overrides are rejected.
- [ ] Run `pytest audio-service/tests/test_config.py -q`; expected failure because the Piper settings do not yet exist.
- [ ] Add literal-locked Pydantic settings with safe defaults and a single documented asset root. Keep existing Kokoro/RVC variable names stable and do not add request-level voice fields.
- [ ] Update `.env.audio.example` with sanitized names/defaults and comments documenting personal/noncommercial use, pinned revisions, and no runtime download.
- [ ] Run the focused configuration tests and require all to pass.

### Task 2: Add the persistent Piper worker boundary

**Files:**
- Create: `audio-service/app/piper/__init__.py`
- Create: `audio-service/app/piper/manifest.py`
- Create: `audio-service/app/piper/engine.py`
- Create: `audio-service/app/piper/worker.py`
- Create: `audio-service/app/piper/process.py`
- Create: `audio-service/app/piper/shutdown.py`
- Test: `audio-service/tests/test_piper_manifest.py`
- Test: `audio-service/tests/test_piper_worker.py`
- Test: `audio-service/tests/test_piper_process.py`

- [ ] Write failing tests for exact manifest/model/config/license hashes, `prudence: 0`, 22,050 Hz, offline loading, malformed requests, zero-byte output, invalid duration, output-path escape, worker crash, timeout, bounded termination, child reaping, and model-load count remaining one across warm requests.
- [ ] Run the three focused modules and confirm expected missing-module failures.
- [ ] Port the already-verified feasibility manifest, engine, shutdown, and JSON-lines process-boundary logic into the Audio Service package, replacing candidate-only paths with settings-derived read-only assets and request-local output paths. Never accept caller model paths or speaker IDs.
- [ ] Run focused Piper tests and require all to pass, including subprocess-free fakes for deterministic unit coverage.

### Task 3: Route Piper primary and Kokoro fallback through existing FFmpeg

**Files:**
- Modify: `audio-service/app/tts.py`
- Modify: `audio-service/app/main.py`
- Test: `audio-service/tests/test_tts.py`
- Test: `audio-service/tests/test_tts_api.py`
- Test: `audio-service/tests/test_health_and_auth.py`

- [ ] Add failing tests for Piper success metadata, every bounded Piper failure mode, Kokoro fallback success metadata, both engines failing with existing `TTS_FAILED`, Piper recovery, no RVC invocation, request-local cleanup, and unchanged response headers/body/status behavior.
- [ ] Run the focused TTS/API tests and confirm they fail for the missing primary route.
- [ ] Add a `PiperAdapter` protocol and `PiperSynthesizer` implementation backed by the persistent process. Extend the orchestrator to try Piper first, validate the WAV, convert through the existing converter, then use Kokoro only when Piper fails. Keep `use_rvc` ignored/disabled for production and keep `X-RVC-Applied=false`; record fallback metadata internally without adding public schema fields.
- [ ] Update health readiness to require STT, Piper, Kokoro fallback, and FFmpeg readiness while reporting the existing response shape. Ensure liveness remains independent and shutdown closes the Piper worker with bounded cleanup.
- [ ] Run focused TTS/API/health tests and require all to pass.

### Task 4: Pin dependencies, package assets, and enforce runtime controls

**Files:**
- Modify: `audio-service/requirements-runtime.lock`
- Modify: `audio-service/requirements.txt`
- Modify: `audio-service/Dockerfile`
- Modify: `audio-service/.dockerignore`
- Modify: `docker-compose.yml`
- Create: `audio-service/PIPER_ASSET_MANIFEST.json`
- Test: `audio-service/tests/test_offline_models.py`
- Test: `tests/packaging/test_p7_container_packaging.py`
- Test: `tests/packaging/test_piper_production_packaging.py`

- [ ] Add failing packaging/offline tests for the pinned Piper/ONNX dependencies, no runtime downloads, no model in Git image context, non-root execution, read-only asset mount, no-new-privileges, dropped capabilities, PID/CPU/memory/log bounds, and loopback-only port.
- [ ] Add exact locked Piper runtime requirements using the existing feasibility wheel hashes/provenance and copy the pinned asset manifest metadata into source without committing model bytes.
- [ ] Update the Audio image to install the pinned Piper runtime offline-compatible with the existing lock, copy only application code, run as `bmo`, and retain the existing healthcheck/entrypoint. Add Compose mounts for `/opt/bmo/models/piper` read-only and narrow writable temp/cache paths, plus explicit `pids_limit`, CPU, and memory controls sized for the observed host.
- [ ] Run packaging, offline, compileall, and dependency checks; expected result is no network access and no secret/model/audio artifact in the image context.

### Task 5: Build and validate the production candidate offline

**Files:**
- Create outside Git: `/opt/bmo/models/piper/`
- Create outside Git: `/opt/bmo/rollback/p8-piper-production/`
- Create: `ops/deploy/p8_piper_production.py`
- Test: `tests/operations/test_p8_piper_production.py`

- [ ] Write failing tests for asset provisioning/verification, read-only ownership/modes, exact rollback-state capture, sanitized evidence, host safety thresholds, and restoration verification.
- [ ] Provision the four approved Piper assets from the existing verified outside-Git source, verify every supplied hash plus the manifest hash, set root-owned read-only permissions, and record the asset fingerprint without secret values.
- [ ] Implement an operator-safe deployment/evidence helper that captures exact image/config/mount/security/resource identity, rejects warning/abort/emergency memory gates, and verifies the offline P7 rollback bundle. It must not delete broad paths or invoke runtime downloads.
- [ ] Build an immutable candidate image from the feature branch with source labels, then validate image identity, non-root behavior, no-network startup, exact asset hash, Piper readiness, Kokoro readiness, RVC disabled, and MP3 format in an isolated network/port.

### Task 6: Run pre-canary and production acceptance evidence

**Files:**
- Create: `docs/backend-mvp/P8-PRODUCTION-ROLLOUT-EVIDENCE.md`
- Modify: `docs/roadmap/P8-EXECUTION-SPEC.md`
- Modify: `docs/backend-mvp/CURRENT-RUNTIME-CONFIG.md`
- Modify: `docs/backend-mvp/04-AUDIO-SERVICE.md`
- Modify: `docs/backend-mvp/06-DEPLOYMENT-AND-OPERATIONS.md`
- Modify: `docs/hardware-handoff/DEPLOYMENT-CONFIG.md`
- Modify: `docs/hardware-handoff/CURRENT-STATUS.md`
- Modify: `docs/hardware-handoff/ACCEPTANCE-TESTS.md`
- Create outside Git: `/opt/bmo/temp/p8-piper-production/`

- [ ] Run the complete Audio/Backend tests, Piper/fallback/failure/shutdown/process-tree tests, compileall, pip checks, offline/no-download checks, ffprobe checks, documentation verifier, secret/artifact/model/audio/cache/large-file scans, Hardware Contract hash, and PRD consistency checks before touching production.
- [ ] Capture the exact P7 rollback bundle and validate restoration offline before the maintenance window.
- [ ] Stop only Audio, start the candidate with restart disabled and bounded resources, confirm Backend/Hermes/Caddy/public/loopback health, then run primary short/medium/long/30-second, forced fallback, recovery, full request, public fake-device, contract, 20 sequential, bounded queue/concurrency, failure, and shutdown tests.
- [ ] Record measured memory, latency, host reserve, process/file-descriptor/temp trends, restart/OOM counters, and all acceptance outcomes without secrets or transcripts.
- [ ] Run at least a 30-minute canary soak with periodic primary/fallback/health probes. Restore exact P7 immediately on any stop condition; otherwise retain the healthy candidate for final-image replacement.

### Task 7: Commit, merge, final-build, redeploy, push, and close P8

**Files:**
- Modify: all implementation/evidence files above as required by final measurements

- [ ] Run final repository hygiene and changed-scope checks; verify the feature branch is clean and the RVC branch remains unmerged.
- [ ] Commit the successful feature branch as `feat(p8): deploy Piper Prudence as primary TTS` and record the commit SHA and committed-file list.
- [ ] Merge normally into `main`, build the final Audio image from the merged main SHA, and verify source labels/digest/provenance match main.
- [ ] Replace the temporary candidate with the exact main-built image, run final smoke tests, and run the required 15-minute post-redeployment soak.
- [ ] Push `main` without force, verify local/remote/deployed SHA equality, final health/restart/OOM/listener/config state, P7 image availability, clean worktrees, and documentation classification `P8_PIPER_PRODUCTION_VERIFIED`.
