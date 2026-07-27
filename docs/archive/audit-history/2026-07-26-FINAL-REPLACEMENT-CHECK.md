# Final Replacement Check — 2026-07-26

Purpose: verify the docs package is safe to replace the project `docs/` directory and that a coding agent sees P6 as the next action without being misled by stale active product deployment text.

## Findings fixed in this pass

- Active PRD v1.2.1 still contained historical `/opt/bmo-mvp`, public-IP staging examples, generic `api.<domain>`, old single-phase deployment assumptions, and stale sprint checklists.
- This conflicted with the current operational P6–P10 docs even though `NEXT-ACTION.md` itself was correct.

## Resolution

- Archived PRD v1.2.1.
- Promoted current product context to PRD v1.2.2.
- Synced PRD deployment context to `/opt/bmo`, `main`, Caddy, `api.personalbmo.web.id`, `monitor.personalbmo.web.id`, Tailscale, Beszel/Telegram, backup/rollback, and P6–P10 ownership.
- Preserved Hardware Contract v1.0.5 unchanged.
- Preserved runtime target `medium` + hotword `BMO` and Kokoro `af_heart` speed `0.80`.
- Preserved P6 as the only current next execution phase; P7–P10 remain dependency-gated.

## Replacement verdict

`READY TO REPLACE PROJECT docs/` after integrity/link/secret checks in the generated package.
