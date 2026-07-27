# BMO Docs — Final Second-Pass Verification

**Date:** 2026-07-26  
**Result:** PASS

## Why this pass was run

Fresh second-pass review focused on replacing the project `docs/` folder and making the next coding-agent action deterministic.

## Additional issues found and fixed in this pass

1. Reconciled P6 authorization semantics: explicit `execute P6` / `continue next phase` authorizes planned non-destructive P6 installs/configuration, while destructive/unexpected actions still require separate approval.
2. Removed secret-file permission ambiguity: baseline `bmo-admin:bmo-admin`, mode `600`; stricter root ownership is allowed only with a proven sudo deploy path.
3. Clarified PostgreSQL, real `postgres.env`, and `DATABASE_URL` activate in P9; P7 voice deployment must not depend on DB.
4. Locked Caddy as a host system service for deterministic access to loopback-only origins.
5. Added `/opt/bmo/deploy/infra-compose.yml` as P6 Compose source for Beszel/infra-only containers.
6. Required Git-commit-SHA image identity for deterministic P7 rollback.
7. Added production ESP32 TLS prerequisite: trustworthy time (NTP/SNTP) + certificate-chain validation; never disable TLS verification.
8. Promoted active PRD to v1.2.3 and archived v1.2.2 so filename/version stay truthful.

## Automated consistency checks

- Required docs present: PASS
- Markdown local links: PASS (0 broken)
- Runtime (`medium`, hotword `BMO`, CPU INT8/4 threads/1 worker/beam 5/VAD, Kokoro `af_heart` speed `0.80`): PASS
- Handoff endpoint set present: PASS
- Handoff event set present: PASS
- Firmware TLS prerequisite present: PASS
- P6 current `READY` phase + P7 auto-start forbidden: PASS
- P6 operations aligned (Caddy/Tailscale/Beszel/permissions/infra Compose): PASS
- Deployment doc aligned with P9-only DB + SHA-tag rollback: PASS
- Active stale PRD v1.2.2 references: PASS
- Previously exposed Telegram token/invite markers absent: PASS
- Hardware Contract v1.0.5 unchanged vs original upload: PASS
  - packaged SHA256: `633e398a7fa39a3ebc469af7f9ca46fd04890339bb132ec7de2c2286207c6a44`
  - original SHA256: `633e398a7fa39a3ebc469af7f9ca46fd04890339bb132ec7de2c2286207c6a44`

## Expected external inputs — not documentation gaps

These must be discovered/supplied during execution, not invented in docs:

- actual VPS users/services/listeners/firewall state;
- current Git remote and working auth/deploy key for `bmo-admin`;
- replacement Telegram bot token and numeric group chat ID, supplied out-of-band;
- real DNS/TLS reachability evidence;
- actual RVC extracted `.pth` / `.index` filenames and real inference result;
- public `api.personalbmo.web.id` E2E evidence;
- physical ESP32 acceptance evidence.

## Final conclusion

The folder is ready to replace the project `docs/` directory. Codex should start from `docs/README.md` and `docs/NEXT-ACTION.md`, execute only P6 after explicit authorization, write evidence, and stop before P7.
