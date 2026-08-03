# BMO — P8 Execution Spec and Piper Production Closure

**Status:** `P8_PIPER_PRODUCTION_VERIFIED`
**Dependency:** P7 `VERIFIED — PRODUCTION`
**Evidence baseline:**
[`../backend-mvp/P7-TEST-EVIDENCE.md`](../backend-mvp/P7-TEST-EVIDENCE.md)
**Contract type:** COMPLETED EXECUTION RECORD — Prompt 5 production closure

> P8 Prompt 5 completed the authorized fixed Piper Prudence implementation,
> controlled canary, remote synchronization, and final production closure. The
> historical RVC verification requirements in this document were not enabled
> or merged; RVC remains disabled and its experimental branch is archived. See
> [`../backend-mvp/P8-PRODUCTION-ROLLOUT-EVIDENCE.md`](../backend-mvp/P8-PRODUCTION-ROLLOUT-EVIDENCE.md)
> for authoritative evidence. P9 remains next and is not started.

## A. Goal

Verify real RVC inference and its resource cost while preserving the already
verified P7 public voice pipeline, immutable deployment provenance,
Kokoro-only fallback, secret boundaries, and Hardware Contract v1.0.5.

P8 resolves whether the experimental BMO RVC path can be safely enabled. It
does not assume that RVC will pass, and it does not require protocol changes if
RVC remains unavailable.

## B. Known baseline

Current verified P7 production state:

```text
RVC_ENABLED=false
Audio runtime: Python 3.10
Deployment source: 4d7b472adc4c2243d8f7364032a491ad70efb6d3
Backend image: bmo-backend@sha256:e981751498fca13bf1f1c1c046a6874a490b3e681aeef9787a53181059506fd7
Audio image: bmo-audio@sha256:62d8b48feb978e303831e20dc558cb95d3240af9a3cf09e8dcd0c82142986e7e
Final P7 soak: 3,665 seconds / 61m 5s; 13/13 samples passed
Backend RestartCount: 0
Audio RestartCount: 0
New OOM during soak: 0
Minimum MemAvailable: 3.209 GiB
Minimum relevant free disk: 59.137 GiB
```

- Kokoro-only production output is verified by P7. Historical P3 evidence records
  a local forced-RVC-failure fallback test; P8 must repeat that regression against
  the selected real RVC runtime.
- Whisper uses `Systran/faster-whisper-medium` revision
  `08e178d48790749d25932bbc082711ddcfdfbc4f`; the current production tuning is
  CPU INT8, 4 threads, 1 worker, beam 5, VAD enabled, hotword `BMO`, and
  language auto-detect.
- Kokoro uses `hexgrad/Kokoro-82M` revision
  `f3ff3571791e39611d31c381e3a41a3af07b4987`, voice `af_heart`, speed `0.80`,
  language code `a`, and 24 kHz output.
- The P7 baseline uses curated, read-only production model artifacts with
  `MODEL_DOWNLOAD_ALLOWED=false`, `HF_HUB_OFFLINE=1`, and
  `TRANSFORMERS_OFFLINE=1`.
- The locked public hardware contract is unchanged. Firmware consumes the same
  WSS/HTTPS events, upload flow, and MP3 output regardless of RVC state.

P8 measurements must compare against the complete P7 evidence, not infer
capacity from nominal VPS specifications alone.

## C. Existing RVC foundation

Inspect the current implementation and tests before selecting a runtime:

- [`../../audio-service/app/rvc.py`](../../audio-service/app/rvc.py)
- [`../../audio-service/scripts/bootstrap_rvc.py`](../../audio-service/scripts/bootstrap_rvc.py)
- [`../../audio-service/tests/test_rvc.py`](../../audio-service/tests/test_rvc.py)
- [`../../audio-service/tests/test_rvc_bootstrap.py`](../../audio-service/tests/test_rvc_bootstrap.py)

The currently locked experimental BMO model asset is:

```text
Repository: Freaky98/CGO-adventure-time-BMO-rvc-v2-420e
Revision: 82a8bc529bd41b930589188ead30f073d4f99fc0
Archive: CGO-adventure-time-BMO-rvc-v2-420e.zip
Size: 63,780,149 bytes
SHA-256: dadb3507d3f836836b16c5605ace8d383e57eddcc92dc2a5fc4406e1c49d27f0
```

The adapter, bootstrap code, tests, and locked archive metadata are foundation
only. They do **not** make RVC installed, safe, compatible, or verified. P7 did
not provision any RVC artifact into the seven-artifact curated production
snapshot.

## D. Required execution sequence

Execute only after explicit P8 authorization, in this order:

1. Perform a fresh source/runtime audit against `main`, the live production
   deployment, this spec, and the P7 evidence.
2. Create an isolated branch/worktree; do not edit or experiment on production
   `main` directly.
3. Inspect the current RVC adapter, bootstrap script, tests, environment
   boundaries, and Kokoro fallback behavior.
4. Resolve and pin a compatible RVC inference engine/runtime. Do not select an
   exact engine/version until actual Python 3.10 and CPU compatibility is
   validated.
5. Establish an immutable dependency set, including package hashes or
   equivalent reproducible provenance and compatible PyTorch/runtime pins.
6. Fetch the model archive only through an explicitly authorized provisioning
   path; verify revision, byte size, and SHA-256, then inspect its member list
   safely before extraction.
7. Resolve and record the exact `.pth` and optional `.index` paths from the
   validated archive; reject traversal, links, scripts, and unexpected assets.
8. Resolve and pin exact HuBERT and RMVPE dependencies when the selected engine
   requires them, including source, immutable revision/file, size, and hash.
9. Materialize only approved RVC artifacts into a curated runtime location.
   Production startup must not download models or dependencies.
10. Run the first real RVC load and inference outside production in a
    non-root, isolated, secret-free environment with constrained writable
    paths.
11. Run real Kokoro → RVC → FFmpeg inference using the verified Kokoro baseline
    and record the command/configuration, timing, output metadata, and sanitized
    logs.
12. Validate that the resulting MP3 remains compatible with the unchanged
    hardware contract and current decoder baseline, including MIME/container,
    mono channel layout, sample rate, bitrate, duration, and decode success.
13. Force RVC failure and prove the request still produces valid Kokoro-only
    MP3 output without leaking internal error details or changing protocol.
14. Benchmark RVC latency, total pipeline latency, CPU, process/container RAM,
    host `MemAvailable`, relevant free disk, OOM evidence, and restart counts
    over a representative repeated run/soak.
15. Compare all measurements against the P7 baseline and retained safety
    headroom; record uncertainty and worst observed values, not only averages.
16. Determine a safe production deployment strategy, resource limits,
    readiness behavior, artifact mounts, rollback path, and enable/disable
    controls. Preserve Kokoro-only rollback/fallback.
17. Perform production rollout only after a separate validation gate explicitly
    approves the reviewed artifacts, dependencies, benchmark, and strategy.
18. If rollout is approved and performed, rerun sanitized public health/WSS and
    fake-device regression checks without changing endpoints, events, payloads,
    or firmware behavior.
19. Record immutable evidence, test results, resource measurements, listening
    evidence, classification, residual risks, and any rollback performed.
20. Stop after recording P8. Do not start or implement P9.

No production restart, rollout, RVC enablement, or model provisioning is
authorized merely by this sequence being documented.

## E. Security and model rules

- The RVC runtime receives no `DEVICE_TOKEN`, `HERMES_API_KEY`, backend service
  secret, provider credential, or unrelated environment value.
  `INTERNAL_SERVICE_TOKEN` must also remain outside an isolated RVC subprocess
  unless a reviewed architecture proves it absolutely required; direct model
  inference should not require it.
- Verify every model and auxiliary asset by immutable repository revision/file
  and expected hash. Mutable aliases such as `latest` are prohibited.
- Treat PyTorch checkpoints as untrusted, pickle-capable artifacts. Use a safe
  loading mechanism such as `weights_only=True` that is compatible with the
  selected runtime; if no compatible safe loader is available, classify P8 as
  `BLOCKED`. Any unsafe pickle-capable compatibility experiment requires separate
  explicit authorization and a disposable, network-disabled sandbox with no host
  sockets, devices, or writable host mounts; all capabilities dropped;
  `no-new-privileges`; seccomp and strict CPU/RAM/time limits; and only narrowly
  validated, non-executable artifacts exported.
- Run archive inspection and first load non-root and isolated, with a read-only
  root/filesystem where practical and only narrow disposable writable paths.
- Never execute arbitrary scripts, binaries, notebooks, or installers from the
  model archive.
- Reject archive traversal, symlinks/hardlinks, unexpected file types, and
  silent extraction outside the approved destination.
- Do not allow a mutable model alias, unpinned inference repository, or
  unreviewed dependency resolver result into production.
- No model, engine, HuBERT, RMVPE, or Python package download may occur during
  production startup.
- Preserve secret-safe logs and evidence; do not record transcripts, generated
  response text, credentials, or authorization headers.

## F. Acceptance and classification

P8 may finish as:

- `VERIFIED` — real RVC inference, Kokoro → RVC → FFmpeg output, fallback,
  quality/listening review, immutable dependencies/assets, and resource safety
  are all demonstrated to the approved gate;
- `PARTIALLY VERIFIED` — useful gates pass but a clearly identified required
  gate remains incomplete, with production kept safely Kokoro-only;
- `BLOCKED` — a real compatibility, security, asset, quality, or resource
  blocker prevents honest verification.

Do not classify RVC as successful based only on archive hash, adapter unit
tests, process exit, or creation of a file. The output must be a valid,
auditable voice-converted result and the resource/security/fallback gates must
pass.

Kokoro-only fallback must remain working even if RVC is blocked or only
partially verified. A blocked RVC result does not authorize weakening model
security, enabling runtime downloads, changing the hardware protocol, or
removing fallback.

## G. Authorization stop

Do not execute P8 solely because this spec exists. Explicit user authorization
is still required. After P8 is classified and its evidence is recorded, stop;
do not auto-start P9.

## H. Prompt 4 feasibility outcome (2026-08-02)

Prompt 4 was explicitly authorized and is recorded in
`docs/backend-mvp/P8-PIPER-FEASIBILITY-EVIDENCE.md`.

- The RVC experiment was closed locally at commit
  `8420d4192a16025f439c040cd7a32a50b41fe52b`; its classification remains
  `P8_CANARY_NEEDS_LARGER_HOST` and it was not merged or pushed.
- Isolated Piper `en_GB-semaine-medium`, `prudence` / ID `0`, passed offline
  cold, persistent warm, 33.312-second continuous, 20-request, failure,
  shutdown, resource, and MP3-contract gates while P7 remained online.
- Technical classification is
  `P8_PIPER_FEASIBILITY_VERIFIED_AWAITING_LISTENING_APPROVAL`.
- Prompt 5 received explicit operator listening approval and completed the
  controlled Piper deployment. Piper Prudence is now the fixed primary,
  Kokoro `af_heart` at `0.80` is fallback, and `RVC_ENABLED=false` remains.

## I. Prompt 5 production closure (2026-08-03)

- `feat/p8-piper-production` was based exactly on the feasibility commit and
  used an integrated persistent Piper worker.
- Pinned model assets were provisioned outside Git with manifest and artifact
  hash verification and read-only runtime mounting.
- Isolated smoke, fallback/recovery, process/shutdown, public contract,
  sequential/queueing, production acceptance, and soak gates passed.
- The final main-built image, post-redeployment smoke, final 15-minute soak,
  and source synchronization are recorded in the rollout evidence and final
  closure update.
- The RVC branch was not merged. No public schema, hardware event, database,
  mobile setting, voice selector, multi-model support, P9, or P10 behavior was
  added.
