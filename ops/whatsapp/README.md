# Candidate WhatsApp personal-account connector operations

This runbook is for the isolated candidate only. The personal account is
paired and the dedicated bridge is active; the source/unit persistence repair
is tracked below. It must not be used for `hermes-gateway.service`, production
Caddy, production migrations, or the production Backend.

The dedicated unit launches the installed Hermes `bridge.js` unchanged as
`hermes`, with:

```text
--port 3001
--session /home/hermes/.hermes/whatsapp/session
--mode bot
```

`hermes-gateway.service` remains independent and must keep
`WHATSAPP_ENABLED=false`. The paired account is the user's personal WhatsApp
account; `--mode bot` is only the official bridge's contact-event transport
behavior, not a separate bot number. BMO Backend is the only `GET /messages`
consumer. The launcher uses `WHATSAPP_DM_POLICY=pairing` so the private bridge
queue can receive contact events; Backend notification rules remain the product
policy. A protected non-wildcard `WHATSAPP_ALLOWED_USERS` value is optional
and is used only by the official bridge to permit forwarding manual owner
messages for selected chats; it is never used as the Backend notification
filter.

## Mobile-facing Backend contract

Mobile uses only authenticated `/api/v1` Backend routes:

```text
GET  /integrations/whatsapp/status
POST /integrations/whatsapp/disconnect
GET  /integrations/whatsapp/conversations?limit=&cursor=
GET  /integrations/whatsapp/conversations/:conversationId
POST /integrations/whatsapp/conversations/resolve
GET/PATCH /integrations/whatsapp/notification-rules
POST /integrations/whatsapp/send-preview
POST /integrations/whatsapp/send-confirm
```

Conversation responses contain only the BMO UUID, bounded display name,
`DM`/`GROUP`, notification state, and activity timestamp. Resolve accepts an
international phone identity and keeps the provider mapping server-side.
Send uses `conversationId`, message, and idempotency key; Mobile never sends or
receives a JID. The realtime `whatsapp_notification` event contains only
`conversationId`, `displayName`, `conversationType`, and `receivedAt`.

`ALL` is the DM default, `CONTACT` is a per-conversation override, and groups
are disabled unless explicitly enabled. Ingestion continues when a rule mutes
notification. Incoming text is untrusted data and never directly enters Hermes
reasoning/tools. The index is traffic-derived, not a full address-book/history
sync. The bridge queue is in-memory and destructive, not durable/replayable.

## Backend-only live acceptance

Do not call the bridge `/messages` endpoint. Run the following against the
candidate Backend with an existing non-production user's bearer token held only
in the operator shell. Do not paste the token, phone identity, message body,
conversation response, or raw provider identity into chat/logs.

```bash
set -Eeuo pipefail
API=http://127.0.0.1:3010/api/v1
: "${BMO_ACCESS_TOKEN:?set locally; never paste this value into Git or chat}"
: "${BMO_TEST_PHONE:?set locally for recipient-resolution only}"
: "${BMO_TEST_MESSAGE:?set locally; do not print this value}"
AUTH=(-H "Authorization: Bearer $BMO_ACCESS_TOKEN" -H 'content-type: application/json')

wa_request() {
  method="$1"
  path="$2"
  payload="${3:-}"
  response_file="$(mktemp)"
  if [ -n "$payload" ]; then
    http_code="$(curl -sS -o "$response_file" -w '%{http_code}' \
      -X "$method" "$API$path" "${AUTH[@]}" --data "$payload")" || {
      rm -f "$response_file"
      printf 'backend_request_failed method=%s path=%s transport=true\n' "$method" "$path" >&2
      return 1
    }
  else
    http_code="$(curl -sS -o "$response_file" -w '%{http_code}' \
      -X "$method" "$API$path" "${AUTH[@]}")" || {
      rm -f "$response_file"
      printf 'backend_request_failed method=%s path=%s transport=true\n' "$method" "$path" >&2
      return 1
    }
  fi
  case "$http_code" in
    2??) cat "$response_file"; rm -f "$response_file" ;;
    *) rm -f "$response_file"; printf 'backend_request_failed method=%s path=%s http=%s\n' "$method" "$path" "$http_code" >&2; return 1 ;;
  esac
}

wa_get() { wa_request GET "$1"; }
wa_post() { wa_request POST "$1" "$2"; }
wa_patch() { wa_request PATCH "$1" "$2"; }

connect_json="$(wa_post '/integrations/whatsapp/connect' '{}')"
printf '%s' "$connect_json" | jq -e '.connection.status == "CONNECTED" and .blocked == false' >/dev/null
unset connect_json

status_json="$(wa_get '/integrations/whatsapp/status')"
printf '%s' "$status_json" | jq -e '.provider == "whatsapp" and .status == "CONNECTED"' >/dev/null
unset status_json

conversations_json="$(wa_get '/integrations/whatsapp/conversations?limit=50')"
printf '%s' "$conversations_json" | jq -e '(.conversations | type) == "array"' >/dev/null

# Have the selected contact send a DM to the paired personal account here.
# Read only the safe conversation UUID/displayName/type from the response.
sleep 6
conversations_json="$(wa_get '/integrations/whatsapp/conversations?limit=50')"
conversation_id="$(printf '%s' "$conversations_json" | jq -er '.conversations[0].id')"
unset conversations_json

# Configure one selected DM; the API accepts BMO conversation IDs only.
rules_payload="$(jq -n --arg id "$conversation_id" '{rules:[{scope:"ALL",enabled:false,speakOnDevice:false},{scope:"CONTACT",conversationId:$id,enabled:true,speakOnDevice:false}]}')"
rules_json="$(wa_patch '/integrations/whatsapp/notification-rules' "$rules_payload")"
printf '%s' "$rules_json" | jq -e --arg id "$conversation_id" '.rules | any(.[]; .scope=="CONTACT" and .conversationId==$id and .enabled==true)' >/dev/null
unset rules_json rules_payload

# Have the same contact send one more DM. Verify only a metadata event/notification
# and conversation state through Backend/mobile WS instrumentation.

send_payload="$(jq -n --arg id "$conversation_id" --arg message "$BMO_TEST_MESSAGE" '{conversationId:$id,message:$message,idempotencyKey:"phase26-wa-send-1"}')"
send_preview="$(wa_post '/integrations/whatsapp/send-preview' "$send_payload")"
send_id="$(printf '%s' "$send_preview" | jq -er '.send.id')"
unset send_preview
confirm_payload="$(jq -n --arg id "$send_id" '{requestId:$id,confirmed:true}')"
confirm_json="$(wa_post '/integrations/whatsapp/send-confirm' "$confirm_payload")"
printf '%s' "$confirm_json" | jq -e '.send.status == "SUCCEEDED"' >/dev/null
unset confirm_json confirm_payload send_payload

# Resolve an unobserved recipient only if needed; keep the phone value local.
resolve_payload="$(jq -n --arg phone "$BMO_TEST_PHONE" '{phoneNumber:$phone}')"
resolve_json="$(wa_post '/integrations/whatsapp/conversations/resolve' "$resolve_payload")"
printf '%s' "$resolve_json" | jq -e '.id and (.type == "DM")' >/dev/null
unset resolve_json resolve_payload

printf 'backend_api_smoke=pass\n'
```

For the negative checks, have a second contact send a DM while no enabled
CONTACT rule exists and verify the conversation is indexed but no notification
event is emitted. Have a group message occur and verify `type=GROUP`, default
notification suppression, and no Hermes/tool activity. Finally have a contact
send prompt-injection-shaped text; verify it remains data, creates no tool/send
operation, and does not appear in the evidence. Record only boolean results.

## Read-only preflight

Run these checks before any mutation. They print only paths, service state, and
boolean metadata; do not print `.env`, `config.yaml`, provider identities, QR
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
  case "$allow" in *\**|*,,*|,*|*,) exit 1 ;; esac
  if [ -n "$allow" ]; then owner_gate=present; else owner_gate=not_configured; fi
  printf "hermes_preflight=ok enabled=false mode=bot personal-account=session-ready owner-forward-gate=%s\n" "$owner_gate"
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
scan. Pair the user's personal WhatsApp account. When the wizard presents the
legacy mode labels, select `1` so the official bridge writes `WHATSAPP_MODE=bot`;
this is transport behavior only and does not require a second number. If manual
owner-message observation is required, configure only the operator-approved
contact identities in the protected Hermes allowlist; this is not a BMO
notification setting. Leaving it empty keeps manual owner forwarding disabled
while inbound contact ingestion remains available through pairing policy. Never
capture CLI output. The CLI's successful pairing path may write
`WHATSAPP_ENABLED=true`; immediately set it back to false before starting the
dedicated unit:

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

## Targeted unit installation and reboot persistence

No Backend `WHATSAPP_ALLOWED_USERS` provisioning is required. If the operator
wants manual replies from the phone observed for selected chats, the official
CLI may store the approved non-wildcard identities in Hermes `.env`; the
launcher passes that protected value only to the official bridge owner-forward
gate. Backend still receives contact events independently and applies its own
`ALL`/`CONTACT`/`GROUP` notification rules.

The source unit now contains `[Install] WantedBy=multi-user.target`. Reinstall
only the dedicated files and enable only this unit; the command does not
restart `hermes-gateway.service`:

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
restart the process. The bridge queue is in-memory and destructive: delivery is
not durable or replayable if the bridge or poller fails before Backend
processing.

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
QR output, session files, `creds.json`, provider tokens, phone numbers, JIDs,
or message bodies.
