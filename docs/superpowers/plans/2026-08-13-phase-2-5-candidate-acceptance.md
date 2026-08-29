# Joy Phase 2.5 Candidate Acceptance Plan

> **For agentic workers:** Execute the candidate-only gates with verification checkpoints.

**Goal:** Deploy the Phase 2 source checkpoint into an isolated review runtime, verify core contracts and persistence safety, and stop before production promotion.

**Architecture:** Preserve the active production stack untouched. Use a separately named candidate Backend and candidate PostgreSQL on private/internal resources, with Hermes and Audio Service consumed through the existing designed boundary. Record all provider and physical-device gaps without upgrading their status.

**Tech Stack:** Node 22, TypeScript, Prisma/PostgreSQL 16, Docker Compose, Express/WebSocket, Hermes 0.20.0, Audio Service, Caddy route inspection.

---

### Gate 1: Baseline and source/runtime inventory

- [x] Read canonical integration docs and confirm branch/SHA/worktree.
- [x] Inventory production and candidate services, listeners, dependencies, secrets by metadata only, and Caddy routes.

### Gate 2: Build and Prisma remediation

- [x] Verify Prisma Studio exposure is closed.
- [x] Trace ownership of generated/build artifacts before any targeted ownership repair.
- [x] Run Node 22 build, typecheck, Prisma validate, and Prisma generate on the candidate source path.

### Gate 3: Candidate database safety

- [x] Prove candidate database identity is not production and capture baseline schema/counts.
- [x] Create a candidate backup and restore it into an isolated disposable target.
- [x] Apply the Phase 2 migration exactly once to the candidate and verify schema/data preservation.

### Gate 4: Candidate runtime and acceptance

- [x] Build/recreate candidate-only runtime with protected candidate secrets and no production port overlap.
- [x] Verify health/readiness and run registered-route, REST, mobile WebSocket, device WebSocket, voice, Hermes, Wi-Fi, schedule, proactive, and provider-boundary acceptance.

### Gate 5: Documentation and promotion handoff

- [x] Inspect Caddy promotion diff without activation.
- [x] Update status/coverage evidence, verify production health, document rollback and exact promotion steps.
- [x] Verify commit, final SHA, remote status, and clean worktree before reporting the verdict.
