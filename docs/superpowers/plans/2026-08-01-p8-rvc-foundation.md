# P8 RVC Foundation Implementation Plan

> **Execution constraint:** Implement inline in this worktree only. Do not commit, push, merge, deploy, enable production RVC, or start P9/P10.

**Goal:** Build and verify a secure, immutable, CPU-only RVC foundation around the locked BMO model without changing the public hardware contract or the P7 production runtime.

**Architecture:** Keep the P7 Audio Service dependency lock intact and install RVC into a separate `/opt/rvc-venv` image environment. The Audio Service launches one fixed, pinned worker as a subprocess with explicit argv, a minimal environment, forced PyTorch weights-only loading, bounded output, a new process session, a 120-second timeout, and strict input/output/model path validation. Any RVC unavailability, failure, timeout, or invalid WAV returns to Kokoro-only before FFmpeg.

**Tech stack:** Python 3.10.20, FastAPI, PyTorch CPU, official RVC-Project `Retrieval-based-Voice-Conversion` at `7b284a634667c34103eaaeed972b48ccdb4b893e`, pinned Tps-F fairseq at `ff08af27e302625a27d3502b0791a9367c8af0c7`, FAISS CPU, RMVPE, HuBERT, SoundFile, FFmpeg/ffprobe, pytest, Docker.

---

### Task 1: Lock configuration and immutable RVC identity

**Files:**
- Modify: `audio-service/app/config.py`
- Modify: `.env.audio.example`
- Test: `audio-service/tests/test_config.py`

- [ ] Add failing tests for the exact engine command, 120-second timeout, model/index/HuBERT/RMVPE/manifest paths, CPU-only device, and supported `rmvpe` method.
- [ ] Run `pytest tests/test_config.py -q` and confirm the new assertions fail for missing fields/validation.
- [ ] Add typed settings with production-safe defaults (`RVC_ENABLED=false`) and bounded validators; reject unknown f0 methods, non-CPU devices, invalid timeout values, and unapproved command shapes.
- [ ] Update the example only with non-secret sentinel values and the fixed candidate command/path structure.
- [ ] Rerun the targeted tests and retain the production-disabled default.

### Task 2: Harden WAV and final MP3 validation

**Files:**
- Create: `audio-service/app/audio_validation.py`
- Modify: `audio-service/app/ffmpeg.py`
- Test: `audio-service/tests/test_audio_validation.py`
- Test: `audio-service/tests/test_ffmpeg.py`

- [ ] Add failing WAV tests for regular-file/approved-directory enforcement, empty/malformed audio, unsupported format/channels/rate, NaN/Inf, excessive amplitude, unreasonable input/output duration ratio, trailing/sibling output paths, and size bounds.
- [ ] Add failing MP3 tests for wrong codec/channels/rate/bitrate, zero duration, malformed ffprobe output, and a canonical mono 24 kHz 96 kbps result.
- [ ] Implement streaming SoundFile sample checks and ffprobe metadata validation without accepting existence alone.
- [ ] Make FFmpeg conversion validate its output before success and sanitize errors.
- [ ] Rerun targeted tests.

### Task 3: Harden the subprocess adapter and fallback

**Files:**
- Rewrite: `audio-service/app/rvc.py`
- Modify: `audio-service/app/tts.py`
- Test: `audio-service/tests/test_rvc.py`
- Test: `audio-service/tests/test_tts.py`
- Test: `audio-service/tests/test_tts_api.py`

- [ ] Add failing adapter tests for disabled/missing assets, optional absent index, configured invalid index, exact argv, spaces and shell metacharacters, non-zero exit, bounded stdout/stderr, sanitized errors, timeout, process-tree termination/reaping, missing/empty/malformed/non-finite/unreasonable output, success, and cleanup.
- [ ] Add failing orchestration/API tests proving invalid RVC output and timeout use Kokoro-only, `rvc_applied=false`, while valid output uses `rvc_applied=true`; retain current headers and health/readiness semantics.
- [ ] Implement fixed argv, canonical path checks, `Popen(start_new_session=True)`, bounded pipe drainers, minimal allowlisted environment with no internal token, timeout TERM/KILL escalation, wait/reap, and strict output validation.
- [ ] Ensure every RVC exception is caught before FFmpeg input selection and never log raw paths/stderr.
- [ ] Rerun targeted tests and a real child-process termination test.

### Task 4: Add the deterministic safe RVC worker

**Files:**
- Create: `audio-service/scripts/rvc_infer.py`
- Create: `audio-service/tests/test_rvc_infer.py`

- [ ] Add failing CLI-contract tests for required model/input/output/HuBERT/RMVPE arguments, optional index, CPU-only device, f0 key/method, and refusal to write outside the approved output parent.
- [ ] Add a test that monkeypatches `torch.load` and proves the process forces weights-only loading; allowlist only `fairseq.data.dictionary.Dictionary` for the pinned HuBERT checkpoint.
- [ ] Implement the worker by importing the pinned RVC `VC` library, setting explicit asset paths, performing one inference, writing one WAV, and returning deterministic exit codes without network/download helpers or Web UI/server code.
- [ ] Test the worker with fakes before real inference.

### Task 5: Harden immutable archive provisioning and candidate manifest

**Files:**
- Rewrite: `audio-service/scripts/bootstrap_rvc.py`
- Modify: `audio-service/app/model_assets.py`
- Test: `audio-service/tests/test_rvc_bootstrap.py`
- Test: `audio-service/tests/test_model_assets.py`

- [ ] Add failing tests for exact archive size/hash, wrong size/hash, absolute/traversal/null/backslash paths, Unix links/special files, duplicate normalized paths, encrypted entries, member/expanded-size limits, nested archives/scripts/unexpected types, missing `.pth`, optional `.index`, atomic/idempotent rerun, post-extraction hashes, and offline rerun.
- [ ] Implement pre-extraction validation of every member, streaming hashing/extraction into a sibling staging directory, no-follow/exclusive writes, exact artifact evidence, atomic publish, and verified idempotency.
- [ ] Define a separate RVC candidate manifest containing model, optional index, HuBERT, and RMVPE source/revision/path/size/hash/license/required state; do not alter the P7 seven-artifact fingerprint.
- [ ] Keep download disabled unless `--allow-download` is explicitly present.
- [ ] Rerun bootstrap/model tests against fixtures and the locked archive offline.

### Task 6: Pin RVC dependencies and build the candidate image

**Files:**
- Create: `audio-service/requirements-rvc.in`
- Create: `audio-service/requirements-rvc.lock`
- Modify: `audio-service/Dockerfile`
- Test: `audio-service/tests/test_rvc_packaging.py`

- [ ] Resolve a Python 3.10 Linux x86_64 CPU-only lock with full Git SHAs and hashes for index artifacts; retain `requirements-runtime.lock` unchanged.
- [ ] Add packaging tests proving the base digest/P7 lock are unchanged, the engine/fairseq SHAs are full pins, no CUDA wheel is present, and the candidate command exists.
- [ ] Build a separate RVC venv in the image, install the exact engine/fairseq commits and hashed dependencies, and copy only the fixed worker into the runtime image.
- [ ] Run both environment `pip check` commands and import/version checks.
- [ ] Build `bmo-audio:p8-rvc-foundation-candidate` without replacing any running image and record its image ID/digest/size/user/labels.

### Task 7: Full automated regression and offline startup

**Files:**
- Modify tests only where the new secure contracts require coverage.

- [ ] Run the full Audio Service pytest suite under Python 3.10.
- [ ] Run `compileall`, P7 and RVC `pip check`, offline-model tests, and existing Whisper/Kokoro/FFmpeg regressions.
- [ ] Start the candidate with `--network none`, no secrets, read-only root, cap-drop, no-new-privileges, non-root UID, read-only P7/RVC assets, and writable cache/temp only.
- [ ] Verify `/livez`, `/readyz`, `/health`, no model-file changes, no download attempts, and no public port binding.

### Task 8: Minimal real smoke and forced fallback

**Files:**
- Modify: `audio-service/scripts/verify_voice_pipeline.py`
- Retain outputs only under `/opt/bmo/temp/p8-rvc-foundation-candidate/listening/`.

- [ ] Generate `Hi! BMO is ready to help.` with the pinned Kokoro model, `af_heart`, speed `0.80`.
- [ ] Run real pinned RVC on CPU with f0 key `0`, method `rmvpe`, and the compatible locked index; validate the 40 kHz converted WAV.
- [ ] Convert via existing FFmpeg to mono 24 kHz target 96 kbps MP3 and validate with ffprobe.
- [ ] Record Kokoro/RVC/FFmpeg/total timings, preliminary peak memory, output sizes/durations/rates/channels/bitrate, and sanitized listening paths without quality approval.
- [ ] Force an RVC failure using the same Kokoro WAV; require valid fallback MP3, `rvc_applied=false`, cleanup, and no orphan process.

### Task 9: Evidence and final safety verification

**Files:**
- Create: `docs/backend-mvp/P8-FOUNDATION-EVIDENCE.md`

- [ ] Record the full required 30-field evidence report and classify only `FOUNDATION READY FOR REVIEW`, `FOUNDATION NEEDS FIXES`, or `FOUNDATION BLOCKED`.
- [ ] Run `python3 scripts/verify-backend-mvp-docs.py`, `git diff --check`, changed-scope/secret/large/generated scans, hardware-contract hash, and PRD hash.
- [ ] Repeat read-only production health, public 200/404/404, exact image/revision/restart/listener/RVC-disabled checks.
- [ ] Confirm primary `main` is clean and unchanged; report worktree status and that nothing was committed, merged, pushed, deployed, restarted, or enabled.
