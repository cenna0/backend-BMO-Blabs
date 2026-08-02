# P8 RVC quality benchmark evidence

Status: **PROMPT 2 BLOCKED; PROMPT 3 CANARY REQUIRES A LARGER HOST**

Date: 2026-08-02

Branch: `feat/p8-rvc-foundation`

Worktree: `/opt/bmo/app/.worktrees/p8-rvc-foundation`

Base SHA: `cfbd718f3206ccdc1ea8157b2dc177f235d8181f`

Prompt 3 checkpoint `HEAD`: `d7c207cef2c68c05a8799a6cd87d6d2fb906934b`

Foundation evidence: `docs/backend-mvp/P8-FOUNDATION-EVIDENCE.md`

This is candidate-only Prompt 2 evidence. It does not approve voice quality, production
deployment, production RVC enablement, or P8 verification.

## Outcome and stop condition

The quality benchmark stopped at the user-defined host-safety boundary. A fresh
CPU-only RVC pilot with `index_rate=0.50` reached the candidate's 2,500 MiB cgroup
limit, exited 137 with `OOMKilled=true`, and drove host `MemAvailable` down to
582,754,304 bytes. A preceding combined foundation verifier under a 2,700 MiB limit
also generated a candidate-only cgroup OOM and reduced host available memory to
approximately 385 MiB. Production did not restart or become unhealthy.

The declared 512 MiB minimum host reserve made raising the candidate limit unsafe.
The remaining tuning grid, five-run warm short/medium/long benchmark, 20-request
stability test, active real-inference shutdown tests, and full combined residency
test were therefore not run. Continuing them while production remains online would
require an unauthorized maintenance window or a larger host.

Final Prompt 2 classification: `P8_BENCHMARK_BLOCKED`.

## Foundation diff review and Prompt 2 changes

The complete foundation diff and adversarial tests were reviewed before extension.
The fixed RVC worker entry point, argv-only subprocess boundary, restricted child
environment, timeout/process-group termination, bounded output capture, sanitized
errors, request-local canonical paths, manifest validation, WAV validation, cleanup,
and Kokoro fallback remain intact. Ninety-eight focused foundation/adversarial tests
passed during this review.

Prompt 2 added or changed:

- `audio-service/app/audio_metrics.py`: objective audio metrics and rejection
  guardrails.
- `audio-service/app/config.py`, `app/rvc.py`, and `scripts/rvc_infer.py`: validated
  index-rate, protect, RMS-mix, and CPU-thread settings passed through the fixed
  worker boundary.
- `audio-service/app/tts.py`: one-process TTS serialization around the complete
  request-local synthesis path.
- `audio-service/scripts/audio_service_entrypoint.py` and the Docker command: a
  fixed-command PID 1 supervisor with subreaping, bounded termination, descendant
  cleanup, and narrowly scoped request-temp cleanup.
- `audio-service/scripts/benchmark_rvc_quality.py`: deterministic seven-phrase
  reference/candidate evidence harness.
- `.env.audio.example` and focused configuration, RVC, TTS, audio-metric, benchmark,
  and shutdown tests.
- `docs/superpowers/plans/2026-08-02-p8-rvc-quality-benchmark.md` and this evidence.

No public route, event, error code, authentication behavior, request identifier, or
MP3 delivery behavior changed.

## Shutdown investigation

### Root cause

The Prompt 1 container directly ran Uvicorn as PID 1. Cancelling an
`asyncio.to_thread` warm-up did not stop its model-loading thread; the interpreter
continued waiting for that thread. During the observed ten-second Docker stop grace
period, this left shutdown dependent on SIGKILL even though `OOMKilled=false`.

### Hardening and results

The new supervisor:

- starts only the fixed Audio Service command;
- becomes a Linux child subreaper where supported;
- forwards SIGTERM/SIGINT to the service process group;
- discovers and signals escaped descendants;
- waits a bounded eight-second grace period, escalates if necessary, and reaps;
- removes only `bmo-tts-*` request directories.

Automated shutdown coverage passed for cooperative exit and an uninterruptible child
with a detached descendant. Real container observations were:

| Boundary | Stop time | Exit | OOM killed | Result |
|---|---:|---:|---|---|
| Immediate detach before Python installed handlers | 12.41 s | 137 | false | Known micro-startup race; rejected as steady-state evidence |
| Supervisor child observable | 0.25 s | 0 | false | Pass |
| Early background warm-up | 0.36 s | 0 | false | Pass |
| Active warm-up at about 1.533 GiB | 0.76 s | 0 | false | Pass |
| Real active Kokoro/RVC inference | Not run | — | — | Blocked by host-safety stop |

The normal supervised startup/warm-up boundary is bounded without SIGKILL. The
micro-startup race and real active-inference shutdown remain unresolved production
candidacy evidence.

## Parameter capability audit

The pinned engine supports the following relevant conversion parameters:

| Parameter | Supported boundary | Candidate decision |
|---|---|---|
| `f0_up_key` | Integer semitones, validated `-24..24` | Exposed; baseline `0` |
| `f0_method` | Engine supports multiple methods | Boundary remains locked to `rmvpe` |
| Index path | Optional | Exact manifest-validated index when configured |
| `index_rate` | Float `0..1` | Exposed; baseline `0.75` |
| `protect` | Float `0..0.5` | Exposed; baseline `0.33` |
| `rms_mix_rate` | Float `0..1` | Exposed; baseline `0.25` |
| `filter_radius` | Engine argument; material to Harvest median filtering | Fixed at `3`; not exposed for RMVPE tuning |
| Resample rate | `0` or a supported output rate | Fixed at `0`; RVC stays at model rate and FFmpeg owns 24 kHz MP3 conversion |
| CPU threads | Positive integer | Exposed `1..4`; safety pilots forced `1` |

The worker remains CPU-only. No arbitrary engine method, device, executable, or
unsupported tuning flag was exposed.

## Quality matrix and tested configurations

Kokoro references used language `a`, voice `af_heart`, and speed `0.80`. Seven real
references were generated for the required ready, reassuring, excited, calm,
numbers/names/punctuation, and long-response phrases.

Only the first phrase reached real RVC tuning before the safety stop:

| Label | `f0_up_key` | method | index rate | protect | RMS mix | threads | Result |
|---|---:|---|---:|---:|---:|---:|---|
| Qualification baseline | 0 | RMVPE | 0.75 | 0.33 | 0.25 | engine baseline | Valid WAV/MP3 |
| `pilot-baseline` | 0 | RMVPE | 0.75 | 0.33 | 0.25 | 1 | Accepted by technical guardrails |
| `pilot-index-none` | 0 | RMVPE | 0.00 | 0.33 | 0.25 | 1 | Accepted by technical guardrails |
| `pilot-index-low` | 0 | RMVPE | 0.50 | 0.33 | 0.25 | 1 | Rejected: candidate cgroup OOM, no audio |
| Index 1.00, protect 0.50, RMS mix 0.50, pitch -2/+2 | — | — | — | — | — | — | Not run after stop condition |

No strongest voice candidate was selected. File size, latency, and automatic metrics
were not used as substitutes for listening.

## Automated audio guardrails

The metrics implementation measures parseability, duration, rate, channel count,
finite samples, peak, RMS, DC offset, clipping ratio, frame silence ratio,
leading/trailing silence, and p95 spectral flux. MP3 validation additionally requires
MP3 codec, mono, 24 kHz, target-compatible 96 kbps, and positive duration.

For the only completed real tuning phrase:

| Candidate | WAV duration | Duration ratio | Peak | RMS | DC offset | Clip ratio | Silence | Leading / trailing | Spectral flux p95 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Baseline/index 0.75 | 2.800 s | 0.9912 | 0.3734 | 0.05208 | 0.0000615 | 0 | 0.4000 | 0.34 / 0.52 s | 0.00955 |
| No retrieval/index 0.00 | 2.800 s | 0.9912 | 0.4183 | 0.05020 | 0.0000565 | 0 | 0.3786 | 0.34 / 0.52 s | 0.01009 |

Both completed RVC WAVs were finite, parseable, unclipped, non-truncated, and
non-pathological. Their MP3s were mono, 24 kHz, 96 kbps, and 2.856 seconds. This is
only a technical guardrail pass for one phrase; it is not intelligibility, similarity,
or quality approval.

## Listening artifacts

The intended full blind-friendly listening bundle was not completed and must not be
used for approval. The following private, outside-Git diagnostic artifacts were
retained:

- Kokoro references:
  `/opt/bmo/temp/p8-rvc-benchmark/listening/reference-kokoro/`
- Baseline diagnostic:
  `/opt/bmo/temp/p8-rvc-benchmark/listening/pilot-baseline/`
- No-retrieval diagnostic:
  `/opt/bmo/temp/p8-rvc-benchmark/listening/pilot-index-none/`
- Forced fallback:
  `/opt/bmo/temp/p8-rvc-benchmark/fallback/forced-fallback.mp3`

Important hashes:

| Artifact | SHA-256 |
|---|---|
| Reference manifest | `a82fcf7bddc848a70ff8d9e61f3f62006d1609200dbe3415f57d69078d194175` |
| Baseline WAV | `7d305d17469832cb53b2da971901777b3dacf79f223bcb0173b3c4c90debbdf6` |
| Baseline MP3 | `5efb29fc626a12e636621675c8a8b7a4baf3672c558d8d0c88dd9e65fe745244` |
| Baseline record | `a94c04d7a41f8b6123c154d1e7be1a5e47842041f1de00cffd88944769cbbb1e` |
| No-retrieval WAV | `c0ebbf69e2d79fd114af1c2812ba35962c2d97d16495d84ea7105d73222f2252` |
| No-retrieval MP3 | `356fcda426a4021e2ed7bbb7bcea26baed9023049f79c19bdc884702af0836ef` |
| No-retrieval record | `32218536515b644a3f6b13cc6e3ab9e355dec669219790b5c4f4bd62f5d97c89` |
| Forced fallback MP3 | `413b119b60c8475eaf08a9ac1ea0c8c7b534179fd5bb3000a32f626f320df088` |

The reference manifest records every reference WAV/MP3 hash, phrase, duration, and
technical metric.

## Timing evidence

### Kokoro references

| Phrase | Kokoro | FFmpeg | Source duration |
|---|---:|---:|---:|
| Short ready (cold) | 24.326 s | 0.359 s | 2.825 s |
| Reassuring | 2.780 s | 0.390 s | 3.800 s |
| Short excited | 2.134 s | 0.370 s | 2.975 s |
| Calm medium | 3.958 s | 0.290 s | 6.050 s |
| Excited medium | 5.208 s | 0.303 s | 6.950 s |
| Numbers/names | 5.773 s | 0.320 s | 8.475 s |
| Long expected response | 10.980 s | 0.490 s | 13.250 s |

The seven-reference container took 62.665 seconds total. Its sampled peak memory was
about 1,943,273,472 bytes.

### RVC-only pilots

| Run | Wall | CPU | Sampled candidate peak | Minimum host available | Result |
|---|---:|---:|---:|---:|---|
| Standalone qualification | 51.748 s | not isolated | 2,621,415,424 B | 713,404,416 B | Pass |
| Baseline/index 0.75 | 39.974 s | 38.159 s | 2,511,093,760 B | 809,975,808 B | Pass |
| Index 0.00 | 38.949 s | 37.647 s | 2,604,617,728 B | 853,336,064 B | Pass |
| Index 0.50 | 36.066 s | 35.800 s | 2,621,222,912 B | 582,754,304 B | OOM killed |

Foundation technical smoke had recorded Kokoro 25.955 seconds, RVC 33.939 seconds,
FFmpeg 0.439 seconds, and sequential total 60.333 seconds. These and the Prompt 2
pilots must not be described as stable warm medians: the required five warm runs for
short, medium, and long phrases were not safe to perform. Cold initialization
components for HuBERT, RMVPE, checkpoint, and index were likewise not separately
instrumented after the stop.

## Memory, CPU, and combined residency

Directly measured evidence:

- Production Audio Service baseline: approximately 3.626 GiB.
- Real Kokoro reference process peak: approximately 1.943 GB.
- Standalone real RVC: approximately 2.51-2.62 GB, with one 2,500 MiB cgroup OOM.
- Foundation combined verifier: candidate OOM at a 2,700 MiB limit after sequential
  Kokoro and RVC work, demonstrating retained/shared-process pressure.
- Host has approximately 7.8 GiB RAM and no swap.

Direct safe measurement of Whisper medium + Kokoro + HuBERT + RMVPE + BMO checkpoint
+ index in one candidate process was not possible while the production 3.626 GiB
Audio Service remained online. Adding isolated peaks is not a valid substitute because
allocator retention, model sharing, and request peaks are unknown.

Current VPS suitability: **CURRENT VPS MARGINAL — CONTROLLED CANARY REQUIRED**.

This does not mean the current VPS is approved. It means the present evidence shows
unsafe benchmark headroom and cannot distinguish a tightly serialized viable process
from an OOM-prone one without a controlled maintenance/canary window or a larger host.
No production resource limit can yet be defensibly set.

## Reliability, failures, and cleanup

Automated coverage passed for disabled/missing/wrong-hash assets, optional/missing or
invalid index behavior, non-zero/crashed/hung worker, timeout and process-group kill,
bounded stderr, sanitized errors, missing/zero/malformed/non-finite/duration-invalid
WAV, output-path violations, FFmpeg failure semantics, cleanup, repeated fallback,
and recovery after failure. Read-only and no-download candidate behavior are also
covered by startup/foundation verification.

The final image received a forced worker non-zero exit under `--network none`,
read-only root, 768 MiB memory, and one CPU. It returned:

- `engine=kokoro`;
- `rvc_applied=false`;
- request-level success;
- 34,893-byte valid MP3, mono, 24 kHz, 96 kbps, 2.880 seconds;
- no remaining request-temp entries.

FFmpeg failure after a valid RVC output retains the existing `TTS_FAILED` behavior;
no public error was added. Process-group/orphan behavior is covered synthetically,
and completed real runs left no candidate container or request temp file. The full
real failure matrix, real active-inference SIGTERM, and 20-request leak/stability
sequence remain unperformed due to the safety stop.

## Serialization and concurrency

The Audio Service now serializes the whole Kokoro -> optional RVC -> FFmpeg operation
within one process. Unique `mkdtemp(prefix="bmo-tts-")` request directories keep input,
RVC output, fallback, and timeout cleanup request-local. This prevents overlapping
CPU-heavy RVC conversion and late-worker path collision without changing backend
duplicate-request behavior or any public contract. Automated concurrency tests verify
one-at-a-time synthesis and request-local cleanup. No multi-RVC load was run.

## Offline and immutable candidate

Final candidate:

- Tag: `bmo-audio:p8-rvc-quality-candidate`
- Image ID / local content identity:
  `sha256:cfb1a3518c05612137712700adc1e657d92322bc3adb319f93659abd866a791e`
- Local RepoDigest:
  `bmo-audio@sha256:cfb1a3518c05612137712700adc1e657d92322bc3adb319f93659abd866a791e`
- Compressed/containerd image size: 1,213,939,195 bytes
- Docker virtual size: approximately 5.22 GB
- Runtime user: `bmo`
- Command: `python scripts/audio_service_entrypoint.py`
- Base revision label: `cfbd718f3206ccdc1ea8157b2dc177f235d8181f`
- RVC engine label: `7b284a634667c34103eaaeed972b48ccdb4b893e`
- Runtime lock SHA-256:
  `55cc9380cfdd381ad814f88a6cad098b157ef6e4a326d6b1af3cc81e9bd5357a`
- RVC lock SHA-256:
  `f4bbf40a507745130bdfb6d43f5ddd24a1ac1f6f01fc84619a2990a8b0ab4a84`
- RVC build lock SHA-256:
  `4803390ba99cc6fe568939d2e168e1501ba90133acbb302d040aa149c5996e03`
- Pinned engine-source lock SHA-256:
  `bdc0522a28cf5a8fe9c848eafbc5815b87aabbf5b672d473ce67b917c47fc1fa`
- Candidate model manifest SHA-256:
  `3b72958a73ee39d9f428298c1b91c4aca532c94825f9170f162246eec69673ce`

Offline foundation startup and real Kokoro/RVC/FFmpeg inference were previously proven.
Prompt 2 forced fallback also passed offline. Runtime download attempts remain disabled;
there is no runtime Git fetch, DNS lookup, auto-update, or mutable asset resolution.

## Disk inventory

Final free disk was approximately 45.906 GB, above the 20 GiB stop threshold. No
cleanup was performed.

| Item | Approximate usage | Classification |
|---|---:|---|
| Final quality image | 5.22 GB virtual; 205.8 kB unique over shared foundation layers | Required for Prompt 2 evidence |
| Foundation image | 5.22 GB virtual; 168.9 kB unique over shared layers | Safe cleanup candidate after approval |
| Docker build cache | 27.38 GB; about 5.36 GB reported reclaimable | Safe cleanup candidate after approval |
| Candidate archive/models/support/runtime tree | 1,021,920,838 bytes | Required for Prompt 2/Prompt 3 |
| RVC virtual environment in image | approximately 1.592 GB | Required candidate dependency |
| Prompt 2 benchmark/listening artifacts | 4,375,132 bytes | Required evidence; outside Git |
| Worktree | 1,731,773 bytes at inventory time | Required review state |
| Running P7 production images | backend/audio approved digests | Production dependency; do not touch |
| Older P7 images and unrelated Docker resources | included in Docker inventory | Unknown/do not touch without operator review |

## Tests and repository checks

Completed before the host-safety stop:

- Foundation adversarial subset: 98 passed.
- Prompt 2 tuning/configuration focus: 80 passed after the test-first changes.
- Audio metrics: 12 passed.
- Supervisor shutdown: 4 passed.
- Benchmark harness: 2 passed.
- Final Audio Service full suite in the offline candidate environment: 202 passed
  with one expected duplicate-ZIP-name warning from an adversarial bootstrap test.
- Candidate `compileall`: passed using a writable tmpfs bytecode cache.
- P7 and RVC environment `pip check`: passed.
- RVC environment confirmed CPU-only PyTorch 2.11 with no CUDA.
- Final candidate Docker build: passed.

Final repository verification also passed:

- `python3 scripts/verify-backend-mvp-docs.py`;
- `git diff --check`;
- Hardware Contract SHA-256
  `633e398a7fa39a3ebc469af7f9ca46fd04890339bb132ec7de2c2286207c6a44`;
- PRD unchanged, with SHA-256
  `85022140f9825cb9256b7b29ce49b8407cc854108dbf720b4377581304b7e53f`;
- high-confidence secret scan, large changed-file scan, and generated
  model/audio/archive scan.

No test was weakened to obtain a pass.

## Operator listening instructions

Do **not** make an approval decision from the incomplete diagnostic directories. They
cover only one RVC phrase and do not include a stable warm/resource run across the
seven-phrase matrix.

Prompt 3 must first provide a controlled maintenance/canary window or a larger host,
rerun the bounded matrix, and generate complete `candidate-baseline` and up to three
blind labels with a top-level manifest and listening guide. The operator should then:

1. Use headphones at a fixed comfortable volume.
2. Compare each blind RVC candidate with the matching Kokoro reference for all seven
   phrases, without consulting parameter labels first.
3. Record intelligibility, clipping/clicks, robotic instability, pitch consistency,
   lost consonants, timing, emotional stability, and preference per phrase.
4. Reject any candidate with severe artifacts on any canonical phrase.
5. Reveal parameters only after ratings are recorded.

Automated metrics remain rejection guardrails, not subjective approval.

## Exact remaining work for Prompt 3

1. Obtain an authorized controlled maintenance/canary window that may stop the
   production Audio Service, or use a larger isolated host with comparable software.
2. Measure direct combined Whisper medium + Kokoro + RVC idle, request peak, retained
   memory, and shutdown behavior without duplicate production residency.
3. Resolve the micro-startup signal race and run SIGTERM during real Kokoro loading,
   real RVC initialization, and active inference.
4. Complete the bounded index/protect/RMS/pitch sweep across all seven phrases.
5. Run one cold and at least five warm sequential short/medium/long conversions,
   preserving first-run latency separately.
6. Run the 20-request serialized stability/leak sequence and the remaining real
   timeout/failure matrix.
7. Establish a safe cgroup limit and minimum host reserve, or classify the current VPS
   insufficient and size a larger host.
8. Build the complete private blind listening bundle and obtain explicit operator
   approval or rejection.
9. Rebuild/reverify the candidate if any shutdown/resource change is needed. Do not
   deploy or enable production RVC without later explicit authorization.

## Production unchanged

All heavy work used isolated, non-public candidate containers with explicit cgroup
limits and no production secrets. No production service, image, model directory,
environment file, Caddy/UFW rule, Hermes component, or public interface was modified.
Production remained RVC-disabled throughout. Nothing was committed, merged, pushed,
deployed, or enabled.

Initial and final read-only sanity both found public `/health=200`, `/livez=404`, and
`/readyz=404`; Hermes `/health=200`; backend/audio healthy with `RestartCount=0` and
`OOMKilled=false`; the approved running image IDs and revision
`4d7b472adc4c2243d8f7364032a491ad70efb6d3` unchanged; and ports 3000, 8001, and
8642 bound only to `127.0.0.1`. Final production Audio memory was 3.554 GiB, host
`MemAvailable` was 3,199,086,592 bytes, swap remained zero, and free disk was
45,904,248,832 bytes. The kernel `oom_kill` counter was five: its only Prompt 2
increment was correlated to the isolated candidate cgroup failure, not either
production container.

## Prompt 3 replacement-canary amendment

Prompt 3 did not repeat the Prompt 2 simultaneous-residency mistake. It stopped only
P7 Audio, ran the rebuilt candidate as the loopback replacement, and continuously
monitored the host and candidate. Fully loaded candidate idle memory averaged
2,210,562,726 bytes. A real 16 kHz WAV completed Whisper transcription in 31.590409
seconds. The following valid Hermes-boundary response then entered the baseline
Kokoro/RVC path.

During that request, candidate memory grew to the 5,368,709,120-byte cgroup limit and
the request-local RVC worker remained active. At 2026-08-02 16:20:33 CEST Docker
recorded `OOMKilled=true`; the kernel `oom_kill` counter changed from 5 to 6. The
monitor invoked the mandatory abort before host memory crossed any configured host
threshold. No result MP3 was returned.

All remaining quality, warm, stability, failure, shutdown, parameter, and listening
work stopped. No candidate was retained and no listening archive was produced. The
exact outcome, rollback proof, and current-VPS decision are in
`docs/backend-mvp/P8-CANARY-EVIDENCE.md`.
