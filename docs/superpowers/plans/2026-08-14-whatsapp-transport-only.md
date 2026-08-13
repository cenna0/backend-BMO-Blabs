# WhatsApp Transport-Only Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run the installed Hermes 0.20.0 Baileys bridge as a private, transport-only process while the BMO Backend remains the sole `/messages` consumer and authoritative owner of inbound policy.

**Architecture:** A dedicated `bmo-whatsapp-bridge.service` launches the unchanged official `bridge.js` as `hermes` on loopback `127.0.0.1:3001`, with stdout/stderr discarded because startup output includes allowlisted identities. Its health endpoint and systemd state provide observability; its internal reconnect loop remains authoritative. BMO reads only `/messages`, applies a fail-closed exact sender allowlist and an unconditional pre-persistence group drop, then owns deduplication, user mapping, notification rules, and generic proactive delivery.

**Tech Stack:** TypeScript, Zod, Vitest, Hermes 0.20.0 Node bridge, systemd unit template, shell launcher, Markdown integration docs.

---

### Task 1: Lock the policy contract with failing tests

**Files:**
- Modify: `backend/tests/p9/hermes-whatsapp-client.unit.test.ts`
- Modify: `backend/tests/p9/whatsapp.integration.service.unit.test.ts`
- Modify: `backend/tests/p9/config.test.ts`
- Create: `backend/tests/p9/whatsapp-transport-boundary.unit.test.ts`

- [x] Add tests for exact allowlisted DM acceptance, unauthorized DM rejection, and fail-closed empty/wildcard configuration.
- [x] Replace the existing group notification-rule test with tests proving an allowlisted group is dropped before persistence, notification lookup, inbound callback, and proactive creation.
- [x] Add a static invariant test proving production source contains one `/messages` consumer and the dedicated bridge launcher/unit contains no `/messages` polling.
- [x] Run the focused tests and confirm they fail because the allowlist and hard group guard are not implemented.

### Task 2: Implement Backend allowlist and authoritative group guard

**Files:**
- Modify: `backend/src/p9/config.ts`
- Modify: `backend/src/p9/index.ts`
- Modify: `backend/src/p9/providers/hermes-whatsapp.client.ts`
- Modify: `backend/src/p9/services/integration.service.ts`

- [x] Parse `WHATSAPP_ALLOWED_USERS` as a protected comma-separated exact-ID list, reject empty entries and `*`, and default to an empty fail-closed set.
- [x] Pass the configured list to the Hermes client and filter unauthorized DMs before BMO intake; retain group events long enough for the service’s authoritative pre-persistence drop.
- [x] Drop `message.isGroup === true` before owner lookup, duplicate lookup, persistence, notification rule evaluation, and proactive enqueue.
- [x] Keep outbound `/send` and loopback validation unchanged.
- [x] Run the focused tests and confirm all policy tests pass.

### Task 3: Add the supervised transport-only runtime source

**Files:**
- Create: `ops/whatsapp/bmo-whatsapp-bridge-launcher`
- Create: `ops/whatsapp/systemd/bmo-whatsapp-bridge.service`
- Modify: `backend/tests/p9/whatsapp-transport-boundary.unit.test.ts`

- [x] Make the launcher read only the WhatsApp keys it needs from Hermes `.env`, fail closed unless `WHATSAPP_ENABLED=false`, mode is `bot`, and a non-wildcard allowlist exists, then exec the unchanged official Node bridge with `--port 3001 --session /home/hermes/.hermes/whatsapp/session --mode bot`.
- [x] Resolve the official installed bridge path from the two upstream-supported install locations without copying or patching Baileys.
- [x] Define a unit with `User=hermes`, no Hermes gateway dependency, bounded crash restart and start-limit settings, loopback-only process arguments, `RestartPreventExitStatus=78`, and no stdout/stderr persistence.
- [x] Add source tests for unit hardening, no second `/messages` consumer, internal reconnect ownership, and no active Caddy/systemd mutation in the implementation.

### Task 4: Synchronize integration documentation

**Files:**
- Modify: `docs/p9/17-whatsapp-integration.md`
- Modify: `docs/integration/05-IMPLEMENTATION-STATUS.md`
- Modify: `docs/integration/09-ENDPOINT-EVENT-COVERAGE-MATRIX.md`

- [x] Record the transport-only architecture, protected allowlist requirement, hard group-drop evidence, startup-log privacy design, and exact operator-only install/pair/rollback commands without provider identities or session material.
- [x] Keep live WhatsApp acceptance `BLOCKED_OPERATOR` until the dedicated bridge is installed and QR pairing is completed.
- [x] Keep physical proactive playback `PENDING_PHYSICAL_ESP` and production verification absent.

### Task 5: Verify candidate-only state

**Files:**
- No runtime production files or active service configuration.

- [x] Run focused WhatsApp tests, full P9 suite, typecheck, build, Prisma validate, and documentation verification available in the repository.
- [x] Re-check branch/SHA/status, Hermes health/version, candidate/production health, listener 3001, Docker port publication, Caddy config references, and shared Hermes gateway state.
- [x] Return exact proposed unit, future install/uninstall/rollback commands, official pairing command, protected preflight checks, and the operator STOP boundary. Do not install, start, pair, restart Hermes, or mutate Caddy.
