# BMO VPS — Maintenance and Recovery Runbook

**Status:** CURRENT OPERATIONAL TARGET  
**Owner:** `bmo-admin` / Codex when explicitly authorized  
**Applies from:** P6 foundation onward; service-specific steps activate when the related phase is deployed.

> Purpose: make routine maintenance and recovery deterministic. Do not improvise destructive fixes on the VPS. Record the state before changing it, preserve a proven Hermes installation, bootstrap it only when evidence shows it is absent, and use the latest verified deployment record as the rollback anchor.

## 1. Authority and safety

- `docs/NEXT-ACTION.md` decides the active phase.
- `docs/backend-mvp/06-DEPLOYMENT-AND-OPERATIONS.md` defines the deployment target.
- Public firmware/backend behavior remains governed by the canonical hardware contract.
- Never delete data, volumes, users, or unrelated services just to make a health check green.
- **Hermes present:** never reinstall/change/migrate its proven ownership, config, data, path, or listener merely for cleanliness.
- **Hermes absent:** P6 may bootstrap the host runtime under the conditional path in `P6-EXECUTION-SPEC.md`; do not defer that bootstrap to P7.
- Hermes must remain a host runtime bound only to `127.0.0.1:8642`.
- Never close the only known-good SSH path.
- Before a risky maintenance action, capture current versions, service state, disk/RAM, current deployed commit/image, and a relevant backup when applicable.

## 2. Maintenance cadence

Baseline cadence:

```text
Continuous    → Beszel monitoring + Telegram alerts
Weekly        → inspect alerts, disk headroom, failed services, backup results, certificate/reverse-proxy health
Monthly       → planned maintenance window + manual off-server recovery bundle
As needed     → critical security fixes after backup/risk review; do not wait for monthly window if exposure is material
Pre-deploy    → record current release + backup DB once DB exists + verify rollback target
```

P6 may refine exact scheduling after the real VPS audit, but it must not silently remove these controls.

## 3. Update policy

### OS / host packages

- Prefer security/stability updates over feature churn.
- Do not perform blind full upgrades while a production path is unverified.
- Record packages/kernel that changed.
- If a kernel/host update requires reboot, schedule it, keep a recovery SSH path, and run the post-reboot checklist below.
- Automatic **major** upgrades are not allowed. If unattended security updates already exist, audit their scope before keeping/changing them.

### Docker / Compose / Caddy / Tailscale / Beszel

- Pin/document the version actually verified in P6; do not rely on an untracked floating `latest` state for long-term production.
- Update one infrastructure layer at a time.
- For Beszel, use a tested Hub + Agent topology and pin the release/tag/digest used by `infra-compose.yml` after verification.
- After each update: health check, login/access test, monitoring visibility, and rollback availability.
- Preserve the current and previous known-good application images/releases. Reclaim Docker build cache/old images only after identifying them as unreferenced/disposable; do not use blind mass-prune as routine maintenance.

### BMO application dependencies

- Dependency changes happen in Git, pass tests, merge to `main`, then deploy via immutable commit-SHA-tagged images.
- Do not run ad-hoc `npm update`, `pip install -U`, or equivalent on the production host/container and leave that as untracked state.

### AI/model assets

- Whisper/Kokoro/RVC/model runtime changes are deliberate releases, not routine unattended updates.
- Record source, exact revision/file, size, and SHA-256 in the model manifest.
- Never replace RVC weights or runtime in place without P8-style inference/fallback/resource verification.

## 4. Backup policy and scheduler

P6 activates the **config/manifest/deployment metadata** backup path. PostgreSQL backup jobs activate only in P9.

```text
Weekly config/manifest/deployment backup → retain 4 weeks
PostgreSQL daily (P9+)                  → retain 7–14 days
Pre-deploy DB backup (P9+)              → before migration/significant deploy
Monthly off-server bundle               → manual copy outside VPS (`monthly off-server` recovery step)
```

Default scheduler: use `systemd` timers when no existing healthy project scheduler is already in place. If the VPS already uses another reliable scheduler, preserve it and document the choice instead of creating duplicate jobs.

Backup material containing `.env`, Beszel data, notification credentials, database dumps, or other secrets must be access-restricted and encrypted/protected for off-server storage.

Beszel data should be included in the weekly recovery set if practical because it may contain monitoring configuration/history. Treat it as sensitive. P6 must also inventory the actual Hermes runtime user, install/config/data paths, and startup/service mechanism, then document what is backup-worthy/portable. If copied, protect it as sensitive and do not alter a working Hermes installation.

A backup is not considered verified until a restore procedure has been exercised against a safe test location/service. Git/deploy SSH credentials, Tailscale machine credentials, and other host identity secrets should normally be re-provisioned out-of-band during recovery rather than copied into a general backup bundle unless an explicitly encrypted credential-backup process is approved.

## 5. Post-reboot checklist

After an intentional or unexpected VPS reboot, verify in order:

```text
1. SSH/Tailscale admin access
2. disk/RAM/swap + filesystem health
3. Hermes health + actual startup/service mechanism + 127.0.0.1:8642 only
4. Docker daemon + Compose-managed infra
5. Caddy + HTTPS certificates/routes
6. Beszel Hub + Agent + host/container visibility
7. Telegram test/alert path when relevant
8. P7+: backend + audio-service health
9. P9+: PostgreSQL health/persistence
10. P7+: public HTTPS/WSS smoke test
```

Do not mark recovery complete because processes merely exist; check the service behavior relevant to the active phases.

## 6. Recovery matrix

| Incident | First response | Recovery rule |
|---|---|---|
| Caddy down / TLS route broken | inspect Caddy service/config/cert logs | restore last known-good Caddy config; do not expose origin ports as a shortcut |
| Tailscale unavailable | keep/recover known-good SSH path | never lock out admin; repair Tailscale before tightening SSH again |
| Docker daemon down | inspect daemon/disk before restart | restart Docker safely; do not delete volumes/images blindly |
| Beszel Hub/Agent down | use SSH/system tools for diagnosis | restart verified Compose stack; monitoring outage must not affect BMO runtime |
| Telegram alert broken | test notification target/credential | monitoring remains usable; replace credential only out-of-band |
| Disk <20 GB free | stop large model/image downloads and investigate | clean only known disposable cache/log/temp artifacts; never mass-prune blindly |
| Disk full | stop writes causing damage where safe, identify largest known paths | recover space from documented disposable files/log rotation; verify DB/filesystem before normal operation |
| Hermes down | inspect its existing service/user/logs | recover existing Hermes runtime; do not migrate/reinstall as a first response |
| Hermes absent on fresh/replacement VPS | confirm absence from process/service/path/runtime/listener evidence | perform the P6 host-runtime bootstrap, restore approved portable config/data if available, bind only to `127.0.0.1:8642`, then verify health/restart/recovery evidence |
| Backend container crash (P7+) | inspect health/log/correlation IDs | restart known image; rollback to previous SHA-tagged image if release-related |
| Audio Service crash/OOM (P7+) | inspect model load/RAM/swap/logs | restart; preserve model cache; use Kokoro fallback only according to existing backend behavior |
| Model/cache corruption (P7/P8+) | compare manifest/hash | re-download exact pinned revision; do not substitute a random newer model |
| PostgreSQL unavailable (P9+) | inspect container/storage before mutation | recover service/data; restore verified dump only when necessary |
| PostgreSQL corruption/data loss (P9+) | freeze destructive migration/writes | restore latest verified backup and replay only known migrations |
| Git checkout damaged | preserve deployment record | reclone/fetch source; running immutable image remains recovery anchor |
| Bad application deploy | stop failed release | switch to previous known-good SHA-tagged image/config; DB restore only if required |
| Config corruption | compare with protected backup/deployment evidence | restore last known-good config, validate permissions, then restart affected service |
| Whole VPS loss | provision replacement host | Git clone + restore protected config/data + re-fetch verified models + DNS switch + full phase verification |

## 7. Whole-VPS recovery order

```text
new VPS
→ secure admin access
→ install/verify base host tooling
→ restore Caddy/Tailscale/Docker foundation
→ restore /opt/bmo configuration + deployment metadata
→ restore Beszel configuration/data as needed
→ classify Hermes as PRESENT or ABSENT from evidence
→ PRESENT: recover it through its recorded user/path/startup mechanism without cosmetic migration
→ ABSENT: install the Hermes host runtime using the recorded P6 bootstrap procedure
→ restore approved portable Hermes config/data when available
→ verify Hermes health, restart/autostart, and listener 127.0.0.1:8642 only
→ P7: clone main + deploy known-good SHA-tagged release
→ P8: restore/re-fetch models by manifest/hash
→ P9: restore PostgreSQL dump/data
→ for a planned migration, lower DNS TTL ahead of the cutover when practical
→ update DNS if IP changed and verify propagation
→ verify HTTPS/WSS/public E2E
→ re-run hardware gate before declaring production recovered
```

Domain names are the stable device-facing address; a VPS migration should normally require DNS/infrastructure changes, not firmware endpoint changes.

## 8. Monitoring limitation

Beszel running on the same VPS cannot reliably notify about every **whole-VPS / total-network outage**, because the monitor itself may be offline. P6 must document this limitation. An independent external uptime check can be added later if whole-host outage notification becomes required; do not pretend local monitoring covers that failure mode.

## 9. Required maintenance evidence

For each maintenance window/update/recovery, record:

```text
date/time
operator
affected phase/service
before versions/state
backup/rollback anchor
commands/actions
verification results
after versions/state
known residual risk
```

Never include live tokens/passwords/authorization headers in the evidence.

The P6 evidence/runbook must record the actual Hermes startup/service mechanism plus its exact start, stop, restart, status, health-check, and recovery commands. Generic guessed commands are not a recovery procedure.
