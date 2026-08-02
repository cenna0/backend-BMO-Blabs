# P8 Piper Prudence feasibility evidence

**Executed:** 2026-08-02
**Classification:** `P8_PIPER_FEASIBILITY_VERIFIED_AWAITING_LISTENING_APPROVAL`
**Prompt 5 recommendation:** deploy Piper only after explicit operator listening approval; until then retain the unchanged P7 Kokoro-only production runtime.
**Production status:** P7 Kokoro remained running; `RVC_ENABLED=false`; Piper was never publicly exposed or permanently deployed.

This is technical feasibility evidence, not subjective BMO voice approval, a
replacement canary, a production deployment, or `P8 VERIFIED`.

## 1. Branch boundaries and RVC closure

| Item | Value |
|---|---|
| Main/base | `cfbd718f3206ccdc1ea8157b2dc177f235d8181f` |
| RVC branch | `feat/p8-rvc-foundation` |
| RVC worktree | `/opt/bmo/app/.worktrees/p8-rvc-foundation` |
| RVC checkpoint | `d7c207cef2c68c05a8799a6cd87d6d2fb906934b` |
| RVC closure commit | `8420d4192a16025f439c040cd7a32a50b41fe52b` |
| RVC result | `P8_CANARY_NEEDS_LARGER_HOST` |
| Piper branch | `feat/p8-piper-feasibility` |
| Piper worktree | `/opt/bmo/app/.worktrees/p8-piper-feasibility` |

The RVC closure commit contains exactly:

- `audio-service/Dockerfile`
- `audio-service/tests/test_shutdown.py`
- `docs/backend-mvp/P8-CANARY-EVIDENCE.md`
- `docs/backend-mvp/P8-FOUNDATION-EVIDENCE.md`
- `docs/backend-mvp/P8-QUALITY-BENCHMARK-EVIDENCE.md`

It is local, clean, unmerged, and unpushed. RVC was not rerun in this prompt.
The authoritative RVC result remains: the first real replacement request reached
5,368,713,216 bytes candidate peak and was OOM-killed before completion. A
completed-request peak is unknown; no valid Prompt 3 30–45 second sample or
listening archive exists; warm and 20-request evidence is incomplete. The tested
RVC architecture is unsuitable for this host.

The five closure files passed the scoped Audio Service suite (209 tests), the 11
shutdown tests, compileall, both dependency-environment `pip check` runs,
documentation verification, diff checking, scope review, and hygiene scans. A
broader checkpoint-era suite also reported one obsolete one-stage-Dockerfile
expectation and four tests requiring a Docker CLI absent from that test image;
none is in the five-file post-checkpoint scope and none was represented as a pass.

## 2. Production gate and timeline

Pre-benchmark evidence is private at
`/opt/bmo/temp/p8-piper-feasibility/evidence/host-pre-benchmark.json`.

| Measurement | Pre-benchmark value |
|---|---:|
| Physical RAM | 8,326,950,912 bytes |
| `MemAvailable` | 4,796,178,432 bytes |
| Swap | 0 bytes |
| Production Audio cgroup | 2,226,180,096 bytes |
| Backend cgroup | 110,022,656 bytes |
| Hermes service | 195,944,448 bytes |
| Other recorded containers | 85,790,720 bytes |
| Process count | 151 |
| Load average | 0.457 / 0.598 / 0.476 |
| Kernel `oom_kill` | 5 |
| Free disk | 34,491,871,232 bytes |

The approved images were exact throughout:

- Backend: `sha256:e981751498fca13bf1f1c1c046a6874a490b3e681aeef9787a53181059506fd7`
- Audio: `sha256:62d8b48feb978e303831e20dc558cb95d3240af9a3cf09e8dcd0c82142986e7e`

Every final benchmark monitor sample reported Backend healthy, Audio healthy,
Hermes `200`, public `/health=200`, `/livez=404`, `/readyz=404`, zero production
restarts, production `OOMKilled=false`, kernel `oom_kill=5`, and an `ok` safety
decision. Ports 3000, 8001, and 8642 remained bound only to `127.0.0.1`.

| UTC interval | Activity | Result |
|---|---|---|
| 18:02 | Preflight and one-phrase smoke | Green; exact prudence/0 output validated |
| 18:04–18:06 | First draft-text benchmark | Green; continuous sample 29.35–29.83 s, rejected as too short |
| 18:07–18:09 | Extended-text benchmark | Green; text later normalized to production's three-sentence boundary |
| 18:11–18:13 | Final-text qualification | Green; superseded after shutdown hardening changed the image |
| 18:13–18:16 | Eight bounded warm Kokoro references | Green; no request overlap |
| 18:32–18:34 | Release-image benchmark | Green; superseded after independent review corrected latency boundaries |
| 19:04–19:06 | Reviewed benchmark | 115 monitor samples, all green; corrected MP3-ready metrics |
| 19:15 | Reproducibility attempt | Bounded stop on stale output-path collision; no OOM/restart/production fault; monitor absence-case regression added |
| 19:17–19:19 | Fresh-directory qualification | 113 monitor samples, all green; superseded by reviewer hardening |
| 19:33–19:35 | Exact-final hardened qualification | 110 monitor samples, all green |
| 19:36 | Post-benchmark audit | Production healthy and unchanged |

The final post-benchmark hashes still matched the preflight values:

- `/opt/bmo/config/audio.env`: `3ced8033d38533d473abdbe53cacb6c3cf3ea58fb40fb2368a50abcc0b3af15c`
- production Compose: `3040cf3ea479536cbae0cfd7a0d35d11ab9bed7df69ba285e6496cf6354b855c`

The Audio cgroup retained 4,302,393,344 bytes after the bounded long Kokoro
reference, without restart or OOM. It was not restarted merely to obtain a cold
measurement.

## 3. Immutable Piper engine identity

| Item | Pinned value |
|---|---|
| Repository | `https://github.com/OHF-Voice/piper1-gpl` |
| Release | `v1.6.0` |
| Commit | `f04d52c5528ac7cf2d73757f57990ff490f75005` |
| Package | `piper-tts==1.6.0` |
| Source/package license | `GPL-3.0-or-later` |
| Supported Python | `>=3.9`; upstream classifiers 3.9–3.13 |
| Candidate Python | `3.10.20` |
| ONNX Runtime | `onnxruntime==1.23.2` |
| Phonemization | embedded eSpeak NG data and bridge from the Piper wheel |
| Tested CPU architecture | Linux `x86_64`, CPU-only |

The official release tag was resolved to the exact commit; no floating branch is
used. Upstream calls the project development status Alpha and states that it is
looking for maintainers. Those are maintenance risks, not evidence of a known
vulnerability. No claim of a comprehensive upstream security audit is made.

The runtime wheel is the official manylinux x86-64 artifact, 34,109,999 bytes,
SHA-256
`3120d5cc45e07fb99bdede8feef85116fd45bf488aa1d89c7b1aefb657d38683`.
All dependencies were downloaded into an outside-Git wheelhouse and installed
offline with `--no-index --require-hashes`.

| Reproducibility input | SHA-256 |
|---|---|
| `piper-candidate/Dockerfile` | `3dffab0851ffd199f5177d0b415e1ec0fdd36245c09d470fe6dbee086655d71b` |
| `piper-candidate/Dockerfile.dockerignore` | `0b7aae180ce4656ad1421a5a8b290f2ff02a9acc238b08e902b86942e9407633` |
| `requirements-runtime.lock` | `531e1ac19303387db35b045111fe91f2d47ebe4b8867fb3cf5e7d675f566fffb` |
| `requirements-verify.lock` | `3cdee335bcc5776e798a1750368444b4a9089e9808867ae21370bc838afd7cdd` |
| `comparison-text.json` | `1ba2e3b98f32cb19fa73ee8190519f43d817f750ee58c9c044bb9a991ce12045` |
| outside-Git asset manifest | `9e92d11f5010448b3ab978648a8a4e300501b227f73b60794b9039ca39b27383` |

Runtime lock: coloredlogs 15.0.1, flatbuffers 25.12.19, humanfriendly
10.0, mpmath 1.3.0, numpy 2.2.6, onnxruntime 1.23.2, packaging 26.2,
pathvalidate 3.3.1, piper-tts 1.6.0, protobuf 7.35.1, and sympy 1.14.0.
The verification lock pins exceptiongroup 1.3.1, iniconfig 2.3.0, packaging
26.2, pluggy 1.6.0, pytest 8.3.4, tomli 2.4.1, and typing-extensions 4.16.0.

The final local candidate image is
`sha256:fe805ff97e73abf57a4afd5f4157606b8f3d42991ba55fc16f86a096c7156b51`,
383,118,060 bytes. Its base is
`python:3.10.20-slim-bookworm@sha256:9643927a6fc74bd81b0f1bbb5cce3cb4a491f46b4c5dbee770f28e575f180015`;
it pins `ffmpeg=7:5.1.9-0+deb12u1` and `tini=0.19.0-1+b3`. Image `USER` is
`piper`, entrypoint is Tini with process-group signaling, and it exposes no port.

## 4. Immutable voice and dataset identity

| Item | Pinned value |
|---|---|
| Voice repository | `https://huggingface.co/rhasspy/piper-voices` |
| Voice revision | `9f967d15e9ccdf43078586d1476ee70f314401bd` |
| Voice | `en_GB-semaine-medium` |
| Model | `en_GB-semaine-medium.onnx` |
| Config | `en_GB-semaine-medium.onnx.json` |
| Model card | `MODEL_CARD` |
| Dataset repository | `https://github.com/marytts/dfki-semaine-data` |
| Dataset revision | `cbeb97b9bb0deecf4355220fcfba280a7b30983a` |
| Dataset license file | `DFKI-SEMAINE-LICENSE.md` |

| Artifact | Bytes | SHA-256 |
|---|---:|---|
| `en_GB-semaine-medium.onnx` | 76,737,711 | `d6dab6f3b92db43ea3f78c7f20dc8eadb47a1f15d8a1c9d451cf3ccd201a2f66` |
| `en_GB-semaine-medium.onnx.json` | 5,076 | `6425dcb878684043b77d772b173ae006d86a583b110303edda48b8438ecee5ee` |
| `MODEL_CARD` | 332 | `d3c370c9c73b69347f9487cc24b0cfa5f2a400c47d209f0aa4ce20123562e46d` |
| `DFKI-SEMAINE-LICENSE.md` | 19,124 | `c0b81b610f4d9e0e0bb29ac4441106d0b4fb570b67d95f253df0c5db68c92eca` |

The actual JSON config, not a screenshot or catalog label, reports:

```text
speaker_id_map = {prudence: 0, spike: 1, obadiah: 2, poppy: 3}
num_speakers = 4
audio.sample_rate = 22050
phoneme_type = espeak
espeak.voice = en-gb-x-rp
```

The adapter rejects any speaker other than `prudence` / ID `0`, and the loaded
Piper object is checked against that identity before inference.

## 5. License review for intended personal, noncommercial use

Piper engine code/package is GPL-3.0-or-later. Private execution is compatible
with the intended personal use. If binaries or modified engine code are
distributed later, GPL license/source and corresponding-source obligations must
be reviewed and satisfied.

The voice-specific model card and pinned DFKI SEMAINE dataset license state
CC BY-NC-SA 4.0. The broader voice repository metadata says MIT, but this review
conservatively applies the more specific voice/dataset CC BY-NC-SA terms:
personal noncommercial use is within the stated NonCommercial scope; sharing
requires attribution, the license notice, indication of changes where applicable,
and ShareAlike treatment of adapted material. Commercial permission is not
claimed. Whether a particular generated output is legally adapted material and
whether any underlying personality or contributor rights apply are unresolved;
redistribution should be treated conservatively. No paid API, key, subscription,
or commercial license was added.

This repository review is technical evidence, not formal legal advice.

## 6. Isolated production-shaped architecture

The path under test was exactly:

```text
text -> one persistent Piper model -> mono 22.05 kHz PCM16 WAV
     -> validation -> FFmpeg -> mono 24 kHz target 96 kbps MP3
```

Piper did not follow Kokoro and RVC did not follow Piper. The final candidate ran
with:

- name `bmo-p8-piper-checkpoint-20260802`;
- `--network none`, no port, no route, and no production Compose mutation;
- `--restart no`;
- hard memory and memory+swap limit 1,073,741,824 bytes;
- 2 CPUs and explicit OMP/OpenBLAS/MKL/NumExpr thread count 2;
- PID limit 128;
- read-only root, all capabilities dropped, `no-new-privileges`;
- 256 MiB no-exec tmpfs;
- read-only asset mount and one narrow writable output mount;
- non-root UID/GID 1002:1002 for the host-owned benchmark output (the image
  default is also non-root, UID 10001);
- bounded JSON logs, 10 MiB × 3;
- no device, internal-service, Hermes, Telegram, or unrelated secret;
- offline assets with the manifest SHA-256 anchored in candidate code, followed
  by per-artifact size/hash verification before every load.

The 1 GiB limit was derived from 4,796,178,432 bytes preflight
`MemAvailable`. Even at the full limit, the initial arithmetic reserve was
3,722,436,608 bytes. Warning, controlled-abort, and emergency thresholds were
1.25 GiB, 1.0 GiB for five consecutive seconds, and 750 MiB respectively. No
threshold or other stop condition fired.

## 7. Basic output validation

The first bounded smoke loaded the exact model in 1.716 seconds, synthesized the
short greeting in 0.382 seconds, and converted it in 0.215 seconds. Its raw WAV
was mono PCM16 at 22,050 Hz, finite, 2.322 seconds, and parseable. Its final MP3
was mono, 24,000 Hz, 96,000 bps, 2.376 seconds, parseable, and unclipped after
decode. Speaker, model hash, and config hash matched the manifest. The runtime
had no network and performed no download.

All final listening artifacts were revalidated. The archive contains 68 audio
files; ffprobe accepted 68/68. WAV/MP3 metric checks cover duration, peak, RMS,
DC offset, clipping, silence ratio, leading/trailing silence, finite samples,
gross-discontinuity p95, size, and hash. Automated metrics are guardrails only.

## 8. Final cold benchmark

Cold means a new worker process, manifest/hash validation, model load, first WAV,
FFmpeg, and exit. Production Audio was not restarted. `MP3 ready` stops when the
final file exists; `validation complete` additionally includes full MP3
probing/decode. The latter is reported separately and is not called
text-to-MP3 latency.

| Text class | Process + model ready | Model load | Piper synth | Text-to-WAV | FFmpeg | Request MP3 ready | Validation complete | Full cold MP3 ready | Output |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Short | 2.076 s | 1.670 s | 0.442 s | 0.447 s | 0.214 s | 0.834 s | 1.151 s | 2.910 s | 2.496 s |
| Medium | 1.883 s | 1.499 s | 1.008 s | 1.011 s | 0.178 s | 1.578 s | 1.980 s | 3.462 s | 6.240 s |
| Long normal | 1.902 s | 1.515 s | 1.823 s | 1.825 s | 0.182 s | 2.730 s | 3.289 s | 4.632 s | 11.400 s |

Cold sample size is one per class, so no cold percentile is claimed.

## 9. Persistent warm benchmark

One worker loaded once; all warm records report `model_load_count=1`.

| Text class (five sequential runs) | Text-to-WAV median / max | FFmpeg median / max | MP3-ready median / max | Validation-complete median / max | Median MP3-ready RTF |
|---|---:|---:|---:|---:|---:|
| Short | 0.425 / 0.648 s | 0.139 / 0.142 s | 0.731 / 0.960 s | 1.047 / 1.272 s | 0.296 |
| Medium | 0.838 / 1.006 s | 0.168 / 0.187 s | 1.413 / 1.779 s | 1.835 / 2.245 s | 0.231 |
| Long normal | 1.752 / 2.159 s | 0.230 / 0.241 s | 2.773 / 3.146 s | 3.347 / 3.829 s | 0.244 |

Across all 15 warm measurements, text-to-WAV median/max was 0.838/2.159
seconds, FFmpeg median/max 0.168/0.241 seconds, MP3-ready median/max
1.413/3.146 seconds, and validation-complete median/max 1.835/3.829 seconds.
With five samples per class, p95 is not claimed.

## 10. Continuous response

The final original three-sentence passage was synthesized as one logical
response, not concatenated or time-stretched.

| Run | Text-to-WAV | FFmpeg | MP3 ready | Validation complete | Final duration | MP3-ready RTF | CPU | Peak memory |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Canonical listening file | 4.812 s | 0.311 s | 6.945 s | 8.346 s | 33.312 s | 0.208 | 9.862 s | 595,136,512 B |
| Repeat 1 | 4.716 s | 0.313 s | 7.219 s | 8.588 s | 33.864 s | 0.213 | 9.678 s | 745,828,352 B |
| Repeat 2 | 4.087 s | 0.319 s | 6.553 s | 7.874 s | 32.112 s | 0.204 | 8.384 s | 739,295,232 B |

All three completed without truncation or instability and meet the 30–45 second
target.

## 11. Memory and 20-request stability

| Measurement | Bytes | MiB |
|---|---:|---:|
| Persistent worker idle after load | 165,625,856 | 158.0 |
| Warm short/medium/long median working peak | 582,086,656 | 555.1 |
| Warm short/medium/long maximum peak | 583,856,128 | 556.8 |
| Overall peak, continuous repeat | 745,828,352 | 711.3 |
| Retained after all work | 719,937,536 | 686.6 |
| Minimum host `MemAvailable` (20 ms sampler) | 2,032,680,960 | 1,938.5 |

ONNX Runtime expanded its allocator after long-form work. The relevant leak test
is the subsequent 20-request persistent sequence: 20/20 succeeded; memory after
the first/last request was 705,032,192 / 720,859,136 bytes, a bounded 15,826,944
byte increase; processes stayed 3→3; descriptors 13→13; temporary files 0→0;
model load count remained 1. Mean MP3-ready latency was 1.447 seconds for the
first five and 1.513 seconds for the last five. There was no sustained latency,
process, descriptor, or temp-file growth. Candidate restart count was zero,
candidate OOM was false, production restarts were zero, and kernel OOM count
remained 5.

## 12. Failure and shutdown behavior

Actual isolated failure probes passed:

| Failure | Exit/result | Cleanup |
|---|---|---|
| Missing model | startup exit 1 in 0.811 s | zero output |
| Model hash mismatch | startup exit 1 in 0.773 s | zero output |
| Missing JSON config | startup exit 1 in 0.807 s | zero output |
| Invalid speaker ID/name | request rejected; worker exit 0 | zero output |
| Malformed/empty input | request rejected; worker exit 0 | zero output |
| Invalid output path | request rejected; worker exit 0 | zero output |
| Read-only output | synthesis rejected; worker exit 0 | zero output |
| Synthesis timeout | worker/process group terminated in 3.991 s | exact partial/final paths removed |
| Malformed/zero-byte WAV | validation tests reject | no accepted output |
| FFmpeg failure/timeout | tests reject and remove partial output | real child timeout bounded |

Actual SIGTERM tests used the final candidate image:

| Phase | Shutdown | Exit | OOM/restart/orphan/temp leak |
|---|---:|---:|---|
| Startup | 0.160 s | 0 | none |
| Model loading | 0.169 s | 0 | none |
| Synthesis | 0.581 s | 0 | none |
| FFmpeg | 0.170 s | 0 | none |
| Idle | 0.264 s | 0 | none |

No normal shutdown path required SIGKILL or broad deletion.

## 13. Same-text Kokoro comparison

Kokoro is the already-warm approved production endpoint. Its request latency
includes production Kokoro and FFmpeg but the endpoint does not expose a stage
split or pre-FFmpeg WAV. The supplied Kokoro WAVs are lossless decodes of final
MP3s and are labeled accordingly. Piper values are persistent canonical totals.

| Phrase | Kokoro latency / duration | Piper latency / duration |
|---|---:|---:|
| Short greeting | 3.725 / 2.880 s | 0.660 / 2.424 s |
| Reassuring | 3.079 / 3.864 s | 0.791 / 2.784 s |
| Excited | 2.427 / 3.024 s | 0.745 / 2.664 s |
| Calm medium | 5.365 / 7.968 s | 1.716 / 6.600 s |
| Excited medium | 5.495 / 8.760 s | 1.715 / 6.744 s |
| Names/numbers | 13.631 / 11.808 s | 1.903 / 8.424 s |
| Long normal | 11.041 / 15.840 s | 2.655 / 11.208 s |
| Continuous | 31.927 / 41.232 s | 6.945 / 33.312 s |

Kokoro's maximum observed production Audio cgroup peak was 4,642,467,840
bytes, but that cgroup also contains the production STT/runtime and is not
directly comparable to Piper's isolated cgroup. Piper is materially faster in
this sequential same-text run and operationally smaller as a TTS-only process.
This is not a replacement canary; concurrency and public API integration were
not tested. Subjective similarity remains solely for the operator.

## 14. Limited legacy RVC comparison

No RVC inference was run. Three existing greeting diagnostics were found,
hash-verified, and ffprobe-validated:

| Legacy reference | WAV / MP3 SHA-256 | Format |
|---|---|---|
| Prompt 1 foundation baseline | `be0614…dc41` / `a7b0b3…c206` | 2.800 s mono PCM16 40 kHz / 2.856 s mono 24 kHz 96 kbps MP3 |
| Prompt 2 baseline index 0.75 | `7d305d…df6` / `5efb29…5244` | same duration/format |
| Prompt 2 no retrieval | `c0ebbf…2252` / `356fcd…6ef` | same duration/format |

Their recorded source is `Hi! BMO is ready to help.` Even though that phrase is
also in the new set, these are historical short diagnostics from different
runs and are not a controlled same-runtime, same-duration, or long-form
competitor. They provide no completed replacement peak, warm soak, 20-request,
or 30-second RVC evidence.

## 15. Private listening bundle

| Item | Value |
|---|---|
| Listening directory | `/opt/bmo/temp/p8-piper-feasibility/listening/` |
| Archive | `/opt/bmo/temp/p8-piper-feasibility/p8-piper-listening-bundle.tar.gz` |
| Archive bytes | 17,952,821 |
| Archive SHA-256 | `41c2e1846dcbf9a93d628fbea24b6f54ae5597942d111be885129dd5d5a2179c` |
| Tailscale IPv4 | `100.107.88.120` |

Safe operator command:

```bash
scp bmo-admin@100.107.88.120:/opt/bmo/temp/p8-piper-feasibility/p8-piper-listening-bundle.tar.gz ./
```

The archive has 84 files and 68 audio files. Its checksums pass and ffprobe
accepts 68/68. It contains labeled and blind same-text output, source text,
technical metrics, model identity without model files, three clearly separated
legacy short RVC diagnostics, `LISTENING-GUIDE.md`, `BLIND-KEY.md`,
`manifest.json`, `benchmark-results.json`, and `SHA256SUMS`. It contains no
ONNX/RVC weight/index, environment file, token, credential, code, bytecode,
cache, private log, internal service configuration, or unrelated system data.

The guide asks the operator to use fixed equipment/volume, listen blind first,
record first impressions, replay the continuous pair at least twice, and assess
BMO similarity, friendliness, playfulness, intelligibility, naturalness, pitch,
consonants, vowels, metallic/robotic artifacts, calm/excited stability,
names/numbers, punctuation, pauses, clipping, and long-form acceptability.

## 16. Twelve-GiB headroom projection

Measured evidence:

- preflight used-equivalent (`MemTotal - MemAvailable`): 3,530,772,480 bytes;
- preflight P7 Audio: 2,226,180,096 bytes;
- post-Kokoro-reference used-equivalent: 5,396,045,824 bytes;
- post-reference P7 Audio: 4,302,393,344 bytes;
- final Piper idle / peak: 165,625,856 / 745,828,352 bytes;
- final current-host minimum reserve: 2,032,680,960 bytes.

Conservative projection for a 12 GiB host keeps the entire fully exercised P7
Audio footprint, even though a true replacement should release some Kokoro
residency, and adds Piper's observed peak:

```text
12 GiB                                           12,884,901,888
post-reference current used-equivalent            5,396,045,824
+ isolated Piper peak                               745,828,352
= conservative projected use                       6,141,874,176
= projected reserve                                6,743,027,712 (6.28 GiB)
```

Classification: **likely comfortable**, with medium confidence. The arithmetic
is deliberately conservative and the current 8.3 GB host already completed the
co-resident run. Uncertainty remains around real concurrency, OS/cache variance,
future service changes, and exact provider interpretation of “12 GB.” This is
not a 12 GB production canary and does not verify that host.

## 17. Decision gate and unresolved risks

All technical direction-A gates passed: immutable model/speaker identity,
offline inference, no OOM/production impact, safe reserve, contract MP3, valid
33.312-second output and repeats, 20/20 persistent requests, no material leak,
bounded shutdown, complete listening archive, and conservative
personal/noncommercial licensing documentation.

Unresolved risks:

- operator BMO-similarity and voice-quality approval is absent;
- Piper has not replaced production and no replacement canary exists;
- API integration, concurrency, and recovery in the permanent service are not tested;
- ONNX Runtime retains about 687 MiB after long-form allocation, though the
  subsequent 20-request trend was stable;
- only x86-64 CPU was tested;
- GPL and CC BY-NC-SA obligations require review before redistribution;
- 12 GB evidence is a projection, not deployment verification.

Exact Prompt 5 recommendation: **deploy Piper only after the operator approves
the private blind listening bundle; otherwise retain Kokoro-only for the MVP.**
Prompt 5 must still perform a controlled deployment/canary and rollback gate.
No voice winner is selected here.

## 18. Repository and contract hygiene

The final Piper branch verification covers the candidate adapter, manifest and
speaker selection, audio validation, FFmpeg, benchmark, process tree, failure,
shutdown, host monitoring, offline packaging, bundle generation, compileall,
hash-only dependency checks, ffprobe, documentation, diff checking, secret and
generated-artifact scans, model/audio/cache and large-file scans, and changed
scope. The final isolated image suite passed 60/60 tests. Private audio, models,
caches, archives, bytecode, logs, and evidence
telemetry remain outside Git.

Hardware Contract v1.0.5 remains SHA-256
`633e398a7fa39a3ebc469af7f9ca46fd04890339bb132ec7de2c2286207c6a44`.
The current PRD remains SHA-256
`85022140f9825cb9256b7b29ce49b8407cc854108dbf720b4377581304b7e53f`.
Neither changed.

Nothing was merged, pushed, publicly exposed, or permanently deployed. Final
state must remain P7 Kokoro running, `RVC_ENABLED=false`, no candidate process
or container, and both feature branches unmerged/unpushed.
