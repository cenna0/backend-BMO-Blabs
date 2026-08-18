# BMO Repository Bootstrap

Repository ini adalah source of truth production. Branch deployment: `main`.

Repository orientation starts at `docs/README.md`; the current Mobile work
starts at the live-production integration package:

1. [`docs/README.md`](docs/README.md)
2. [`docs/NEXT-ACTION.md`](docs/NEXT-ACTION.md)
3. [`docs/integration/00-START-HERE.md`](docs/integration/00-START-HERE.md)
4. [`docs/integration/01-MOBILE-BACKEND-API-CONTRACT.md`](docs/integration/01-MOBILE-BACKEND-API-CONTRACT.md)
5. [`docs/integration/05-IMPLEMENTATION-STATUS.md`](docs/integration/05-IMPLEMENTATION-STATUS.md)
6. [`docs/integration/09-ENDPOINT-EVENT-COVERAGE-MATRIX.md`](docs/integration/09-ENDPOINT-EVENT-COVERAGE-MATRIX.md)

The following repository control records remain in the entry chain for
historical/runtime context, not as Mobile implementation instructions:

7. [`docs/roadmap/P8-EXECUTION-SPEC.md`](docs/roadmap/P8-EXECUTION-SPEC.md)
8. [`docs/backend-mvp/IMPLEMENTATION-STATUS.md`](docs/backend-mvp/IMPLEMENTATION-STATUS.md)

The current Phase 2 contract linked by those entrypoints starts at
[`docs/integration/00-START-HERE.md`](docs/integration/00-START-HERE.md).

Current canonical references:

- Integration PRD: [`docs/product/BMO-BY-BLABS-PRD-v1.4.0.md`](docs/product/BMO-BY-BLABS-PRD-v1.4.0.md)
- Locked historical PRD: [`docs/product/BMO-BY-BLABS-PRD-v1.2.4.md`](docs/product/BMO-BY-BLABS-PRD-v1.2.4.md)
- Hardware contract: [`docs/hardware-contract/BMO-MVP-HW-INTERFACE-CONTRACT-v1.0.5.md`](docs/hardware-contract/BMO-MVP-HW-INTERFACE-CONTRACT-v1.0.5.md)
- Verified runtime baseline: [`docs/backend-mvp/CURRENT-RUNTIME-CONFIG.md`](docs/backend-mvp/CURRENT-RUNTIME-CONFIG.md)
- Implementation status: [`docs/backend-mvp/IMPLEMENTATION-STATUS.md`](docs/backend-mvp/IMPLEMENTATION-STATUS.md)

Rules:

- Active docs override historical/archive evidence.
- P6 is `VERIFIED`; P7 is `VERIFIED — PRODUCTION`. See
  [`docs/backend-mvp/P7-TEST-EVIDENCE.md`](docs/backend-mvp/P7-TEST-EVIDENCE.md).
- P8 is `VERIFIED — PRODUCTION`: Piper Prudence is primary, Kokoro `af_heart`
  at speed `0.80` is fallback, and `RVC_ENABLED=false` remains locked.
- P9 production is live. Mobile uses `https://api.personalbmo.web.id` and
  `wss://api.personalbmo.web.id/api/v1/ws`; the hardware contract remains
  `wss://api.personalbmo.web.id/ws`. Start Mobile work at
  `docs/integration/00-START-HERE.md`.
- The public hardware endpoint is live and verified. Physical ESP32 acceptance
  remains pending P10. RVC runtime artifacts are removed from production and
  retained only as archived evidence/history.
- [`docs/roadmap/P6-EXECUTION-SPEC.md`](docs/roadmap/P6-EXECUTION-SPEC.md)
  remains the historical locked P6 record, not the current execution contract.
- Do not deploy, migrate production, or change the locked hardware voice contract
  without explicit authorization. Additive ESP work remains physical-evidence gated.
- Never commit real secrets. Copy the root `.env.*.example` templates to runtime config outside Git.

Repository verification:

```text
python3 scripts/verify-backend-mvp-docs.py
```
