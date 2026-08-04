# BMO Post-P8 Storage Cleanup — Phase 1 Evidence

Status: `BMO_STORAGE_CLEANUP_PHASE1_VERIFIED`

Date: 2026-08-03

## Scope and safety

This was the authorized narrow Phase 1 cleanup. Production services were not
stopped or restarted. No Docker prune, volume removal, build-cache cleanup,
Git object cleanup, package cleanup, log cleanup, or Phase 2 cleanup was used.

The active Piper production image and deterministic P7 rollback image were
protected throughout:

| Role | Image |
| --- | --- |
| Active Piper production | `sha256:62ad9adead83d863ab2bf28a2ac75e5a116dc68bab8ff06eec81b7a0407ddb34` |
| Required P7 rollback | `sha256:62d8b48feb978e303831e20dc558cb95d3240af9a3cf09e8dcd0c82142986e7e` |

## Production state

Before and after cleanup, the production Audio container used the active Piper
image above. The final checks showed:

- Audio and Backend containers healthy; Hermes health endpoint returned 200.
- Audio restart count `0`; Backend restart count `0`; `OOMKilled=false`.
- Kernel `oom_kill` remained `6`.
- Public `/health=200`, `/livez=404`, `/readyz=404`.
- Listeners remained loopback-only on `127.0.0.1:3000`, `:8001`, and `:8642`.
- `TTS_PRIMARY_ENGINE=piper`.
- Piper model `en_GB-semaine-medium`, speaker `prudence`, speaker ID `0`.
- Kokoro fallback `af_heart`, speed `0.80`.
- `RVC_ENABLED=false`.
- Audio readiness reported `rvc_available=false` and otherwise loaded STT,
  Kokoro, and FFmpeg; Docker health remained healthy. This degraded readiness
  state is expected while RVC is disabled.

A post-cleanup internal TTS probe returned HTTP 200 with Piper, `X-RVC-Applied:
false`, and a mono 24 kHz 96 kbps MP3. The previously committed P8 evidence
continues to provide the forced Kokoro fallback and Piper recovery proof; no
public fault-injection route exists, and no production fault injection was
created for cleanup.

The P7 rollback verifier passed:

`P7 rollback references, local image, and protected-file hashes verified`

## Pre-cleanup measurements

Immediate pre-delete filesystem snapshot:

| Metric | Bytes |
| --- | ---: |
| Total | 102,888,095,744 |
| Used | 69,073,510,400 |
| Available | 33,797,808,128 |

Immediate pre-delete Docker accounting:

| Type | Total | Active | Size | Reclaimable |
| --- | ---: | ---: | ---: | ---: |
| Images | 38 | 5 | 44.04 GB | 31.85 GB |
| Containers | 5 | 5 | 143.4 kB | 0 B |
| Volumes | 0 | 0 | 0 B | 0 B |
| Build cache | 34 | 0 | 11.76 GB | 2.293 GB |

## Branch backups and worktrees

The previously completed remote backups were re-used and remained equal:

| Branch | Local | Remote |
| --- | --- | --- |
| `feat/p8-rvc-foundation` | `8420d4192a16025f439c040cd7a32a50b41fe52b` | same |
| `feat/p8-piper-feasibility` | `c82b21287d8893a5a090464b6126c5e42e45cd8e` | same |

Removed clean worktrees:

- `/opt/bmo/app/.worktrees/p8-rvc-foundation`
- `/opt/bmo/app/.worktrees/p8-piper-feasibility`

The local branches and remote branches remain. The Piper production worktree
and all P7 worktrees remain.

## Evidence archives

RVC compact evidence:

- Path: `/opt/bmo/archive/p8-rvc/p8-rvc-compact-evidence.tar.gz`
- Archive file size: 273,348 apparent bytes
- SHA-256: `40bf4923b0cfddc0dbb679a2eb34dd11e46721f714c68e18b5148d604d7259e5`
- Archive directory allocated size: 290,816 bytes
- Source: RVC closure commit `8420d4192a16025f439c040cd7a32a50b41fe52b`
- Retained audio was ffprobe-validated; no weights, indexes, archives,
  virtual environments, caches, credentials, or raw environment files were
  included.

Piper feasibility evidence:

- Directory: `/opt/bmo/archive/p8-piper-feasibility`
- Directory allocated size: 18,284,544 bytes
- Canonical bundle: `p8-piper-listening-bundle.tar.gz`
- Canonical bundle size: 17,952,821 apparent bytes
- Canonical bundle SHA-256:
  `41c2e1846dcbf9a93d628fbea24b6f54ae5597942d111be885129dd5d5a2179c`
- Source: feasibility commit `c82b21287d8893a5a090464b6126c5e42e45cd8e`
- `SHA256SUMS`, `ARCHIVE-MANIFEST.json`, README, manifest, benchmark,
  listening guide, blind key, source text, model identity, model card, and
  DFKI license metadata were retained.

Both archive directories are owned by `bmo-admin:bmo-admin` mode `0750`.
Checksums and manifests validate successfully.

## Deleted filesystem targets

Successfully removed:

| Exact path | Apparent bytes reclaimed |
| --- | ---: |
| `/opt/bmo/temp/p8-rvc-benchmark` | 4,612,096 |
| `/opt/bmo/models/rvc` | 8,192 |
| `/opt/bmo/temp/p8-piper-feasibility` | 1,499,971,584 |
| `/opt/bmo/temp/p8-test-deps` | 2,572,288 |

The RVC foundation candidate was partially removed. Its original measured
size was 1,028,481,024 bytes; 63,807,488 bytes remain, consisting of:

- `/opt/bmo/temp/p8-rvc-foundation-candidate/runtime/rvc/bmo/assets/CGO_e420_s2520.pth`
- `/opt/bmo/temp/p8-rvc-foundation-candidate/runtime/rvc/bmo/assets/added_IVF69_Flat_nprobe_1_CGO_v2.index`

The containing directory is mode `0555`, so those exact files could not be
removed by `bmo-admin` without an additional permission change. No permission
change was attempted. Apparent RVC foundation bytes reclaimed: 964,673,536.

The exact RVC canary tree was skipped and remains present:

`/opt/bmo/temp/p8-rvc-canary`

It contains root-owned and UID-10001 mode-0700 subdirectories. Its earlier
readable accounting was 311,296 bytes, but the exact total is uncertain due to
permission-denied subtrees. It requires manual root-owned cleanup review.

Raw successfully deleted filesystem-target bytes, excluding worktree storage,
were 2,471,837,696 bytes. The net filesystem delta also includes worktree
removal, Docker image removal, and retained archive creation.

## Removed Docker images

All removed IDs were individually validated as not referenced by any container
and were removed without a prune command.

RVC images:

- `sha256:cba12d6626dcdd93814a75e0ebb856898d2c4b15ec6c2c11bbba60c4cd9c49e6`
- `sha256:cfb1a3518c05612137712700adc1e657d92322bc3adb319f93659abd866a791e`
- `sha256:6b7a93b2fccb0a6d2254c884d1292857998358bf8ed5b3473c0289987aa54639`

Superseded Piper and historical Audio images:

- `sha256:024f2035e185e2b1b3ee35ae0f30668b5373d5d334fa65a6b5edb47a8ceee367`
- `sha256:5ded520d7d517c5d4601c9c30b35f59a0162167dbe7656dec94a69928c58b307`
- `sha256:bec808af8c211e9ec5e5b336da2e2f31d263b7c6ac6802d7d02f519ee724a76e`
- `sha256:460b7ac9d42cde89347630c959e925c3f4ea1c3c6ffe8e9c1b4d48e51a707b8e`
- `sha256:eceb2e248082515314195751dcaeb6fc10756eb9eaa46819ffe086f58da2807a`
- `sha256:d5c93569295f55e315379d50a1b99729dbb7980c6a43697a085d47801b0b36da`
- `sha256:c6b6f09d1342904da583d8c018df44c072d85b7349fe0e60fd47050676bbe8c7`
- `sha256:26b99d5885472aaac6e82210e0976ee21a1b85f612393e59bb8e017ee4ad3bb3`
- `sha256:1bb9e84caf6dee6422a91cda3399d34c764e0aa6fb32e677c0213058c6431673`
- `sha256:4422990f20421a95852c25de77d804a7eb6c1085c78ab50dd75c3886b75c6402`
- `sha256:bffbc9b8eca938997f4cb57e44f82e3824cc8bd16e42e08ccf4d86a54b75f8f5`
- `sha256:fe805ff97e73abf57a4afd5f4157606b8f3d42991ba55fc16f86a096c7156b51`
- `sha256:8fac2aee588f553b1785357ee6f1dd66c25257d63dbd8f556042997542209d33`
- `sha256:713553ae71c0abeb136cf35b8cd9725806a15adaa3d973dbe65fb24bcfd028a8`
- `sha256:1056972bc5f11fc89283ba826a9e5cb2e2d3ec96695b08be1dcfd39b9fbb54d2`
- `sha256:1e9508d8953c9ec6159ea9345669e897cdf3c029e7f3792c4c121c0e5fc00a5e`
- `sha256:8fcf8772fb53c43af31fe3f434824c179bc288c6926fb40c3f8a64d44d6c4ca3`
- `sha256:4a8b395f29472b3d584494fedc9d455ee461aa2091667d6e397544dc8e3a16d5`
- `sha256:d4ed7232e403e7015d65c0db14524402658dd60377054cd0a33ad517cc741d4f`
- `sha256:2f3448597c8883c3bc178007716f18e889018165f8c3f22864d40851bcb604dd`
- `sha256:a3e80d60e84b2a5f3d112234e902c76b70974295315f584a70926425e15323e9`
- `sha256:7b44e9c1e3cd6e944c30a3ad28b8fe2fe1b049e73aa6bc5d146909df485f20c7`

The duplicate-tag image `fe805...` was removed through its exact tags
`bmo-piper:p8-prudence-candidate` and
`bmo-piper:p8-prudence-candidate-checkpoint`.

## Docker and filesystem results

Final Docker accounting:

| Type | Total | Active | Size | Reclaimable |
| --- | ---: | ---: | ---: | ---: |
| Images | 13 | 5 | 6.522 GB | 3.036 GB |
| Containers | 5 | 5 | 143.4 kB | 0 B |
| Volumes | 0 | 0 | 0 B | 0 B |
| Build cache | 34 | 0 | 11.76 GB | 8.151 GB |

Docker image accounting decreased from 44.04 GB to 6.522 GB. The exact
unique-byte attribution by RVC versus Piper candidates is not recoverable from
post-removal Docker accounting; the three RVC image virtual sizes totaled
3,642,146,722 bytes before deletion. No build-cache bytes were intentionally
removed.

Final filesystem:

| Metric | Bytes |
| --- | ---: |
| Total | 102,888,095,744 |
| Used | 31,147,626,496 |
| Available | 71,723,692,032 |
| Usage | 31% |

Against the immediate pre-delete snapshot, net used-space reduction was
37,925,883,904 bytes. This includes Docker layer reclamation and worktree
removal and is the reliable filesystem-level result; it must not be treated as
the sum of virtual image sizes.

Final sizes:

- `/opt/bmo`: 4,086,763,520 bytes
- `/opt/bmo/models`: 3,793,584,128 bytes
- `/opt/bmo/temp`: 122,507,264 bytes
- `/opt/bmo/archive`: 18,579,456 bytes

## Retained and deferred items

Retained active production and rollback assets:

- final Piper Audio image and exact P7 rollback image;
- running Backend, Telegram, Beszel agent, and Beszel hub images;
- active Piper, Whisper, and Kokoro assets;
- `/opt/bmo/models/hf-cache`;
- `/opt/bmo/temp/p8-piper-production/rollback`;
- `/opt/bmo/temp/p8-github-auth`;
- `/opt/bmo/cache/audio` and `/opt/bmo/temp/tts`;
- Docker build cache, volumes, production containers, and networks.

Deferred Phase 2 items include APT and npm caches, Codex data, `/home/bmo-admin`
local data, logs, build cache, Backend history, P7 branches/worktrees, and the
remaining inaccessible RVC canary/model files.

No open-deleted files were reported by `lsof +L1`.

## Git evidence

Before this evidence addition, local main and remote main were equal at
`eb547a26b51fde6a63a9b6100b7478b932ae5b7a`. This document is the only intended
repository change for the cleanup evidence commit. Production does not require
rebuild or redeployment for this documentation-only change.

The final commit SHA is recorded in the handoff after commit and push.

## Final closure verification

The operator subsequently removed the two previously inaccessible residual
paths:

- `/opt/bmo/temp/p8-rvc-foundation-candidate`
- `/opt/bmo/temp/p8-rvc-canary`

Final verification on 2026-08-04 confirmed:

- both residual paths are absent;
- no RVC runtime path, image, container, process, or mount remains;
- both compact evidence archives and all checksums remain valid;
- the active Piper image and exact P7 rollback image remain unchanged;
- active Piper model hashes remain exact;
- Backend, Audio, and Hermes remain healthy;
- a safe production Piper request returned HTTP 200 and a valid mono 24 kHz
  96 kbps MP3;
- existing committed Kokoro fallback and Piper recovery evidence remains the
  authoritative fallback proof; no unsafe production fault injection was used;
- `RVC_ENABLED=false`, restart counts remain zero, `OOMKilled=false`, and the
  kernel OOM count remains `6`;
- public `/health=200`, `/livez=404`, `/readyz=404`;
- listeners remain loopback-only;
- no open-deleted files were reported.

Additional measured reclaim after the operator cleanup was 64,094,208 bytes.
Final filesystem state is 102,888,095,744 total, 31,083,532,288 used, and
71,787,786,240 available (31%). Final Docker accounting is 13 images,
6.522 GB image storage, 5 active containers, zero volumes, and 11.76 GB build
cache. No additional Docker cleanup was performed.

The separate closure commit is recorded after commit and push verification.
