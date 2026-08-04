# BMO — P6–P10 Infrastructure and Hardware Readiness Roadmap

**Status:** LOCKED ROADMAP / PHASE-BY-PHASE EXECUTION  
**Current next phase:** P9.1 — `ARCHITECTURE LOCKED; NOT_STARTED / AWAITING EXPLICIT USER AUTHORIZATION`
**Reason for split:** the original P6 scope became too broad after adding full VPS foundation, public TLS, monitoring, real RVC, database readiness, backup/recovery, and hardware handoff.

The split below follows dependencies, not equal workload. The current coding
agent must use [`../NEXT-ACTION.md`](../NEXT-ACTION.md) and
[`P8-EXECUTION-SPEC.md`](P8-EXECUTION-SPEC.md) for the next action.
[`P6-EXECUTION-SPEC.md`](P6-EXECUTION-SPEC.md) remains the locked historical P6
record.

**Execution rule:** locked order is **P6 → P7 → P8 → P9.1 → P9.2 → P9.3 → P9.4 → P9.5 → P9.6 → P10**. Verify one phase, record evidence, stop, then load the next phase in a fresh execution turn. Technical dependencies listed below explain architecture; they do not authorize skipping the execution order.

## P6 — VPS Foundation and Operations Baseline

**Phase status:** `VERIFIED` — see
[`../backend-mvp/P6-TEST-EVIDENCE.md`](../backend-mvp/P6-TEST-EVIDENCE.md).

### Goal
Prepare a safe, repeatable VPS foundation without yet claiming the BMO voice stack is publicly ready.

### Inputs
- existing VPS;
- Hermes preflight state may be present or absent;
- existing Codex installation when available;
- `personalbmo.web.id` DNS ownership;
- production source branch `main`.

### Scope
- preflight audit;
- classify Hermes from recorded evidence; preserve it when present; bootstrap it when absent;
- keep Hermes as a host runtime, bind only to `127.0.0.1:8642`, and record actual user/paths/startup/recovery evidence;
- create/confirm `bmo-admin` operating model and Codex access from that account;
- install/configure Docker Engine + Compose if absent;
- create `/opt/bmo` layout/ownership including persistent `MODEL_MANIFEST.md`;
- config/secret separation;
- Caddy baseline;
- DNS/TLS preparation;
- Tailscale admin access setup and SSH migration verification;
- firewall baseline;
- Beszel + public authenticated `monitor.personalbmo.web.id`;
- Telegram alert integration using VPS-held secret;
- Docker log rotation/resource observability;
- backup directories/schedules and restore procedure draft;
- maintenance/update/recovery runbook + verified version inventory.

### Output
- stable VPS foundation;
- documented service inventory including the actual Hermes runtime user, install/config/data paths, startup/service mechanism, and recovery/start procedure;
- working private admin access before public SSH restriction;
- Caddy/Beszel foundation;
- deployment/rollback scripts or documented commands.

### Acceptance criteria
- a present Hermes installation remains healthy without cosmetic reinstall/migration;
- an absent Hermes installation is bootstrapped/configured as a maintainable host runtime;
- Hermes health passes, listener is only `127.0.0.1:8642`, and no public `:8642` exposure exists;
- Hermes restart behavior is verified and reboot/autostart behavior is checked where safely possible;
- Docker/Compose works;
- `/opt/bmo` ownership/permissions verified;
- secrets are outside Git and mode-restricted;
- public exposure is limited to approved reverse-proxy ports;
- Tailscale SSH path is tested before public SSH is restricted;
- Beszel is reachable through HTTPS/login and can alert Telegram;
- backup mechanism can create a test artifact;
- no BMO API availability claim yet unless P7 also passes.

### Dependency
None beyond safe access to the existing VPS and explicit authorization for risky network changes.

---

## P7 — Deploy Backend + Audio Service + Hermes Integration

**Phase status:** `VERIFIED — PRODUCTION` — see
[`../backend-mvp/P7-TEST-EVIDENCE.md`](../backend-mvp/P7-TEST-EVIDENCE.md).

### Verified result

- deployment source:
  `4d7b472adc4c2243d8f7364032a491ad70efb6d3`;
- immutable backend/audio image digests are recorded in the P7 evidence;
- public HTTPS/WSS endpoint `api.personalbmo.web.id` is live and verified;
- public fake-ESP32 acceptance passed `23/23`;
- production/resource soak passed and P7 closure is complete;
- `hardware-handoff/DEPLOYMENT-CONFIG.md` is verified, unlocking the live
  endpoint for hardware integration work without claiming physical ESP32
  acceptance.

### Goal
Run the existing backend/audio implementation on the real VPS and expose it safely through the production API hostname.

### Inputs
- P6 verified foundation;
- Git repository reachable;
- `main` deployment source;
- runtime secrets supplied out-of-band;
- P6-verified Hermes host API healthy on `127.0.0.1:8642`.

### Scope
- verify/fetch the P6-established `/opt/bmo/app` Git checkout and select the exact `main` commit to deploy;
- fresh source-vs-doc contract audit before deployment: routes/events/env behavior must match the canonical HW contract and current runtime docs; block/document any conflict before changing public behavior;
- build immutable backend/audio images with restart/health readiness policy;
- preserve/test the target topology: backend host networking + loopback `:3000`, Audio Service loopback publish `:8001`, Hermes host loopback `:8642`;
- configure `backend.env` and `audio.env`;
- persistent model caches;
- run backend/audio containers as non-root where possible;
- connect backend → Hermes host service;
- P7 integrates backend/audio with Hermes; it does not perform initial Hermes installation.
- Caddy route `api.personalbmo.web.id`;
- HTTPS/WSS public smoke tests;
- fake ESP32 E2E over public domain;
- measure baseline CPU/RAM/disk/latency;
- update hardware deployment config only if verified.

### Output
- deployed backend/audio stack;
- public WSS/HTTPS endpoints;
- deployment commit SHA;
- health and E2E evidence;
- rollback evidence/commands;
- `hardware-handoff/DEPLOYMENT-CONFIG.md` updated to `VERIFIED` only if the public fake-ESP32 gate passes, which allows the HW team to begin live endpoint integration before final P10 physical acceptance.

### Acceptance criteria
- `https://api.personalbmo.web.id/health` works through Caddy;
- WSS auth works through public hostname;
- valid WAV upload returns canonical response;
- `thinking` and `audio_ready` work through WSS;
- MP3 download works through HTTPS;
- fake ESP32 sends completion successfully;
- internal ports are not publicly reachable;
- Hermes remains healthy;
- regression tests pass in the deployment environment.

### Dependency
P6 — satisfied.

---

## P8 — Fixed Piper Production TTS and RVC Boundary

**Phase status:** `VERIFIED — PRODUCTION`
**Classification:** `P8_PIPER_PRODUCTION_VERIFIED`

Closure and execution record:
[`P8-EXECUTION-SPEC.md`](P8-EXECUTION-SPEC.md).

### Goal and verified result
Deploy one fixed Piper Prudence primary voice with Kokoro fallback while
preserving the public contract. RVC was intentionally not deployed because
the archived experimental branch remains host-capacity blocked.

### Inputs
- P7 deployed Audio Service;
- verified RVC asset revision/hash;
- candidate future layout `/opt/bmo/models/rvc/bmo/`, subject to P8 audit; this
  path was not provisioned or resolved by P7.

### Scope
- fixed Piper `en_GB-semaine-medium`, `prudence`, speaker `0`;
- automatic Kokoro `af_heart` / `0.80` fallback;
- offline pinned assets, integrated persistent worker, resource controls;
- production replacement canary, public regression, failure/shutdown tests,
  and bounded soak;
- preserve `RVC_ENABLED=false` and the RVC archived evidence.

### Output
- fixed Piper production runtime and manifest/path/config;
- fallback/recovery and resource evidence;
- production rollout and rollback evidence;
- RVC documented as unverified/archived, with no public contract change.

### Acceptance criteria
- Piper Prudence is the fixed primary and operator-approved;
- Kokoro fallback succeeds after bounded Piper failures;
- model files are not re-downloaded on routine restart;
- output remains compatible with the hardware MP3 contract;
- public API, WebSocket, hardware events, IDs, lifecycle, and errors remain
  unchanged;
- RVC remains disabled.

### Dependency
P7 — satisfied. Prompt 5 authorization and all closure gates — satisfied.

---

## P9 — PostgreSQL + Prisma Ready-to-Use Data Layer

**Phase status:** `P9.1 ARCHITECTURE LOCKED / P9 implementation NOT_STARTED`

### Goal
Prepare the application database for mobile/user/device/integration work without moving MVP voice request state into PostgreSQL.

### Inputs
- P6 foundation;
- application schema baseline from this PRD;
- the approved P9.1 mobile/auth/device-pairing/settings decisions in `docs/p9/`;
- backup storage policy.

### Scope
- P9.1: PostgreSQL, Prisma, auth, users, devices, pairing, and settings foundation;
- P9.2: chat sessions/messages, voice transcripts, curated memory,
  `PostgresMemoryGateway`, deletion, and export;
- P9.3: schedules, schedule runs, delivery attempts, worker, reminders,
  alarms, and additive proactive-device delivery proposal;
- P9.4: Spotify OAuth, encrypted tokens, playback actions, and mobile status;
- P9.5: WhatsApp connection/rules, confirmation, and Hermes session recovery;
- P9.6: security hardening, backup/restore, observability, resource/load tests,
  rollout/rollback rehearsal, and final acceptance.

The detailed architecture, preliminary schema, entity/API mapping, and gates
are [`../p9/README.md`](../p9/README.md). P9.1 is architecture-locked but
implementation still requires explicit authorization. This roadmap entry does
not authorize implementation, PostgreSQL installation, or migrations.

### Output
- ready database service;
- migration workflow;
- backup/restore evidence.

### Acceptance criteria
- each authorized P9 subphase passes its own documented gate;
- DB survives container restart/recreate once P9.1 is implemented;
- migration procedure is reproducible and restore-tested;
- port 5432 is not public;
- voice request store remains in-memory;
- chat history and curated memory remain separate;
- scheduler is not represented as memory;
- Spotify/WhatsApp credentials remain Backend-owned;
- Hardware Contract v1.0.5 remains unchanged.

### Dependency
Technical dependency: P6. **Execution order:** run P9 only after P8 has a
completed/verified status and P9 receives explicit authorization; do not
reinterpret P7 verification as permission to skip P8 and execute P9.

---

## P10 — Hardware Handoff Activation and Physical Integration

**Phase status:** `NOT_STARTED / dependency-gated after P9`

### Goal
Convert the documentation pack from protocol-ready to live-endpoint-ready and prove the physical ESP32 against the deployed backend.

### Inputs
- P7 public endpoint verified;
- P8 result recorded (RVC success is not required for protocol because Kokoro fallback is valid);
- P9 database-readiness phase verified per the locked execution sequence;
- firmware team receives device token securely;
- `docs/hardware-handoff/` finalized.

### Scope
- confirm the P7-verified `DEPLOYMENT-CONFIG.md` still matches the live deployment, then update its physical-ESP32 status/evidence;
- re-run fake ESP32 through the exact public domain;
- hand off concise docs to hardware team;
- execute physical acceptance matrix;
- capture firmware build ID/request IDs;
- resolve any true backend/firmware mismatch through canonical contract authority.

### Output
- final hardware handoff pack;
- physical integration evidence;
- endpoint sheet usable by humans and coding agents.

### Acceptance criteria
- all public routes/events/payloads match canonical contract;
- physical ESP32 authenticates, uploads WAV, receives state/result, downloads/plays MP3, reports completion;
- reconnect/idempotency/error cases pass;
- hardware does not depend on internal backend service endpoints;
- `HARDWARE INTEGRATION VERIFIED` is only declared with physical evidence.

### Dependency
Technical dependency: P7 + documented P8 status. P9 is **not** a hardware voice-protocol dependency. The currently selected project execution order places P9 before final P10, but P7 verification already unlocks the live endpoint for the HW team; P10 is the final physical acceptance gate.
