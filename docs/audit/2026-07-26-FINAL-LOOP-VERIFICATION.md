# BMO Docs — Final Loop Verification

**Date:** 2026-07-26  
**Result:** `PASS — no significant documentation inconsistency found after final loop`  
**Current next phase:** `P6 — VPS Foundation and Operations Baseline`  
**Public deployment status:** `NOT_VERIFIED`

> This report validates the documentation set, not the live VPS or the repository source code. Runtime/deployment claims remain gated by P6/P7/P8/P9/P10 evidence as defined in the docs.

## 1. Audit loops performed

### Loop A — authority and next-action clarity

Verified that:

- `docs/README.md` is the documentation entry point;
- `docs/NEXT-ACTION.md` selects P6 only;
- Codex is the implementation/infrastructure executor;
- Hermes remains an existing host runtime dependency and is not migrated for cosmetic reasons;
- later phases are not silently started from P6;
- historical P1–P5 plans/evidence are clearly labeled as historical and cannot be mistaken for current execution instructions.

### Loop B — implementation status truthfulness

Reconciled P1–P5 status against the available evidence:

```text
P1 → VERIFIED — BACKEND
P2 → VERIFIED — LOCAL FUNCTIONAL
P3 → IMPLEMENTED — not VERIFIED (real RVC inference pending P8)
P4 → VERIFIED — LOCAL FUNCTIONAL
P5 → VERIFIED — BACKEND
```

Removed the misleading blanket statement that P1–P5 were all locally verified.

### Loop C — hardware/backend protocol consistency

Verified the hardware handoff against the canonical Hardware Contract v1.0.5 for:

- `/ws`;
- `POST /api/v1/voice`;
- `GET /audio/:audioId.mp3`;
- WebSocket authentication and close codes;
- all canonical Backend → ESP32 events;
- all canonical ESP32 → Backend events;
- raw WAV upload contract;
- request ID/idempotency;
- one-active-request behavior;
- upload response/error matrix;
- HTTP/WS ordering race;
- MP3 download, expiry, retry and playback completion;
- display ownership;
- reconnect/state synchronization;
- no one-hour/application idle disconnect while ping/pong is healthy;
- file lifecycle;
- error handling.

Canonical Hardware Contract SHA-256 remains:

```text
633e398a7fa39a3ebc469af7f9ca46fd04890339bb132ec7de2c2286207c6a44
```

The active copy is byte-identical to the supplied canonical source.

### Loop D — runtime configuration

Verified current runtime targets consistently across active authority documents:

```text
WHISPER_MODEL=medium
WHISPER_HOTWORDS=BMO
WHISPER_DEVICE=cpu
WHISPER_COMPUTE_TYPE=int8
WHISPER_CPU_THREADS=4
WHISPER_WORKERS=1
WHISPER_BEAM_SIZE=5
WHISPER_VAD=true

KOKORO_LANG_CODE=a
KOKORO_VOICE=af_heart
KOKORO_SPEED=0.80
```

Historical `small`/Kokoro-speed evidence remains available only as historical evidence and is explicitly fenced from current execution authority.

### Loop E — VPS/deployment architecture

Verified the current target includes:

- `main` as production Git source;
- `/opt/bmo/app` as clean production checkout;
- separate config/models/data/temp/backups/deploy paths;
- real secrets outside Git;
- immutable commit-SHA-related Docker application images;
- no production live-source bind mount;
- Caddy as host system service;
- `api.personalbmo.web.id` and `monitor.personalbmo.web.id`;
- Tailscale admin path before public SSH restriction;
- Beszel Hub + local Agent, private origin, public authenticated HTTPS UI;
- fresh Telegram credential supplied out-of-band;
- no Portainer requirement;
- backend host networking + loopback origin for Hermes access;
- Audio Service loopback-only publication;
- PostgreSQL activation deferred to P9.

P6 now also explicitly establishes the Git checkout/auth/fetch baseline without deploying the application.

### Loop F — backup, maintenance and recovery

Verified documentation covers:

```text
weekly config/manifest/deployment backup → 4 weeks
daily DB backup after P9                → 7–14 days
pre-deploy DB backup after P9           → when applicable
monthly off-server bundle               → manual external copy
```

Also verified:

- restore testing requirement;
- reboot checklist;
- service-specific recovery matrix;
- full VPS recovery order;
- DNS-based VPS migration behavior;
- current/previous known-good release preservation;
- safe disk cleanup rules;
- same-VPS monitoring limitation.

### Loop G — phase dependency and handoff semantics

Verified:

```text
P6 → foundation
P7 → deployed backend/audio + public HTTPS/WSS E2E
P8 → real RVC + resource benchmark
P9 → PostgreSQL/Prisma application data readiness
P10 → final physical ESP32 acceptance
```

Important distinction:

- P7 verification may mark `hardware-handoff/DEPLOYMENT-CONFIG.md` as `VERIFIED` and unlock the live endpoint for the hardware team;
- P10 is the final physical hardware acceptance gate, not the first time the endpoint becomes usable;
- P9 is not a hardware voice-protocol dependency;
- before P9 migrations, the schema baseline must be re-audited against the latest approved mobile/auth/device-pairing requirements.

### Loop H — firmware-agent usability

Verified the handoff pack covers the hardware team's requested topics:

1. backend address;
2. Device ID & Token;
3. WAV format;
4. upload endpoint;
5. Backend → ESP32 WebSocket events;
6. ESP32 → Backend events;
7. upload responses;
8. audio download;
9. display/expression ownership;
10. error codes;
11. timeouts;
12. retries;
13. testing;
14. end-to-end flow;
15. state machine;
16. reconnect/idempotency;
17. implementation Do/Don't rules.

Physical test matrix contains **34 unique sequential tests (`HW-AT-001` through `HW-AT-034`)**.

## 2. Automated verification results

Two independent local verification passes were run after the final patches:

```text
baseline verifier : PASS 109 / FAIL 0
semantic verifier : PASS 180 / FAIL 0
Markdown links    : 0 broken
secret scan       : PASS
HW test IDs       : 34 unique, sequential
HW contract hash  : PASS / byte-identical
```

The secret scan includes detection for the previously exposed/revoked Telegram credential pattern and private invite fragment; neither is present in the docs package.

## 3. Runtime-dependent values intentionally unresolved

The following must **not** be guessed in documentation and are intentionally left for their owning execution phase:

- actual current VPS user/service/firewall/package state — P6 preflight;
- approved Git remote and working deploy credential for `bmo-admin` — P6;
- real DNS/TLS reachability — P6/P7 evidence;
- fresh Telegram bot credential and target chat ID — P6, out-of-band;
- exact RVC `.pth` / `.index` filenames and compatible inference runtime — P8;
- real VPS STT/Hermes/Kokoro/RVC latency and resource headroom — P7/P8;
- live public fake-ESP32 E2E result — P7;
- actual PostgreSQL schema after latest mobile/auth/device-pairing re-audit — P9;
- physical ESP32 result — P10.

These are execution evidence gaps, **not documentation ambiguities**.

## 4. Source-code verification limitation and hard gate

The supplied documentation ZIP does not contain the full backend source repository. Therefore this audit cannot honestly claim a fresh line-by-line source-vs-doc verification of the live `main` branch.

To prevent documentation drift from becoming a deployment assumption, P7 contains a hard gate:

```text
fresh source checkout
→ compare routes/events/env/runtime behavior with canonical docs
→ document/block any mismatch
→ only then build/deploy the public backend
```

Do not change the public hardware contract merely to make an implementation mismatch disappear.

## 5. Final assessment

The documentation set is suitable to replace the project `docs/` folder and is sufficiently explicit for:

- Codex to identify and execute P6 without inferring work from old P1–P5 plans;
- a backend/infrastructure developer to understand the current architecture and phase boundaries;
- the hardware team to implement firmware before the public endpoint is live;
- a firmware coding agent to implement against the canonical backend contract without reading backend source;
- later phases to update only runtime/deployment evidence without inventing a second hardware protocol.

No significant documentation inconsistency remained at the end of the final audit loop.
