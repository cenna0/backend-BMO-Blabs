# P8 RVC Quality Benchmark Execution Plan

> **Scope:** Prompt 2 of 4 only. All work stays uncommitted in
> `/opt/bmo/app/.worktrees/p8-rvc-foundation`; production remains untouched and
> `RVC_ENABLED=false`.

**Goal:** Produce bounded, reproducible evidence for RVC technical quality,
tuning, shutdown, reliability, latency, and resource safety, then stop with a
private listening bundle for operator review.

**Architecture:** Retain the approved one-shot, request-local RVC worker. Add
only validated official-engine tuning arguments, serialize CPU-heavy TTS/RVC
work, and give the container a PID-1 shutdown boundary that can terminate and
reap descendants even when a model-library thread is uninterruptible. Do not
introduce a persistent RVC worker or a new service topology in this prompt.

**Safety gates:** Before each heavy run, require production health/restart/OOM
baseline, at least 20 GiB free disk, and at least 512 MiB projected host
MemAvailable at peak. Use a candidate cgroup limit, one heavy run at a time,
and stop the isolated candidate if sampled MemAvailable falls below 512 MiB.
Any host-wide OOM or production restart blocks the checkpoint. A candidate-only
cgroup OOM is recorded as a failed resource scenario and is not retried with an
unsafe higher limit.

---

## Task 1: Freeze and audit the Prompt 1 foundation

**Files:**

- Review: all 28 existing modified/untracked files
- Review: `docs/backend-mvp/P8-FOUNDATION-EVIDENCE.md`

- [x] Reconfirm branch, worktree, base SHA, local/origin/remote main, and clean
  primary checkout.
- [x] Reconfirm production health, image digests, revision, RVC disabled state,
  loopback listeners, memory, disk, and Docker usage.
- [x] Re-hash the archive, model, index, HuBERT, RMVPE, and manifest.
- [x] Inventory candidate image, RVC virtual environment, build cache, candidate
  assets, evidence, worktree, and unrelated resources without cleanup.
- [x] Attempt the existing combined foundation verifier under its 2,700 MiB
  cgroup ceiling; record its candidate cgroup OOM instead of masking it.
- [ ] Complete focused adversarial foundation tests and document any deficiency.

## Task 2: Reproduce and diagnose shutdown boundaries

**Files:**

- Inspect: `audio-service/app/main.py`
- Inspect: `audio-service/app/tts.py`
- Inspect: `audio-service/app/rvc.py`
- Test: `audio-service/tests/test_shutdown.py`

- [ ] Write controlled failing tests for SIGTERM during idle, background thread
  loading, a separate-session descendant, active work, and cleanup.
- [ ] Reproduce the current direct-uvicorn shutdown delay with a secret-free
  synthetic loader before changing code.
- [ ] Prove the root cause: cancellation of `asyncio.to_thread` does not stop its
  executor thread, so the interpreter remains alive beyond Uvicorn shutdown.

## Task 3: Add a bounded PID-1 shutdown boundary

**Files:**

- Create: `audio-service/scripts/audio_service_entrypoint.py`
- Modify: `audio-service/Dockerfile`
- Test: `audio-service/tests/test_shutdown.py`

- [ ] Implement a minimal non-root supervisor that spawns Uvicorn, handles
  SIGTERM/SIGINT, stops accepting work by signalling Uvicorn, enumerates only
  descendants, signals descendant process groups, waits a configured grace
  period, escalates only remaining descendants, reaps them, and performs
  narrowly-scoped stale `bmo-tts-*` cleanup.
- [ ] Never signal unrelated processes, use shell execution, inherit a new
  executable from configuration, expose paths in logs, or weaken request-finally
  cleanup.
- [ ] Verify idle/load/warm-up/active/fallback shutdown within the documented
  bound, with no normal Docker SIGKILL and no orphan RVC/FFmpeg process.

## Task 4: Expose only supported tuning and serialize heavy work

**Files:**

- Modify: `audio-service/app/config.py`
- Modify: `audio-service/app/rvc.py`
- Modify: `audio-service/app/tts.py`
- Modify: `audio-service/scripts/rvc_infer.py`
- Modify: `.env.audio.example`
- Test: `audio-service/tests/test_config.py`
- Test: `audio-service/tests/test_rvc.py`
- Test: `audio-service/tests/test_rvc_worker.py`
- Test: `audio-service/tests/test_tts.py`

- [ ] Add failing validation tests for the exact official-engine parameters:
  `index_rate`, `protect`, `filter_radius`, `rms_mix_rate`, and
  `resample_sample_rate`, retaining CPU/RMVPE/f0-up-key constraints.
- [ ] Pass parameters as argv elements through the fixed worker boundary and
  reject invalid ranges/combinations.
- [ ] Add an in-process one-at-a-time synthesis gate and concurrent tests proving
  request-local paths, fallback, and cleanup cannot collide.
- [ ] Put Numba cache only in an approved service cache directory if persistence
  is justified; do not place it in model directories or Git.

## Task 5: Add automated audio guardrails and benchmark tooling

**Files:**

- Create: `audio-service/app/audio_metrics.py`
- Create: `audio-service/scripts/benchmark_rvc_quality.py`
- Test: `audio-service/tests/test_audio_metrics.py`
- Test: `audio-service/tests/test_rvc_quality_benchmark.py`

- [ ] Write failing fixtures/tests for clipping, silence, truncation, expansion,
  non-finite samples, DC offset, pathological energy, leading/trailing silence,
  and gross spectral discontinuity.
- [ ] Implement deterministic WAV/MP3 metrics and explicit technical-rejection
  reasons; label metrics as guardrails, never subjective approval.
- [ ] Define the seven canonical phrases and a bounded pilot sweep that changes
  one important dimension at a time.
- [ ] Produce stable, blind-friendly filenames, exact parameter metadata,
  SHA-256, duration, and metrics outside Git.

## Task 6: Rebuild and verify the candidate offline

**Files:**

- Modify if required: `audio-service/Dockerfile`
- Update: `docs/backend-mvp/P8-FOUNDATION-EVIDENCE.md`

- [ ] Run focused tests, full Audio Service pytest, compileall, both `pip check`
  environments, and dependency/engine identity checks.
- [ ] Build only a new `bmo-audio:p8-rvc-quality-candidate` image.
- [ ] Verify non-root, read-only-root compatibility, no ports, no secrets, no
  Docker socket, no CUDA packages, and immutable labels/locks/manifests.
- [ ] Verify offline startup, Kokoro-only output, fallback, and bounded shutdown.

## Task 7: Generate references and qualify standalone RVC host safety

**Files:** no Git output; use `/opt/bmo/temp/p8-rvc-benchmark/`.

- [ ] Generate all seven real Kokoro source WAVs and reference MP3s with the
  approved voice/language/speed in an offline, memory-limited container, then
  exit it before loading RVC.
- [ ] Run one standalone short RVC conversion under the established ceiling
  while sampling candidate/production cgroups, host MemAvailable, OOM events,
  processes, and temp files.
- [ ] If the standalone run crosses the 512 MiB floor, OOMs, or affects
  production, stop all remaining real RVC benchmark work and classify the
  checkpoint according to the prompt rather than increasing memory unsafely.

## Task 8: Run the bounded quality and tuning matrix

**Files:** no generated audio in Git.

- [ ] Pilot one-dimension changes on the short canonical phrase.
- [ ] Automatically reject technically invalid outputs.
- [ ] Select baseline plus at most three technically strongest/diverse candidates
  without claiming subjective superiority.
- [ ] Generate those configurations across all seven phrases, validate RVC WAV
  and final 24 kHz mono 96 kbps MP3, and construct the private listening bundle.

## Task 9: Run latency, reliability, and resource benchmarks

**Files:** evidence JSON/CSV/audio outside Git.

- [ ] Record initialization stages, Kokoro cold/warm, RVC cold/warm, full path,
  and fallback path for short/medium/long inputs without averaging away cold
  behavior.
- [ ] Where safe, run five warm sequential observations per length and a bounded
  20-request rotation; record wall/CPU/cgroup peak/retained memory, host
  MemAvailable, temp growth, output duration/RTF, processes, restarts, and OOMs.
- [ ] Execute the complete RVC failure matrix and verify request-level Kokoro
  fallback whenever Kokoro+FFmpeg remain healthy.
- [ ] Exercise overlapping requests and prove one-at-a-time heavy execution,
  request-local fallback, no late writes, and no collisions.
- [ ] Separate direct measurements, P7 reused data, conservative estimates, and
  unverified combined-residency assumptions.

## Task 10: Final verification and evidence

**Files:**

- Update: `docs/backend-mvp/P8-FOUNDATION-EVIDENCE.md`
- Create: `docs/backend-mvp/P8-QUALITY-BENCHMARK-EVIDENCE.md`

- [ ] Run full pytest, compileall, both `pip check`s, offline paths, shutdown,
  orphan/temp/log/download checks, documentation verifier, `git diff --check`,
  scope/secret/large/generated-artifact scans, hardware-contract hash, and PRD
  unchanged hash.
- [ ] Reconfirm final production health/restarts/OOM/images/revision/RVC state,
  Hermes, listeners, memory, disk, and kernel/Docker OOM delta.
- [ ] Record candidate identity, complete results and limitations, VPS
  classification, exact listening instructions, and exact Prompt 3 work.
- [ ] Stop uncommitted and report one exact Prompt 2 classification.
