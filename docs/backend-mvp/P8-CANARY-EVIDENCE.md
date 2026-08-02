# P8 controlled RVC canary evidence

Status: **CANARY STOPPED AT MANDATORY OOM ABORT; P7 RESTORED**

Final classification: `P8_CANARY_NEEDS_LARGER_HOST`

Date: 2026-08-02

This evidence covers Prompt 3 only. It does not mark P8 verified, approve subjective
voice quality, enable production RVC, or authorize deployment.

## 1. Repository and checkpoint

- Branch: `feat/p8-rvc-foundation`
- Worktree: `/opt/bmo/app/.worktrees/p8-rvc-foundation`
- Original base/main SHA: `cfbd718f3206ccdc1ea8157b2dc177f235d8181f`
- Local checkpoint: `d7c207cef2c68c05a8799a6cd87d6d2fb906934b`
- Checkpoint message: `feat(p8): establish isolated RVC foundation and benchmark harness`
- Post-checkpoint source changes retained uncommitted at the end of Prompt 3:
  - `audio-service/Dockerfile`
  - `audio-service/tests/test_shutdown.py`
- Post-checkpoint source-diff SHA-256 used in the image label:
  `1a4f517c1c170b13a6106cdf85191152b77a883cf8c75d309fab6a51e2a50836`
- Nothing was merged or pushed. Local main, `origin/main`, and live remote main
  remained `cfbd718f3206ccdc1ea8157b2dc177f235d8181f`; the primary worktree remained
  clean.

The complete pre-checkpoint Audio Service suite passed with 202 tests. After the
startup-signal change, the rebuilt image passed 209 tests with one expected
duplicate-ZIP-name warning. Both dependency environments passed `pip check`,
`compileall` passed, and no test was weakened.

## 2. Startup-signal race and candidate identity

The old Python PID 1 image reproduced the immediate-detach race five times, taking
approximately 2.14–2.20 seconds under a two-second stop timeout and exiting 137 with
`OOMKilled=false`. The cause was the interval before Python installed its handlers,
during which PID 1 default termination behavior could lose SIGTERM.

The rebuilt image installs Debian Tini `0.19.0-1+b3` and uses:

```text
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["python", "scripts/audio_service_entrypoint.py"]
```

Six immediate-start stops completed in 125–190 ms without SIGKILL. An offline
liveness-started stop completed in 424 ms with exit 0, and the maintenance canary's
real warm-up stop completed in 837 ms with exit 0 and `OOMKilled=false`.

Final canary image:

| Field | Value |
|---|---|
| Tag | `bmo-audio:p8-rvc-canary-candidate` |
| Image ID / local RepoDigest | `sha256:cba12d6626dcdd93814a75e0ebb856898d2c4b15ec6c2c11bbba60c4cd9c49e6` |
| Compressed/containerd size | 1,214,272,551 bytes |
| Runtime user | `bmo` |
| Source label | `d7c207cef2c68c05a8799a6cd87d6d2fb906934b+p8canary.1a4f517c1c17` |
| Engine label | `7b284a634667c34103eaaeed972b48ccdb4b893e` |
| Candidate manifest SHA-256 | `3b72958a73ee39d9f428298c1b91c4aca532c94825f9170f162246eec69673ce` |

The model, index, HuBERT, RMVPE, engine revision, and manifest were verified again
inside the running canary. The image and both dependency environments were validated
offline before maintenance. Runtime downloads were disabled with
`MODEL_DOWNLOAD_ALLOWED=false`, `HF_HUB_OFFLINE=1`, and
`TRANSFORMERS_OFFLINE=1`. The first internal-only Docker network configuration was
rejected because Docker did not publish its host port; it was stopped cleanly and
removed. The replacement used the normal Docker bridge so Backend could reach the
loopback-published port. No runtime download was observed, but complete network-level
egress denial was therefore not proven during the replacement run.

## 3. Production baseline and rollback anchor

Immediately before maintenance:

| Measurement | Value |
|---|---:|
| Host RAM | 8,326,950,912 bytes |
| Swap | 0 bytes |
| Host MemAvailable | 3,219,181,568 bytes |
| Backend cgroup memory.current | 104,779,776 bytes |
| P7 Audio cgroup memory.current | 3,818,692,608 bytes |
| Hermes systemd MemoryCurrent | 186,191,872 bytes |
| Other used-memory estimate | 1,184,296,960 bytes |
| Host process count | 155 |
| Load average | 0.13 / 0.28 / 0.48 |
| Root free disk | 36,999,389,184 bytes |
| Kernel `oom_kill` | 5 |

There were zero established connections involving ports 3000, 8001, or 8642, zero
pending Backend audio files, and zero pending input WAVs. Hardware test mode was
false. Backend, Audio, Hermes, Caddy, and the public endpoint passed their gates.

Protected rollback root:
`/opt/bmo/temp/p8-rvc-canary/rollback/`

The bundle contains protected copies of the active Audio env and Compose file, a
sanitized container configuration, path metadata, exact model artifact checksums,
and `restore_p7_audio.sh`. Its dry validation checked syntax, exact local images,
Compose rendering, configuration checksums, and all offline inputs without stopping
production.

Rollback anchors:

| Anchor | Value |
|---|---|
| P7 Audio image | `sha256:62d8b48feb978e303831e20dc558cb95d3240af9a3cf09e8dcd0c82142986e7e` |
| Backend image | `sha256:e981751498fca13bf1f1c1c046a6874a490b3e681aeef9787a53181059506fd7` |
| Deployment revision | `4d7b472adc4c2243d8f7364032a491ad70efb6d3` |
| `/opt/bmo/config/audio.env` SHA-256 | `3ced8033d38533d473abdbe53cacb6c3cf3ea58fb40fb2368a50abcc0b3af15c` |
| Compose SHA-256 | `3040cf3ea479536cbae0cfd7a0d35d11ab9bed7df69ba285e6496cf6354b855c` |
| P7 manifest SHA-256 | `ce691ab126e78bf87533032aa0b7953280ba69ef21670f7ac7b34b30384e85ef` |
| Approved seven-artifact fingerprint | `d2761b191eed48e85128e774aa7057153d8e8994e2e4f40c07ffb05731ae7e9f` |

Rollback required no network download.

## 4. Maintenance and canary configuration

- Maintenance start: `2026-08-02T16:11:30.801379777+02:00`
- Maintenance end: `2026-08-02T16:21:47.287506996+02:00`
- Duration: 617 seconds
- P7 Audio alone was stopped. Backend, Hermes, and Caddy remained running.
- Canary name: `bmo-p8-rvc-canary`
- Restart policy: `no`
- Publish: `127.0.0.1:8001:8001`
- Memory / memory+swap limit: 5,368,709,120 / 5,368,709,120 bytes
- CPU / PID limit: 4 CPUs / 512 PIDs
- Root filesystem: read-only
- User: `bmo`
- Capabilities: all dropped
- Security: `no-new-privileges:true`
- Writable mounts: canary-only cache and TTS request-temp directories
- Read-only mounts: exact P7 model root and exact RVC candidate root
- Logs: `json-file`, 10 MiB x 3
- RVC: enabled only in the canary; CPU/RMVPE, pitch 0, index 0.75, protect 0.33,
  RMS mix 0.25, four worker threads, 180-second timeout

Candidate `/livez` and `/readyz` returned 200; readiness reported Whisper, Kokoro,
RVC, and FFmpeg available. Backend aggregate health recovered to 200 and reported RVC
available. The canary never had automatic restart enabled.

## 5. Direct replacement memory evidence

The monitor sampled candidate cgroup memory, host memory, load, health, restart/OOM
state, process count, descriptor count, temp count, free disk, and kernel OOM state.
Raw evidence is outside Git at
`/opt/bmo/temp/p8-rvc-canary/evidence/canary-monitor.tsv`.

| Stage | Candidate memory.current | Candidate memory.peak | Host MemAvailable | Notes |
|---|---:|---:|---:|---|
| Offline pre-canary liveness | 199,430,144 | 208,760,832 | 3,041,816,576 | Models not loaded |
| Real warm-up on rejected internal network | 3,042,406,400 | 3,348,385,792 | 5,410,557,952 | Stopped cleanly |
| Fully loaded replacement idle | 2,093,412,352–2,418,614,272 | 2,453,221,376 | about 4.93 GiB | Mean 2,210,562,726 bytes |
| Before first STT inference | 2,096,558,080 | 2,518,528,000 | 4,935,729,152 | Models already ready |
| STT maximum sampled | 2,503,409,664 | 2,504,396,800 | 4,493,000,704 minimum | Valid transcript returned |
| Before full TTS request | 2,510,274,560 | 2,518,528,000 | 4,548,706,304 | Request-local temp count became 1 |
| Kokoro growth / RVC worker spawn | 3,037,081,600 | 3,037,081,600 | 4,106,387,456 | Process count rose from 3 to 4 |
| RVC model loading/inference | 3,138,203,648 to 5,368,709,120 | 5,368,709,120 | 4,058,001,408 to 1,730,326,528 | No output returned |
| OOM sample | 3,037,761,536 after kill | 5,368,713,216 | 1,562,701,824 | `OOMKilled=true` |

The full request peak was therefore at least 5,368,713,216 bytes. It is a lower
bound: the cgroup killed the candidate before the request completed. The fully loaded
idle figure does not include resident RVC models because the current architecture
loads the RVC worker per conversion.

The monitor did not capture a complete stage-labeled cold-start trace: its initial
descriptor/temp probes encountered host permission behavior and were corrected before
request testing. The table reports only directly observed values; it does not invent
missing Whisper/Kokoro/HuBERT/RMVPE/checkpoint/index timestamps.

## 6. Direct request and mandatory abort

A real mono 16 kHz PCM WAV completed the direct STT route:

| Result | Value |
|---|---|
| Wall latency | 31.590409 seconds |
| Speech detected | true |
| Language / probability | English / 0.9911194443702698 |
| Input duration | 2.825 seconds |
| STT evidence SHA-256 | `8b4332566aa4d6b91603c86abde788384d52c712ba2c8d2e5dcf5d7a760b9173` |

The transcript crossed the real Hermes Responses boundary and produced a sanitized
35-character, one-sentence English response. At `2026-08-02T16:19:46+02:00`, that
response entered the baseline Kokoro/RVC route. Candidate memory reached its 5 GiB
limit; Docker emitted an OOM event at approximately
`2026-08-02T16:20:33.687+02:00`, and no MP3 response was returned. The lower-bound
request latency to failure was about 47.3 seconds.

Abort evidence:

- Docker `OOMKilled=true`;
- Docker event exit code 247;
- kernel `oom_kill` changed from 5 to 6;
- candidate restart count remained 0;
- no automatic restart occurred;
- monitor maximum process count was 6, maximum valid descriptor count was 30, and
  maximum request-temp count was 1;
- Backend and Hermes returned 200 throughout the measured request;
- minimum host `MemAvailable` was 1,562,701,824 bytes;
- warning threshold 1,342,177,280 bytes: not crossed;
- controlled threshold 1,073,741,824 bytes: not crossed;
- emergency threshold 786,432,000 bytes: not crossed;
- root free disk remained approximately 37.0 GB.

The cgroup OOM and new kernel OOM event were both immediate abort conditions. The
monitor removed the canary and invoked rollback. No test was resumed or weakened.

## 7. Tests stopped by the abort

The following Prompt 3 evidence is explicitly incomplete:

| Requirement | Prompt 3 result |
|---|---|
| Cold/warm Kokoro/RVC/complete-request latency | Not completed; only STT and lower-bound failed full-request latency exist |
| 20 sequential RVC requests | 0/20 completed; prohibited after first full-request OOM |
| Leak trend | Not measurable; single failed request showed one request temp and no completed post-state |
| Forced RVC fallback | Not rerun; Prompt 2 fallback remains valid but is not Prompt 3 canary evidence |
| Real failure matrix | Not run after abort |
| SIGTERM during real RVC inference | Not run; OOM termination is not shutdown verification |
| Full shutdown matrix | Partial only: immediate/startup/warm-up passed; real inference not verified |
| Parameter matrix | Baseline alone attempted and OOM-killed; no-index/other values not run |
| Retained parameter candidates | None |
| Seven-phrase set | Not generated for Prompt 3 |
| Continuous 30–45 second artifact | Not generated |
| Listening directory | `/opt/bmo/temp/p8-rvc-canary/listening/` exists but is empty |
| Listening archive | Not created |
| Archive size / SHA-256 / SCP command | Not applicable because no valid archive exists |

The preflight harness first sent one invalid TTS payload without `request_id` and
received a transparent HTTP 422. That response is preserved as
`preflight-422-response.json`; it was corrected before the real request and is not
counted as Audio Service failure or benchmark output.

No listening guide or subjective result is claimed. Operator voice approval remains
absent.

## 8. Rollback and final production proof

Automated rollback began at `2026-08-02T16:20:34+02:00`. It recreated the exact P7
Audio container from the local approved image. The first verifier saw Docker
liveness become healthy before `/readyz` completed model loading and exited on a
transparent HTTP 503. Verification logic was changed to wait for both Docker health
and `/readyz`; it then passed at `2026-08-02T16:21:31+02:00` without recreating P7 a
second time.

Final restoration proof:

- P7 Audio image exactly
  `sha256:62d8b48feb978e303831e20dc558cb95d3240af9a3cf09e8dcd0c82142986e7e`;
- source revision `4d7b472adc4c2243d8f7364032a491ad70efb6d3`;
- Audio user `bmo`, read-only root, all capabilities dropped,
  `no-new-privileges:true`, exact mounts/healthcheck, restart `unless-stopped`;
- production `RVC_ENABLED=false`;
- Audio and Backend Docker health healthy, restart counts 0, `OOMKilled=false`;
- Hermes health 200 and Caddy active;
- listeners exactly `127.0.0.1:3000`, `127.0.0.1:8001`, and
  `127.0.0.1:8642`;
- public `/health=200`, `/livez=404`, `/readyz=404`;
- no candidate container, network, RVC process, or candidate listener remains;
- Audio env, Compose, P7 manifest, and all seven model artifact checksums match the
  rollback anchor;
- production image digest and approved model fingerprint are unchanged.

The final kernel `oom_kill` value is 6. The one increment is correlated to the P8
candidate cgroup OOM; neither production container was OOM-killed.

## 9. Suitability and next decision

Current-VPS classification: **INSUFFICIENT FOR THIS KOKORO + RVC ARCHITECTURE**.

The replacement result is materially different from Prompt 2's simultaneous-service
blocker: P7 Audio had been removed, yet the first full request still exceeded a 5 GiB
candidate limit. At that point the host had only about 1.46 GiB available and the
unknown completion peak remained above the measured lower bound. Raising the limit
on this no-swap 8.3 GB host would leave unattractive reserve and does not provide
production evidence.

Piper decision gate: **B. BENCHMARK PIPER BEFORE PRODUCTION**.

This does not claim Piper is faster, lighter, or better. A future same-VPS comparison
may evaluate `en_GB-semaine-medium`, speaker `prudence`, speaker ID 0, using Hermes
text -> Piper -> FFmpeg -> MP3. Piper is not compatible with the existing RVC `.pth`
and `.index`. Piper code, individual voice-model, dataset, production, and
distribution licensing all require a separate review before adoption.

Exact Prompt 4 recommendation: **do not begin listening approval or permanent
Kokoro + RVC deployment on this VPS; use Prompt 4 only to record this rejection and
plan an explicitly authorized same-VPS Piper benchmark or a larger-host RVC rerun.**

Nothing was merged, pushed, publicly exposed, permanently deployed, or permanently
enabled. Production remains P7 Kokoro-only.

## 10. Prompt 4 RVC closure

Prompt 4 reviewed this evidence and the complete post-checkpoint diff without rerunning
RVC. The Audio Service suite passed 209 tests, the shutdown module passed 11 tests,
`compileall` passed, both dependency environments passed `pip check`, the documentation
verifier passed, and repository hygiene checks found no new model, generated audio,
cache, secret, or large binary. The Hardware Contract remained at SHA-256
`633e398a7fa39a3ebc469af7f9ca46fd04890339bb132ec7de2c2286207c6a44`, and the PRD
remained unchanged.

The reviewed Dockerfile, shutdown tests, and three RVC evidence documents are preserved
in the local closure commit containing this section. The branch remains unmerged and
unpushed. The final classification remains exactly `P8_CANARY_NEEDS_LARGER_HOST`.
