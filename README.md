# BMO Repository Bootstrap

Repository ini adalah source of truth production. Branch deployment: `main`.

Coding agent wajib mulai dari:

1. [`docs/README.md`](docs/README.md)
2. [`docs/NEXT-ACTION.md`](docs/NEXT-ACTION.md)
3. [`docs/roadmap/P8-EXECUTION-SPEC.md`](docs/roadmap/P8-EXECUTION-SPEC.md)
4. [`docs/backend-mvp/IMPLEMENTATION-STATUS.md`](docs/backend-mvp/IMPLEMENTATION-STATUS.md)

Current canonical references:

- PRD: [`docs/product/BMO-BY-BLABS-PRD-v1.2.4.md`](docs/product/BMO-BY-BLABS-PRD-v1.2.4.md)
- Hardware contract: [`docs/hardware-contract/BMO-MVP-HW-INTERFACE-CONTRACT-v1.0.5.md`](docs/hardware-contract/BMO-MVP-HW-INTERFACE-CONTRACT-v1.0.5.md)
- Verified runtime baseline: [`docs/backend-mvp/CURRENT-RUNTIME-CONFIG.md`](docs/backend-mvp/CURRENT-RUNTIME-CONFIG.md)
- Implementation status: [`docs/backend-mvp/IMPLEMENTATION-STATUS.md`](docs/backend-mvp/IMPLEMENTATION-STATUS.md)

Rules:

- Active docs override historical/archive evidence.
- P6 is `VERIFIED`; P7 is `VERIFIED — PRODUCTION`. See
  [`docs/backend-mvp/P7-TEST-EVIDENCE.md`](docs/backend-mvp/P7-TEST-EVIDENCE.md).
- P8 is `VERIFIED — PRODUCTION`: Piper Prudence is primary, Kokoro `af_heart`
  at speed `0.80` is fallback, and `RVC_ENABLED=false` remains locked.
- P9.1 architecture is approved and locked under `docs/p9/`; P9 implementation
  remains `NOT_STARTED / AWAITING EXPLICIT USER AUTHORIZATION`. P10 remains
  dependency-gated.
- The public hardware endpoint is live and verified. Physical ESP32 acceptance
  remains pending P10. RVC runtime artifacts are removed from production and
  retained only as archived evidence/history.
- [`docs/roadmap/P6-EXECUTION-SPEC.md`](docs/roadmap/P6-EXECUTION-SPEC.md)
  remains the historical locked P6 record, not the current execution contract.
- Do not start P8–P10 or change locked hardware/backend contracts without explicit phase authorization.
- Never commit real secrets. Copy the root `.env.*.example` templates to runtime config outside Git.

Repository verification:

```text
python3 scripts/verify-backend-mvp-docs.py
```
