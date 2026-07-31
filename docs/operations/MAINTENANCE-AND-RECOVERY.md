# BMO VPS — Maintenance and Recovery Runbook

**Status:** CURRENT VERIFIED PRODUCTION RUNBOOK
**Owner:** `bmo-admin` / Codex when explicitly authorized  
**Applies from:** P6 foundation onward; service-specific steps activate when the related phase is deployed.

> Purpose: make routine maintenance and recovery deterministic. Do not improvise destructive fixes on the VPS. Record the state before changing it, preserve a proven Hermes installation, bootstrap it only when evidence shows it is absent, and use the latest verified deployment record as the rollback anchor.

## 1. Authority and safety

- `docs/NEXT-ACTION.md` decides the active phase.
- `docs/backend-mvp/06-DEPLOYMENT-AND-OPERATIONS.md` defines the verified P7 production baseline and operational controls.
- Public firmware/backend behavior remains governed by the canonical hardware contract.
- Never delete data, volumes, users, or unrelated services just to make a health check green.
- **Hermes present:** never reinstall/change/migrate its proven ownership, config, data, path, or listener merely for cleanliness.
- **Hermes absent on a fresh/replacement host:** use the recorded conditional P6 bootstrap procedure; P7 did not and does not own initial Hermes installation.
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

P6 evidence reconciled the real VPS scheduling. Future maintenance may refine
the cadence only with evidence and must not silently remove these controls.

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

Beszel data should be included in the weekly recovery set if practical because
it may contain monitoring configuration/history. Treat it as sensitive. P6
evidence inventories the actual Hermes runtime user, install/config/data paths,
and startup/service mechanism; use that record to decide what is
backup-worthy/portable. If copied, protect it as sensitive and do not alter a
working Hermes installation.

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

Beszel running on the same VPS cannot reliably notify about every **whole-VPS /
total-network outage**, because the monitor itself may be offline. P6 evidence
documents this limitation. An independent external uptime check can be added
later if whole-host outage notification becomes required; do not pretend local
monitoring covers that failure mode.

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

The P6 evidence/runbook records the actual Hermes startup/service mechanism
plus its exact start, stop, restart, status, health-check, and recovery
commands. Generic guessed commands are not a recovery procedure.

## 10. Actual P6 VPS reconciliation — 2026-07-28

Current status: `VERIFIED`. See
[`../backend-mvp/P6-TEST-EVIDENCE.md`](../backend-mvp/P6-TEST-EVIDENCE.md).

Verified version inventory:

```text
Ubuntu               24.04.4 LTS
Kernel               6.8.0-124-generic
systemd              255
Docker Engine        29.6.2
Docker Compose       5.3.1
Caddy                2.11.4
Tailscale            1.98.9
Beszel Hub/Agent     0.18.7, pinned by digest in infra-compose.yml
Hermes               0.19.0
Codex CLI            0.145.0
```

Actual service recovery commands:

```bash
# Hermes: host runtime owned by hermes:hermes
sudo systemctl status hermes-gateway --no-pager
sudo systemctl restart hermes-gateway
curl --fail --silent --show-error http://127.0.0.1:8642/health
ss -lntp | grep ':8642'

# Caddy: validate persistent config before restart
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl restart caddy
curl --fail --silent --show-error https://monitor.personalbmo.web.id/api/health

# Docker and Beszel
sudo systemctl status docker --no-pager
docker compose -f /opt/bmo/deploy/infra-compose.yml config -q
docker compose -f /opt/bmo/deploy/infra-compose.yml up -d
docker compose -f /opt/bmo/deploy/infra-compose.yml ps

# Tailscale: do not restart from the only working private SSH session
tailscale status
sudo systemctl status tailscaled --no-pager

# Backup
sudo systemctl start bmo-backup.service
systemctl status bmo-backup.service bmo-backup.timer --no-pager

# Hermes health notifications
sudo systemctl start bmo-hermes-health-notify.service
systemctl status bmo-hermes-health-notify.service \
  bmo-hermes-health-notify.timer --no-pager
```

Telegram credential installation/rotation uses hidden input on the operator's
Tailscale SSH terminal. The command text, process arguments, and environment do
not contain the token:

```bash
sudo install -d -o root -g root -m 0700 /opt/bmo/config/telegram
sudo bash -c '
set -eu
umask 077
token=
trap '\''unset token'\'' EXIT
printf "Telegram bot token: " >/dev/tty
IFS= read -r -s token </dev/tty
printf "\n" >/dev/tty
if ! [[ "$token" =~ ^[0-9]+:[A-Za-z0-9_-]+$ ]]; then
  printf "Invalid Telegram token format\n" >/dev/tty
  exit 1
fi
runtime_token_file="$(mktemp /opt/bmo/config/telegram/.bot-token.XXXXXX)"
trap '\''rm -f -- "$runtime_token_file"; unset token'\'' EXIT
printf "%s\n" "$token" >"$runtime_token_file"
chown root:root "$runtime_token_file"
chmod 0600 "$runtime_token_file"
mv -f -- "$runtime_token_file" /opt/bmo/config/telegram/bot-token
trap - EXIT
unset token
'
sudo stat -c '%A %U:%G %n' \
  /opt/bmo/config/telegram \
  /opt/bmo/config/telegram/bot-token
```

Required metadata is directory `root:root` mode `0700` and bot-token file
`root:root` mode `0600`. Never print or inspect the value in a command
transcript.

Replace the Telegram chat destination with the same atomic, root-only pattern:

```bash
sudo bash -c '
set -eu
umask 077
chat_id=
trap '\''unset chat_id'\'' EXIT
printf "Telegram group chat ID: " >/dev/tty
IFS= read -r -s chat_id </dev/tty
printf "\n" >/dev/tty
if ! [[ "$chat_id" =~ ^-[0-9]+$ ]]; then
  printf "Invalid Telegram group chat ID format\n" >/dev/tty
  exit 1
fi
runtime_chat_file="$(mktemp /opt/bmo/config/telegram/.chat-id.XXXXXX)"
trap '\''rm -f -- "$runtime_chat_file"; unset chat_id'\'' EXIT
printf "%s\n" "$chat_id" >"$runtime_chat_file"
chown root:root "$runtime_chat_file"
chmod 0600 "$runtime_chat_file"
mv -f -- "$runtime_chat_file" /opt/bmo/config/telegram/chat-id
trap - EXIT
unset chat_id
'
sudo stat -c '%A %U:%G %n' \
  /opt/bmo/config/telegram \
  /opt/bmo/config/telegram/chat-id
```

After replacing `chat-id`, force-recreate the relay so its read-only bind mount
references the new inode. Reapply the managed Beszel target through the
authenticated configuration helper; never edit Beszel's database directly.

Beszel uses a token-free generic webhook to the private
`bmo-telegram-relay` container. Do not switch it to the pinned Shoutrrr
Telegram client: that client can falsely report success for a failed Telegram
request. The relay has no published host port and accepts delivery only after
Telegram returns HTTP 2xx and boolean `ok=true`.

After initial installation or token replacement:

```bash
docker compose -f /opt/bmo/deploy/infra-compose.yml \
  up -d --force-recreate telegram-relay
docker compose -f /opt/bmo/deploy/infra-compose.yml \
  ps telegram-relay
sudo systemctl start bmo-telegram-test.service
sudo /usr/local/libexec/bmo-configure-beszel-telegram
systemctl status \
  bmo-hermes-health-notify.timer \
  bmo-telegram-test.service \
  --no-pager
```

Confirm both the `[P6 HERMES GROUP TEST]` and `[BMO BESZEL GROUP TEST]`
messages before revoking an old token or destination. The relay applies the
group-test label only to the exact known Beszel built-in test payload; every
other payload retains the normal `[BMO BESZEL]` label. Runtime logs and
evidence may contain only sanitized status categories; never record the token,
chat identifier, Telegram request URL, PocketBase authorization token,
request/response bodies, complete Shoutrrr target, or notification message
contents.

Actual Hermes locations:

```text
install       /home/hermes/.hermes/hermes-agent
config root   /home/hermes/.hermes
config        /home/hermes/.hermes/config.yaml
sensitive env /home/hermes/.hermes/.env
state/data    /home/hermes/.hermes/state,
              /home/hermes/.hermes/state.db,
              /home/hermes/.hermes/response_store.db,
              /home/hermes/.hermes/sessions,
              /home/hermes/.hermes/memories
service       /etc/systemd/system/hermes-gateway.service
```

Monthly off-server workflow:

1. Run `bmo-backup.service` and verify the newest
   `manifests/<timestamp>/SHA256SUMS`.
2. On the VPS, create a single mode-`600` staging archive under
   `/home/bmo-admin/` containing only the matching protected
   `config/<timestamp>` and `manifests/<timestamp>` directories.
3. Copy it from the admin workstation over Tailscale SSH to an encrypted,
   access-controlled off-server destination.
4. Verify a separately copied SHA-256 on the destination.
5. Perform a safe test listing/extraction without overwriting live paths.
6. After the destination copy and checksum are confirmed, remove the temporary
   VPS staging archive in a separate deliberate cleanup action.

The bundle contains live config and Beszel recovery data and must be treated as
sensitive. Tailscale machine identity, Git credentials, and other host identity
credentials should be re-provisioned rather than added to this general bundle.

Current reboot caveat:

- full reboot proof is deferred because the P6 verification runs inside the
  active Codex/Tailscale session;
- Hermes, Caddy, and Beszel controlled restarts passed;
- startup enablement is verified;
- `cloud-init.service` and `systemd-networkd-wait-online.service` retain old
  failed states from the current boot and must be reviewed before a planned
  reboot rather than silently cleared.
