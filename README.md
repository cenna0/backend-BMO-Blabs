# BMO Repository Bootstrap

Repository ini adalah source of truth production. Branch deployment: `main`.

Coding agent wajib mulai dari:

1. [`docs/README.md`](docs/README.md)
2. [`docs/NEXT-ACTION.md`](docs/NEXT-ACTION.md)
3. [`docs/roadmap/P6-EXECUTION-SPEC.md`](docs/roadmap/P6-EXECUTION-SPEC.md)

Current canonical references:

- PRD: [`docs/product/BMO-BY-BLABS-PRD-v1.2.4.md`](docs/product/BMO-BY-BLABS-PRD-v1.2.4.md)
- Hardware contract: [`docs/hardware-contract/BMO-MVP-HW-INTERFACE-CONTRACT-v1.0.5.md`](docs/hardware-contract/BMO-MVP-HW-INTERFACE-CONTRACT-v1.0.5.md)
- Runtime target: [`docs/backend-mvp/CURRENT-RUNTIME-CONFIG.md`](docs/backend-mvp/CURRENT-RUNTIME-CONFIG.md)
- Implementation status: [`docs/backend-mvp/IMPLEMENTATION-STATUS.md`](docs/backend-mvp/IMPLEMENTATION-STATUS.md)

Rules:

- Active docs override historical/archive evidence.
- P6 is `VERIFIED`; P7 is next but remains `NOT_STARTED` until separately
  authorized. See
  [`docs/backend-mvp/P6-TEST-EVIDENCE.md`](docs/backend-mvp/P6-TEST-EVIDENCE.md).
- Do not start P7–P10, deploy, or change locked hardware/backend contracts without explicit phase authorization.
- Never commit real secrets. Copy the root `.env.*.example` templates to runtime config outside Git.

Repository verification:

```text
python3 scripts/verify-backend-mvp-docs.py
```
