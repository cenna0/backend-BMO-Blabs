# Candidate WhatsApp transport-only operations

This runbook is prepared for the isolated candidate only. It has not been
executed. It must not be used for `hermes-gateway.service`, production Caddy,
production migrations, or the production Backend.

The dedicated unit launches the installed Hermes `bridge.js` unchanged as
`hermes`, with:

```text
--port 3001
--session /home/hermes/.hermes/whatsapp/session
--mode bot
```

`hermes-gateway.service` remains independent and must keep
`WHATSAPP_ENABLED=false`. BMO Backend is the only `GET /messages` consumer.

## Read-only preflight

Run these checks before any mutation. They print only paths, service state, and
boolean metadata; do not print `.env`, `config.yaml`, allowlist values, QR
contents, session files, JIDs, or message bodies.

```bash
cd /opt/bmo/app
git branch --show-current
git rev-parse HEAD
git status --short
curl -fsS http://127.0.0.1:8642/health
curl -fsS http://127.0.0.1:3010/livez
curl -fsS http://127.0.0.1:3010/readyz
curl -fsS http://127.0.0.1:3000/health
ss -H -ltnp | grep -E ':(3000|3001|3010|8001|8642)\b' || true
docker ps --format '{{.Names}}\t{{.Ports}}' | grep -E '(^|[ ,])[^[:space:]]*:3001->|127\.0\.0\.1:3001|0\.0\.0\.0:3001' || true
rg -n --hidden --glob '!*.log' --glob '!session/**' '3001' /etc/caddy /opt/bmo/app/ops/caddy 2>/dev/null || true
systemctl is-active hermes-gateway.service
systemctl show hermes-gateway.service -p MainPID -p ExecMainPID -p NRestarts -p ActiveState -p SubState
```

Port 3001 is acceptable only when the `ss` check has no row, Docker has no
publication, and the Caddy search has no route. The current source unit does
not add a Caddy route or a public bind.

The protected Hermes preflight is run as `hermes` and reports no identity:

```bash
sudo -u hermes -H sh -c '
  set -eu
  h=/home/hermes/.hermes
  f="$h/.env"
  test -r "$f"
  test -x "$h/node/bin/node"
  test -d "$h/whatsapp/session"
  test "$(stat -c %U:%G "$h/whatsapp/session")" = hermes:hermes
  test -z "$(find "$h/whatsapp/session" -xdev \( ! -user hermes -o ! -group hermes -o -perm /0077 \) -print -quit)"
  test -f "$h/hermes-agent/scripts/whatsapp-bridge/bridge.js" ||
    test -f "$h/scripts/whatsapp-bridge/bridge.js"
  enabled=$(sed -n 's/^WHATSAPP_ENABLED=//p' "$f" | head -n 1)
  mode=$(sed -n 's/^WHATSAPP_MODE=//p' "$f" | head -n 1)
  allow=$(sed -n 's/^WHATSAPP_ALLOWED_USERS=//p' "$f" | head -n 1)
  test "$enabled" = false
  test "$mode" = bot
  test -n "$allow"
  test "$allow" != "*"
  case "$allow" in *\**|*[	 ]*) exit 1 ;; esac
  printf "hermes_preflight=ok enabled=false mode=bot allowlist=present session=present\n"
'
```

## Protected backup

Run before pairing or installing the unit. The backup is owned by `hermes`,
mode `0700`, and the copied file modes are preserved. The command does not
print file contents.

```bash
backup_dir="/opt/bmo/backups/phase26-whatsapp-$(date -u +%Y%m%dT%H%M%SZ)"
sudo install -d -o hermes -g hermes -m 0700 "$backup_dir"
sudo -u hermes -H env BACKUP_DIR="$backup_dir" sh -c '
  set -eu
  umask 077
  h=/home/hermes/.hermes
  test -f "$h/.env"
  test -f "$h/config.yaml"
  cp -p "$h/.env" "$BACKUP_DIR/.env"
  cp -p "$h/config.yaml" "$BACKUP_DIR/config.yaml"
  chmod --reference="$h/.env" "$BACKUP_DIR/.env"
  chmod --reference="$h/config.yaml" "$BACKUP_DIR/config.yaml"
  printf "backup=created path=%s owner=%s:%s mode=%s\n" \
    "$BACKUP_DIR" "$(stat -c %U "$BACKUP_DIR")" "$(stat -c %G "$BACKUP_DIR")" "$(stat -c %a "$BACKUP_DIR")"
'
```

## Official pairing command — not run in this phase

This is the installed Hermes CLI flow. It requires a TTY and the physical QR
scan. Select mode `1` (separate bot number) if the wizard asks, provide a
non-wildcard allowlist, and never capture its output. The CLI's successful
pairing path may write `WHATSAPP_ENABLED=true`; immediately set it back to
false before starting the dedicated unit:

```bash
sudo -u hermes -H env \
  HOME=/home/hermes \
  HERMES_HOME=/home/hermes/.hermes \
  PATH=/home/hermes/.hermes/hermes-agent/venv/bin:/home/hermes/.hermes/node/bin:/usr/bin:/bin \
  /home/hermes/.hermes/hermes-agent/venv/bin/python \
  -m hermes_cli.main whatsapp

sudo -u hermes -H sh -c '
  set -eu
  f=/home/hermes/.hermes/.env
  if grep -q "^WHATSAPP_ENABLED=" "$f"; then
    sed -i "s/^WHATSAPP_ENABLED=.*/WHATSAPP_ENABLED=false/" "$f"
  else
    printf "\\nWHATSAPP_ENABLED=false\\n" >> "$f"
  fi
  test "$(sed -n 's/^WHATSAPP_ENABLED=//p' "$f" | head -n 1)" = false
'
```

Do not use `hermes gateway` for this transport. Do not delete an existing
session directory or run the pairing wizard with a re-pair confirmation unless
the operator explicitly intends to replace that provider session.

## Install and start — prepared, not executed

First provision the exact bridge-emitted sender ID list in the protected
candidate Backend environment (normally `/opt/bmo/config/backend.env`) as
`WHATSAPP_ALLOWED_USERS=...`. Do not put the value in Git or send it in chat.
The Backend list is exact and fail-closed; it must not be `*`. Hermes may
resolve a phone allowlist through its protected LID mapping. If a paired bridge
event uses a LID identifier, add that normalized identifier to the protected
Backend list as well; do not print or send it.

Then install only the two prepared files:

```bash
cd /opt/bmo/app
sudo install -o root -g root -m 0755 \
  ops/whatsapp/bmo-whatsapp-bridge-launcher \
  /usr/local/libexec/bmo-whatsapp-bridge-launcher
sudo install -o root -g root -m 0644 \
  ops/whatsapp/systemd/bmo-whatsapp-bridge.service \
  /etc/systemd/system/bmo-whatsapp-bridge.service
sudo systemd-analyze verify /etc/systemd/system/bmo-whatsapp-bridge.service
sudo systemctl daemon-reload
sudo systemctl enable bmo-whatsapp-bridge.service
sudo systemctl start bmo-whatsapp-bridge.service
curl -fsS http://127.0.0.1:3001/health
sudo systemctl show bmo-whatsapp-bridge.service \
  -p MainPID -p ExecMainStatus -p NRestarts -p ActiveState -p SubState
```

The unit has no dependency on `hermes-gateway.service`, uses
`Restart=on-failure` with a ten-second delay and five-start/300-second limits,
and prevents restart loops for configuration exit code 78. A temporary
WhatsApp disconnect is handled by bridge.js internally; systemd does not health
restart the process.

## Shared Hermes restart evidence — prepared, not executed

The dedicated unit does not require a shared Hermes restart. If a separately
authorized operation later restarts `hermes-gateway.service`, capture these
sanitized checks immediately before and after it. Do not include journal
payloads or environment values.

```bash
before_pid="$(systemctl show hermes-gateway.service -p MainPID --value)"
before_restarts="$(systemctl show hermes-gateway.service -p NRestarts --value)"
curl -fsS http://127.0.0.1:8642/health
curl -fsS http://127.0.0.1:3010/readyz
curl -fsS http://127.0.0.1:3000/health
ss -H -ltnp | grep -E ':(3000|3010|8001|8642)\\b' || true
printf 'before_pid=%s before_restarts=%s\\n' "$before_pid" "$before_restarts"

# Explicitly authorized shared-runtime restart would occur here.

curl -fsS http://127.0.0.1:8642/health
curl -fsS http://127.0.0.1:3010/readyz
curl -fsS http://127.0.0.1:3000/health
after_pid="$(systemctl show hermes-gateway.service -p MainPID --value)"
after_restarts="$(systemctl show hermes-gateway.service -p NRestarts --value)"
systemctl is-active hermes-gateway.service
systemctl show hermes-gateway.service -p ActiveState -p SubState -p ExecMainStatus --no-pager
printf 'after_pid=%s after_restarts=%s\\n' "$after_pid" "$after_restarts"
```

The mandatory application regression after that separate restart is the
existing candidate auth/chat/device-WebSocket path plus the existing whole-WAV
voice path through STT → Hermes → Piper → MP3 → `audio_ready`; production
Backend health must remain successful. The WhatsApp bridge itself is checked
independently at `curl -fsS http://127.0.0.1:3001/health` and is not restarted
by the shared-service check.

## Rollback — prepared, not executed

Stop and remove only the dedicated unit and launcher. Do not stop or restart
the shared Hermes gateway, and do not remove the session directory.

```bash
sudo systemctl disable --now bmo-whatsapp-bridge.service
sudo rm -f /etc/systemd/system/bmo-whatsapp-bridge.service
sudo rm -f /usr/local/libexec/bmo-whatsapp-bridge-launcher
sudo systemctl daemon-reload
```

To restore only the protected Hermes configuration from the recorded backup:

```bash
sudo -u hermes -H env BACKUP_DIR="$backup_dir" sh -c '
  set -eu
  h=/home/hermes/.hermes
  test -f "$BACKUP_DIR/.env" -a -f "$BACKUP_DIR/config.yaml"
  cp -p "$BACKUP_DIR/.env" "$h/.env"
  cp -p "$BACKUP_DIR/config.yaml" "$h/config.yaml"
'
```

No rollback command deletes `/home/hermes/.hermes/whatsapp/session`.

## STOP boundary

This runbook stops before the pairing command and before any install/start,
systemd mutation, candidate restart, Hermes restart, or Caddy mutation. Return
only sanitized boolean/status evidence after the operator review. Never share
allowlist values, QR output, session files, `creds.json`, provider tokens,
phone numbers, JIDs, or message bodies.
