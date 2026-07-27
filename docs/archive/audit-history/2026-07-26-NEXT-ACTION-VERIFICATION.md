> **SUPERSEDED NOTE (same-day final pass):** Product PRD was subsequently promoted to `v1.2.2` to remove stale active deployment assumptions. Use `2026-07-26-FINAL-REPLACEMENT-CHECK.md` as the final replacement verdict.

# BMO Docs — Next-Action / Agent-Readiness Verification

**Date:** 2026-07-26  
**Result:** PASS  
**Purpose:** verify that the `docs` folder tells a coding/infrastructure agent exactly what to do next without re-deriving project decisions from historical evidence.

## Changes made

Added:

- `NEXT-ACTION.md`
- `roadmap/P6-EXECUTION-SPEC.md`

Updated:

- `README.md`
- `backend-mvp/00-AGENT-EXECUTION-GUIDE.md`
- `backend-mvp/01-SCOPE-AND-DECISIONS.md`
- `backend-mvp/06-DEPLOYMENT-AND-OPERATIONS.md`
- `backend-mvp/IMPLEMENTATION-STATUS.md`
- `backend-mvp/CHANGELOG.md`
- `roadmap/P6-P10-ROADMAP.md`
- `product/BMO-BY-BLABS-PRD-v1.2.1.md` (operator/runtime-role clarification only)

## Agent-readiness checks

- PASS — root docs entry explicitly points Codex to `NEXT-ACTION.md` first.
- PASS — current next phase is explicitly P6 in `NEXT-ACTION.md`, roadmap, execution guide, and implementation status.
- PASS — P6 is `READY`, while P7–P10 remain dependency-gated.
- PASS — P6 has a dedicated ordered execution spec with goal, inputs, non-goals, tasks, acceptance criteria, evidence, approval boundary, and stop condition.
- PASS — agent is instructed to stop after P6 rather than collapse P6–P10 into one long context.
- PASS — Codex is the implementation/infrastructure executor; Hermes is the runtime dependency to preserve.
- PASS — no host Linux `docker` user is required.
- PASS — target deployment root remains `/opt/bmo`; historical `/opt/bmo-mvp` is not an active deployment target.
- PASS — `main` remains the production source branch and production runtime is image-based, not live source bind-mounted.
- PASS — Caddy, Tailscale, Beszel, Telegram, firewall, backup framework, user model, and secrets boundary are explicit P6 decisions.
- PASS — P6 does not silently deploy backend/audio, RVC, PostgreSQL, or physical HW integration; those remain P7/P8/P9/P10.
- PASS — current runtime values remain `WHISPER_MODEL=medium`, hotword `BMO`, Kokoro `af_heart`, speed `0.80`.
- PASS — real RVC remains unverified and assigned to P8.
- PASS — public HW endpoint is not declared usable until P7 verification updates the deployment handoff.

## Contract integrity

`hardware-contract/BMO-MVP-HW-INTERFACE-CONTRACT-v1.0.5.md` was intentionally not modified.

SHA-256 before and after this revision:

```text
633e398a7fa39a3ebc469af7f9ca46fd04890339bb132ec7de2c2286207c6a44
```

Result: PASS — public firmware/backend contract unchanged.

## Documentation integrity

- local Markdown links checked: PASS, 0 broken links;
- secret-pattern scan: PASS, no Telegram bot token/GitHub token/private key pattern found;
- historical evidence remains historical and is not used as next-step authority.

## Expected agent behavior now

When handed this `docs` folder and explicitly instructed to continue/execute the next phase, the agent should:

```text
read NEXT-ACTION.md
→ read P6-EXECUTION-SPEC.md
→ preflight VPS read-only
→ execute only P6
→ audit/fix/verify loop
→ update evidence/status
→ stop
→ report P7 as next
```

The agent should not need to infer the next phase from chat history or P1–P5 evidence.
