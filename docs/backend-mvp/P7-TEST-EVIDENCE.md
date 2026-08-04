# P7 — Backend, Audio Service, and Hermes Production Integration — Test Evidence

**Status:** `VERIFIED — PRODUCTION`
**Execution date:** 2026-07-28 through 2026-07-31
**Verified at:** `2026-07-31T03:22:12Z`
**Authorized by:** explicit checkpoint-by-checkpoint user authorization for P7
**Deployment source:** `4d7b472adc4c2243d8f7364032a491ad70efb6d3`
**P8 status:** `NOT_STARTED / AWAITING EXPLICIT USER AUTHORIZATION`
**P9–P10 status:** `NOT_STARTED / dependency-gated`

> Historical evidence snapshot: the P8/P9 status lines in this report describe
> the state at the time of the P7 verification. Current state is governed by
> `P8-PRODUCTION-ROLLOUT-EVIDENCE.md`, `IMPLEMENTATION-STATUS.md`, and
> `../p9/README.md`; P8 is now production-verified and P9 is architecture-only.

This report is sanitized. It contains no device token, Hermes API key,
internal-service token, authorization header, transcript, Hermes response
text, provider credential, Telegram credential, or other active secret.

## 1. Result

P7 source, packaging, offline-model, private-deployment, private-E2E, Caddy
cutover, public fake-ESP32 acceptance, and final production-soak gates passed.
All mandatory P7 closure criteria are satisfied. Evidence review, evidence
commit/push, and local/origin/live-remote synchronization were subsequently
confirmed, so the formal P7 classification is `VERIFIED — PRODUCTION`.

P7 preserves the locked hardware contract v1.0.5 and all P6 controls. P8 real
RVC verification, P9 database work, and P10 physical ESP32 acceptance were not
started.

## 2. Source and review chain

P7 started from the verified P6 baseline
`38af1c5d14b3d6a95949af23eccfbc27465b30ce` and produced this reviewed commit
chain:

```text
1d25d0bc126ea3c48680661f153915b805d775cb  liveness/readiness safety
5192ee71ddf392423428d0bbb28a6d1e8b0a263f  exact curated offline model snapshots
118f02c07ea97f16e23b9183d1a050c73f190be7  safe orphan temp-audio cleanup
84708037c262d8f5fe8033906ec6ca92a175292f  deterministic container packaging
4886c6f48801d197e4ccb25d15f8eca6d1ce5821  deployment resource preflight gate
ff6f618f7087d7f51f5288862b511f1d7cdd79b8  public fake-ESP32 verifier
4d7b472adc4c2243d8f7364032a491ad70efb6d3  fully offline Kokoro startup fix
```

The branch-wide integration review, remediation review, post-merge review, and
remote SHA verification passed. At deployment selection:

```text
local main    4d7b472adc4c2243d8f7364032a491ad70efb6d3
origin/main   4d7b472adc4c2243d8f7364032a491ad70efb6d3
live remote   4d7b472adc4c2243d8f7364032a491ad70efb6d3
```

Authoritative source gates passed:

- full backend regression under pinned Node 22;
- backend typecheck and production build;
- full Audio Service regression under Python 3.10;
- focused offline-model and materializer regressions;
- operations/resource-preflight tests;
- packaging tests and transient runtime smoke tests;
- canonical repository verifier;
- `git diff --check`;
- secret and sensitive-artifact scans;
- locked hardware contract v1.0.5 review.

## 3. Immutable production images

```text
Backend  bmo-backend@sha256:e981751498fca13bf1f1c1c046a6874a490b3e681aeef9787a53181059506fd7
Audio    bmo-audio@sha256:62d8b48feb978e303831e20dc558cb95d3240af9a3cf09e8dcd0c82142986e7e
Revision 4d7b472adc4c2243d8f7364032a491ad70efb6d3
```

Both OCI revision labels match the approved deployment SHA. The backend image
is 82,056,579 bytes and runs as `node` (UID 1000). The Audio Service image is
702,087,547 bytes and runs as `bmo` (UID 10001).

Build inputs:

```text
Backend base
  node:22.23.1-bookworm-slim
  sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3
Backend Dockerfile
  sha256:1e38bbcc67e552376e50903bb49f8edd7e529fafe35ceaa57ffff4c7885e8287
Backend package-lock.json
  sha256:de0010daee3ac81da1f85a1f999b29bb72322fc9f8e3c848175343a80959b5bd

Audio base
  python:3.10.20-slim-bookworm
  sha256:9643927a6fc74bd81b0f1bbb5cce3cb4a491f46b4c5dbee770f28e575f180015
Audio Dockerfile
  sha256:88319df25523d31b396af90de301bfbba07943580d58f826a0ffd2a005892c4d
Audio requirements-runtime.lock
  sha256:55cc9380cfdd381ad814f88a6cad098b157ef6e4a326d6b1af3cc81e9bd5357a
```

`en_core_web_sm` 3.8.0 is installed deterministically in the Audio Service
image as a Misaki runtime dependency. It is not part of the curated model
snapshot.

Both images use `/livez`-only Docker health checks. Readiness failure does not
terminate either process or create restart loops.

## 4. Runtime secrets and production configuration

The protected runtime files are outside Git:

```text
/opt/bmo/config/backend.env  bmo-admin:bmo-admin 0600 regular 30 variables
/opt/bmo/config/audio.env    bmo-admin:bmo-admin 0600 regular 33 variables
```

Provisioning validation passed without printing values:

- the existing Hermes `API_SERVER_KEY` was reused as the backend Hermes key;
- `DEVICE_TOKEN` and `INTERNAL_SERVICE_TOKEN` were generated independently
  with `secrets.token_hex(32)`;
- the internal token matches between backend and audio files;
- device and Hermes credentials exist only in `backend.env`;
- exact variable allowlists, absence of duplicates/placeholders, file type,
  owner, mode, and Compose parsing passed;
- `MODEL_DOWNLOAD_ALLOWED=false`, `RVC_ENABLED=false`, and
  `HARDWARE_TEST_MODE=false`;
- no second persistent device-token copy was created.

## 5. Models and offline readiness

Exact production model selections:

```text
Whisper repository  Systran/faster-whisper-medium
Whisper revision    08e178d48790749d25932bbc082711ddcfdfbc4f
Whisper license     MIT

Kokoro repository   hexgrad/Kokoro-82M
Kokoro revision     f3ff3571791e39611d31c381e3a41a3af07b4987
Kokoro voice        af_heart
Kokoro license      Apache-2.0
```

The curated deployment snapshot contains exactly seven regular runtime
artifacts plus `MODEL_MANIFEST.json`; no RVC artifact was provisioned.
Artifact SHA-256 values and byte sizes match the manifest.

```text
Approved model fingerprint
d2761b191eed48e85128e774aa7057153d8e8994e2e4f40c07ffb05731ae7e9f
```

The replacement final Audio Service image passed a network-disabled cold-load
proof with the curated model root mounted read-only:

- `MODEL_DOWNLOAD_ALLOWED=false`;
- `HF_HUB_OFFLINE=1`;
- `TRANSFORMERS_OFFLINE=1`;
- Whisper loaded and completed real inference;
- Kokoro initialized and completed `af_heart` inference;
- `en_core_web_sm` 3.8.0 loaded without download behavior;
- FFmpeg conversion passed;
- `/livez` and mandatory `/readyz` became healthy;
- optional RVC remained disabled/degraded without blocking readiness;
- model files were unchanged before and after.

## 6. Production topology and writable paths

```text
Backend  host network; binds 127.0.0.1:3000; read-only root; UID 1000
Audio    bridge network; publishes 127.0.0.1:8001 only; read-only root;
         UID 10001; curated model mount read-only
Hermes   host systemd runtime; binds 127.0.0.1:8642
```

Both application containers use:

- `restart: unless-stopped`;
- bounded `json-file` logging (`10m` × `3`);
- all Linux capabilities dropped;
- `no-new-privileges`;
- no source bind mount;
- no public `3000`, `8001`, or `8642` listener.

Required writable host paths:

```text
/opt/bmo/cache/audio  10001:10001 0750
/opt/bmo/temp/tts     10001:10001 0750
/opt/bmo/temp/audio   1000:1000   0750
```

## 7. Private deployment and private E2E

Audio was started and warmed before the backend. Mandatory Audio Service
readiness, the warm resource gate, backend readiness, Hermes connectivity,
loopback listener checks, Docker health, restart-count checks, and model
fingerprint checks passed. Public traffic remained on the P6 placeholder
during private validation.

The private fake-ESP32 test passed the real:

```text
WAV -> Whisper STT -> Hermes -> Kokoro -> FFmpeg MP3
```

It authenticated, received HTTP `202`, observed `thinking` and `audio_ready`,
validated the canonical MP3 response, sent playback completion, and proved one
duplicate/idempotency path without a second pipeline execution.

The private-E2E WAV was synthesized locally through Kokoro. It proves
production pipeline integration and lifecycle behavior; it does not prove
human-speech STT quality.

## 8. Backup, firewall, Caddy, and rollback

The P6 firewall policy remained unchanged and passed the corrected strict root
gate:

```text
80/tcp public
443/tcp public
22/tcp only on tailscale0, IPv4 and IPv6
no public 3000/8001/8642 rule
```

Fresh protected pre-cutover backup:

```text
Backup ID       20260730T115645Z
Required files  present
Checksums       PASS
Archives        readable
Inspection      read-only; no restore performed
```

Rollback anchor:

```text
Source  /opt/bmo/config/caddy/Caddyfile
SHA-256 80150fb3cc50616638efdd4121a4061c18ad632e05d6e06d34448ddcf321554b
```

The Caddy cutover helper verified all private dependencies, firewall rules,
listeners, candidate/rollback hashes, and rollback behavior before performing
an atomic `root:caddy` `0640` install and reload. Immediate public health,
internal-probe hiding, container health, restart count, and listener gates
passed:

```text
CUTOVER=PASS
P7 candidate SHA-256
ce8adbb0dd7f273709313d6e62ff35fd308354a07889ed86f52738f30e5824ff
```

Rollback does not depend on Git or image rebuilds: atomically reinstall the
preserved P6 source, validate, reload Caddy, and verify the public P6 `503`.
The healthy private application containers may remain running.

Older backup/rollback assets and the superseded `ff6f618f` image candidates
remain retained.

## 9. Public fake-ESP32 acceptance

The committed verifier `backend/scripts/verify-p7-public-e2e.ts` passed all 23
mandatory checks against:

```text
API  https://api.personalbmo.web.id
WSS  wss://api.personalbmo.web.id/ws
```

```text
Result                       PASS
Passed / failed              23 / 0
Total verifier duration      51,691 ms
Valid authentication         32 ms
Upload acceptance            HTTP 202 in 27 ms
Thinking event               37,867 ms
Thinking -> audio_ready      12,931 ms
MP3 retrieval                24 ms
MP3 length                   90,189 bytes
MP3 content type             audio/mpeg
MP3 cache control            no-store, private, max-age=0
Playback completion          11 ms
Completed audio unavailable  HTTP 404
```

Coverage included sanitized public health, hidden internal probes, valid,
missing, and invalid WebSocket authentication, HTTP credential rejection,
malformed WAV, invalid WAV metadata and request ID, canonical lifecycle,
duplicate/idempotency behavior, `REQUEST_ID_CONFLICT`, `DEVICE_BUSY`,
thinking/audio-ready reconnect synchronization, MP3 retrieval, completion
resend, and completed/expired audio unavailability behavior.

The public test fixture was a transient, locally synthesized canonical
5.65-second PCM signed 16-bit LE, 16 kHz, mono WAV. It was deleted after the
run. Evidence output contained only allowlisted metadata and no secret,
transcript, or Hermes response.

## 10. Final production soak

The production stack was observed without a restart or configuration change
for 3,665 seconds (61 minutes 5 seconds), from `2026-07-31T02:21:17Z` through
`2026-07-31T03:22:12Z`. All 13 samples passed.

```text
Backend memory       97.76 MiB start / 97.81 MiB end / 97.81 MiB peak
Audio memory          3.626 GiB start / 3.626 GiB end / 3.626 GiB peak
Minimum MemAvailable  3,364,904 KiB (3.209 GiB)
Minimum free disk     62,009,928 KiB (59.137 GiB)
New OOM kills         0
RestartCount          backend 0 / audio 0
```

Every sample confirmed:

- backend and Audio Service remained running and Docker-healthy;
- Hermes and public `/health` returned HTTP `200`;
- public `/livez`, `/livez/*`, `/readyz`, and `/readyz/*` returned HTTP `404`;
- application listeners remained loopback-only;
- relevant free disk remained above 20 GiB;
- `MemAvailable` remained above 1.5 GiB;
- no runtime model-download indicator appeared;
- no secret/transcript-field indicator appeared in application logs;
- no warning/error match appeared in application logs.

The backend increased by only 0.05 MiB across the soak. Audio memory was flat
at the reporting precision, with one lower intermediate sample. There was no
sustained runaway memory trend.

The complete curated-model state digest matched at the start, midpoint, and
end:

```text
7d06cc38ce51f39ede1070f662329e4f6d7006320d32d07306e2770d5ea422ad
```

The host since-boot `oom_kill` counter was `1` before the soak and remained
`1` afterward. Kernel-journal checks found zero OOM events in the soak window.
The historical counter therefore predates P7 acceptance and is not a new P7
OOM.

## 11. P6 preservation and residual limitations

Preserved P6 guarantees:

- SSH administration remains Tailscale-only;
- public exposure remains Caddy on `80/443`;
- backend, Audio Service, Hermes, and Beszel origins remain loopback/private;
- Hermes remains the P6 host runtime;
- Beszel, Telegram notifications, backup timers, and recovery assets remain
  present;
- no secret was moved into Git;
- the locked hardware interface contract remains unchanged.

Residual non-blocking limitations:

- real RVC inference remains P8 scope; P7 intentionally runs
  `RVC_ENABLED=false`;
- the synthesized E2E fixture does not replace future human-speech quality
  testing or P10 physical hardware acceptance;
- the host has no swap by approved policy;
- same-VPS Beszel monitoring cannot alert during total VPS/network loss;
- one historical since-boot `oom_kill` predates public P7 acceptance and must
  not be classified as a P7 OOM;
- a full VPS reboot was not part of P7 closure;
- P6 rollback assets must remain retained until a separately authorized
  retirement decision.

## 12. Stop condition

Closure classification: `VERIFIED — PRODUCTION`.

Final repository synchronization:

```text
Original P7 evidence commit
e7969e867c3bcc256b30f15736fd705a4a3c719c

Synchronization result
local main == origin/main == live remote main
```

The original P7 evidence commit was pushed and remote-verified. It is a
documentation/evidence commit and does not change running image provenance.
The production application remains built from deployment source
`4d7b472adc4c2243d8f7364032a491ad70efb6d3`, with the immutable image digests
recorded in section 3. Deployment source and later documentation-only
repository HEADs must remain distinct.

Final next phase: P8 `NOT_STARTED / AWAITING EXPLICIT USER AUTHORIZATION`.
P7 completion does not authorize P8. Do not start P8, P9, or P10 from this
evidence update, and do not delete the P6 rollback anchor, protected backups,
or superseded image candidates.
