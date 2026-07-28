# P6 Telegram Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Configure Beszel Telegram delivery and a hardened three-failure Hermes health notifier, prove both paths with labeled receipt tests, and close P6 without starting P7.

**Architecture:** Runtime token and chat files remain root-only outside Git. A standard-library Python notifier receives them through systemd credentials, performs Telegram HTTPS calls in-process, and accepts delivery only for HTTP 2xx plus JSON boolean `ok=true`. Beszel calls a token-free generic webhook on a private Compose relay that reuses the strict client and returns success only after the same Telegram validation. A root-only activation helper mints a short-lived PocketBase user token from local Beszel data, preserves existing settings, configures the relay webhook through the loopback API, and invokes Beszel's built-in test.

**Tech Stack:** Python 3.12 standard library, `unittest`, systemd 255 credentials/sandboxing, PocketBase REST API, Beszel 0.18.7, Telegram Bot API.

---

## File structure

- `ops/telegram/bmo_telegram_notify.py`: strict Telegram client, Hermes health validation, persistent three-failure/recovery state machine, and fixed labeled direct-path test.
- `ops/telegram/beszel_telegram_relay.py`: private HTTP relay that maps strict Telegram delivery to fixed HTTP success/failure for Beszel.
- `ops/telegram/configure_beszel_telegram.py`: short-lived local PocketBase auth token, settings-preserving Beszel webhook configuration, and sanitized Beszel test invocation.
- `ops/telegram/systemd/bmo-hermes-health-notify.service`: sandboxed one-shot health check with systemd credentials and persistent state directory.
- `ops/telegram/systemd/bmo-hermes-health-notify.timer`: one-minute scheduler.
- `ops/telegram/systemd/bmo-telegram-test.service`: static sandboxed direct-path receipt test.
- `tests/operations/test_bmo_telegram_notify.py`: strict HTTP/API validation and health state-machine tests.
- `tests/operations/test_beszel_telegram_relay.py`: relay success/failure and log-sanitization tests.
- `tests/operations/test_configure_beszel_telegram.py`: JWT construction, settings merge, and sanitized API failure tests.
- `docs/backend-mvp/P6-TEST-EVIDENCE.md`: sanitized final P6 evidence.
- `docs/operations/MAINTENANCE-AND-RECOVERY.md`: credential rotation, test, and recovery commands.
- P6 status entry files already modified in the working tree: update them from blocked to verified only after both receipts are confirmed.

### Task 1: Strict Telegram client and Hermes state machine

**Files:**
- Create: `tests/operations/test_bmo_telegram_notify.py`
- Create: `ops/telegram/bmo_telegram_notify.py`

- [ ] **Step 1: Write failing strict-delivery tests**

Create tests using injected fake HTTPS connections. The required assertions are:

```python
class TelegramDeliveryTests(unittest.TestCase):
    def test_http_200_and_boolean_ok_true_succeeds(self):
        send_telegram("1:token", "chat", "message", connection_factory=ok_connection)

    def test_http_error_fails_without_url_or_token(self):
        with self.assertRaisesRegex(DeliveryError, r"^http_status=429$") as raised:
            send_telegram("1:secret-token", "chat", "message", connection_factory=http_error_connection)
        self.assertNotIn("secret-token", str(raised.exception))
        self.assertNotIn("api.telegram", str(raised.exception))

    def test_http_200_ok_false_fails(self):
        with self.assertRaisesRegex(DeliveryError, r"^telegram_api_ok_false$"):
            send_telegram("1:token", "chat", "message", connection_factory=ok_false_connection)

    def test_http_200_invalid_json_fails(self):
        with self.assertRaisesRegex(DeliveryError, r"^invalid_json_response$"):
            send_telegram("1:token", "chat", "message", connection_factory=invalid_json_connection)

    def test_client_error_uses_exception_class_only(self):
        with self.assertRaisesRegex(DeliveryError, r"^client_error=TimeoutError$"):
            send_telegram("1:secret-token", "chat", "message", connection_factory=timeout_connection)
```

- [ ] **Step 2: Run the tests and confirm RED**

Run:

```bash
python3 -m unittest -v tests.operations.test_bmo_telegram_notify
```

Expected: import failure because `ops.telegram.bmo_telegram_notify` does not exist.

- [ ] **Step 3: Implement strict in-process Telegram delivery**

Implement these interfaces:

```python
class DeliveryError(RuntimeError):
    pass

def send_telegram(
    token: str,
    chat_id: str,
    message: str,
    *,
    connection_factory: Callable[..., http.client.HTTPSConnection] = http.client.HTTPSConnection,
) -> None:
    """POST in-process; require HTTP 2xx and decoded {"ok": true}."""

def load_credential(name: str) -> str:
    """Read a nonempty file below CREDENTIALS_DIRECTORY without logging it."""
```

`send_telegram` must:

1. create `HTTPSConnection("api.telegram.org", timeout=10)`;
2. POST form data to the token-bearing path without spawning a child process;
3. read a bounded response body;
4. reject all non-2xx status codes using a bounded value such as
   `http_status=429`;
5. reject invalid JSON as `invalid_json_response`;
6. require `payload.get("ok") is True`;
7. catch client exceptions using a bounded value such as
   `client_error=TimeoutError`;
8. never include the path, host URL, response body, token, or chat identifier in an exception or log.

- [ ] **Step 4: Add failing health/state tests**

Cover this exact state table in temporary directories:

```text
healthy from clean state                  -> failures=0, down_alerted=false, no message
unhealthy #1                              -> failures=1, no message
unhealthy #2                              -> failures=2, no message
unhealthy #3 + successful delivery        -> failures=3, down_alerted=true, one DOWN
unhealthy #4 while already alerted        -> unchanged, no repeated message
healthy after alert + successful delivery -> failures=0, down_alerted=false, one RECOVERED
DOWN delivery failure                     -> failures=3, down_alerted=false, retry next run
RECOVERED delivery failure                -> failures=0, down_alerted=true, retry next run
malformed state file                      -> safe failure, no notification
```

Run the specific state test class and expect failures because the state functions
are not implemented.

- [ ] **Step 5: Implement health validation, state persistence, and CLI**

Implement:

```python
@dataclass(frozen=True)
class HealthState:
    failures: int = 0
    down_alerted: bool = False

def check_hermes_health(opener: Callable = urllib.request.urlopen) -> bool:
    """Require HTTP success and status=ok, platform=hermes-agent, version=0.19.0."""

def load_state(path: Path) -> HealthState:
    """Strictly validate the two-field JSON state."""

def save_state(path: Path, state: HealthState) -> None:
    """Atomic mode-0600 replace in STATE_DIRECTORY."""

def run_health_check(
    state_path: Path,
    health_probe: Callable[[], bool],
    notify: Callable[[str], None],
) -> HealthState:
    """Apply the three-failure/down/recovery transition table."""

def main(argv: Sequence[str] | None = None) -> int:
    """Support `check` and fixed-message `test`; print sanitized status only."""
```

Use fixed messages labeled `[P6 HERMES HEALTH] DOWN`,
`[P6 HERMES HEALTH] RECOVERED`, and `[P6 HERMES PATH TEST]`.

- [ ] **Step 6: Run notifier tests and compile check**

Run:

```bash
python3 -m unittest -v tests.operations.test_bmo_telegram_notify
python3 -m py_compile ops/telegram/bmo_telegram_notify.py
```

Expected: all tests pass and compilation exits zero.

### Task 2: Beszel configuration helper

**Files:**
- Create: `tests/operations/test_configure_beszel_telegram.py`
- Create: `ops/telegram/configure_beszel_telegram.py`

- [ ] **Step 1: Write failing helper tests**

Build an in-memory SQLite fixture with one `users` collection, one verified
user, and one `user_settings` record. Use fake loopback API responses and make
these exact assertions:

```python
class BeszelConfigurationTests(unittest.TestCase):
    def test_static_user_jwt_has_five_minute_expiry_and_nonrefreshable_claim(self):
        token, settings_id, settings = mint_static_user_token(self.db, self.now)
        claims = decode_unverified_payload(token)
        self.assertEqual(claims["exp"] - self.now, 300)
        self.assertIs(claims["refreshable"], False)
        self.assertEqual(settings_id, "settings-record")
        self.assertEqual(settings["emails"], ["operator@example.invalid"])

    def test_merge_preserves_emails_and_nontelegram_webhooks(self):
        merged, webhook = merge_webhook(
            {"emails": ["operator@example.invalid"], "webhooks": ["generic://example.invalid"]}
        )
        self.assertEqual(merged["emails"], ["operator@example.invalid"])
        self.assertIn("generic://example.invalid", merged["webhooks"])
        self.assertIn(webhook, merged["webhooks"])

    def test_merge_replaces_existing_telegram_webhook_once(self):
        merged, webhook = merge_webhook(
            {"webhooks": ["telegram://old@telegram?chats=456"]}
        )
        self.assertEqual(merged["webhooks"], [webhook])

    def test_api_http_error_is_status_only(self):
        with self.assertRaisesRegex(BeszelConfigError, r"^http_status=500$"):
            self.api_with_http_500()

    def test_api_client_error_is_exception_class_only(self):
        with self.assertRaisesRegex(BeszelConfigError, r"^client_error=TimeoutError$"):
            self.api_with_timeout()

    def test_test_endpoint_requires_err_false(self):
        with self.assertRaisesRegex(BeszelConfigError, r"^beszel_test_rejected$"):
            validate_test_response({"err": "delivery failed"})
```

No test fixture may contain a real token or chat identifier.

- [ ] **Step 2: Run helper tests and confirm RED**

Run:

```bash
python3 -m unittest -v tests.operations.test_configure_beszel_telegram
```

Expected: import failure because the helper does not exist.

- [ ] **Step 3: Implement local auth and settings-preserving API update**

Implement:

```python
def mint_static_user_token(db: sqlite3.Connection, now: int) -> tuple[str, str, dict]:
    """Read one verified user, its collection auth secret, and settings; sign HS256 for 300 seconds."""

def merge_webhook(settings: dict) -> tuple[dict, str]:
    """Preserve settings and replace managed entries with the token-free relay URL."""

def api_json(method: str, path: str, body: dict, auth_token: str) -> dict:
    """Call only the fixed loopback Beszel origin with sanitized failures."""

def configure_and_test() -> None:
    """PATCH user_settings, verify one webhook by count only, POST Beszel test, print booleans only."""
```

JWT claims must use values read from the live local records and have this shape:

```json
{
  "type": "auth",
  "id": "value read from the single verified local user",
  "collectionId": "value read from the users collection",
  "refreshable": false,
  "exp": "current Unix time plus 300 seconds"
}
```

Sign HS256 with `user.tokenKey + users.options.authToken.secret`. Keep the JWT,
signing material, API bodies, and API response bodies in memory only and never
print them.

The Beszel test is accepted only when HTTP succeeds and its decoded response is
exactly compatible with `{"err": false}`. Final delivery remains pending until
the operator confirms the labeled Beszel test arrived. The pinned Shoutrrr
0.14.1 Telegram client is explicitly excluded because it can discard a
transport/API error and falsely return success.

- [ ] **Step 4: Run helper tests and compile check**

Run:

```bash
python3 -m unittest -v tests.operations.test_configure_beszel_telegram
python3 -m py_compile ops/telegram/configure_beszel_telegram.py
```

Expected: all tests pass and compilation exits zero.

### Task 2A: Strict private Beszel relay

**Files:**
- Create: `tests/operations/test_beszel_telegram_relay.py`
- Create: `ops/telegram/beszel_telegram_relay.py`
- Modify: `/opt/bmo/deploy/infra-compose.yml`

- [ ] **Step 1: Test relay success and sanitized failure**

Use an ephemeral local HTTP server and an injected sender. Require HTTP `204`
only after the sender returns successfully. Require a fixed HTTP `502` and a
sanitized log category for `DeliveryError` or an unexpected exception. Verify
that health and unknown paths never send and that the request path is not
logged.

- [ ] **Step 2: Implement the relay**

Accept only `POST /notify` and `GET /health`, bound to the container network.
Read a bounded UTF-8 message, prefix it with `[BMO BESZEL]`, and call the strict
Telegram client in-process. Never log the message, request path, token, chat
identifier, exception message, or Telegram response body.

- [ ] **Step 3: Add the private Compose service**

Use a digest-pinned Python image, no published port, read-only filesystem, all
capabilities dropped, `no-new-privileges`, core limit zero, bounded logging,
and read-only mounts for the two root-owned credential files and both scripts.
The Beszel Hub depends on relay health. Validate with `docker compose config`
but do not start the relay before the token file exists.

### Task 3: Hardened systemd units

**Files:**
- Create: `ops/telegram/systemd/bmo-hermes-health-notify.service`
- Create: `ops/telegram/systemd/bmo-hermes-health-notify.timer`
- Create: `ops/telegram/systemd/bmo-telegram-test.service`

- [ ] **Step 1: Create the health service**

Required unit properties:

```ini
[Unit]
Description=BMO Hermes health notification check
After=network-online.target hermes-gateway.service
Wants=network-online.target

[Service]
Type=oneshot
DynamicUser=yes
ExecStart=/usr/local/libexec/bmo-hermes-health-notify check
LoadCredential=telegram-bot-token:/opt/bmo/config/telegram/bot-token
LoadCredential=telegram-chat-id:/opt/bmo/config/telegram/chat-id
StateDirectory=bmo-hermes-health-notify
StateDirectoryMode=0700
UMask=0077
NoNewPrivileges=yes
PrivateDevices=yes
PrivateTmp=yes
ProtectControlGroups=yes
ProtectHome=yes
ProtectKernelModules=yes
ProtectKernelTunables=yes
ProtectSystem=strict
RestrictAddressFamilies=AF_INET AF_INET6
RestrictSUIDSGID=yes
LockPersonality=yes
LimitCORE=0
MemoryDenyWriteExecute=yes
```

- [ ] **Step 2: Create the timer**

```ini
[Timer]
OnBootSec=2min
OnUnitActiveSec=60s
AccuracySec=5s
RandomizedDelaySec=5s
Unit=bmo-hermes-health-notify.service

[Install]
WantedBy=timers.target
```

- [ ] **Step 3: Create the static test service**

Use the same credentials and sandboxing, omit `StateDirectory`, and set:

```ini
ExecStart=/usr/local/libexec/bmo-hermes-health-notify test
```

No `[Install]` section is allowed, preventing recurring enablement.

- [ ] **Step 4: Validate source files**

Run:

```bash
systemd-analyze verify \
  ops/telegram/systemd/bmo-hermes-health-notify.service \
  ops/telegram/systemd/bmo-hermes-health-notify.timer \
  ops/telegram/systemd/bmo-telegram-test.service
```

Expected: no syntax or dependency errors.

### Task 4: Install host components and collect the token securely

**Files:**
- Install: `/usr/local/libexec/bmo-hermes-health-notify` (`root:root`, `0755`)
- Install: `/usr/local/libexec/bmo-configure-beszel-telegram` (`root:root`, `0750`)
- Install: `/usr/local/libexec/bmo-beszel-telegram-relay` (`root:root`, `0755`)
- Install: the three source units under `/etc/systemd/system/` (`root:root`, `0644`)
- Create: `/opt/bmo/config/telegram/chat-id` (`root:root`, `0600`)
- User creates: `/opt/bmo/config/telegram/bot-token` (`root:root`, `0600`)

- [ ] **Step 1: Install scripts, units, directory, and chat file**

Use the already documented root-equivalent Docker host workflow. Do not include
the bot token in any command. Run `systemctl daemon-reload` afterward but do not
enable the timer until the live direct-path test succeeds.

- [ ] **Step 2: Give the operator the exact hidden-input command**

The operator runs this in their own Tailscale SSH terminal:

```bash
sudo install -d -o root -g root -m 0700 /opt/bmo/config/telegram
sudo bash -c '
set -eu
umask 077
printf "Telegram bot token: " >/dev/tty
IFS= read -r -s token </dev/tty
printf "\n" >/dev/tty
if ! [[ "$token" =~ ^[0-9]+:[A-Za-z0-9_-]+$ ]]; then
  printf "Invalid Telegram token format\n" >/dev/tty
  unset token
  exit 1
fi
tmp="$(mktemp /opt/bmo/config/telegram/.bot-token.XXXXXX)"
trap '\''rm -f -- "$tmp"; unset token'\'' EXIT
printf "%s\n" "$token" >"$tmp"
chown root:root "$tmp"
chmod 0600 "$tmp"
mv -f -- "$tmp" /opt/bmo/config/telegram/bot-token
trap - EXIT
unset token
'
sudo stat -c '%A %U:%G %n' \
  /opt/bmo/config/telegram \
  /opt/bmo/config/telegram/bot-token
```

Expected metadata:

```text
drwx------ root:root /opt/bmo/config/telegram
-rw------- root:root /opt/bmo/config/telegram/bot-token
```

- [ ] **Step 3: Verify metadata without reading contents**

Verify both credential files are regular, root-owned, mode `0600`, nonempty,
single-line files; verify the directory is root-owned mode `0700`. Output only
metadata and boolean validation results.

### Task 5: Activate both paths and require receipt confirmation

- [ ] **Step 1: Run the direct strict test**

Start `bmo-telegram-test.service`. Success requires:

```text
systemd service Result=success
notifier validated HTTP 2xx
notifier decoded JSON
notifier observed boolean ok=true
journal contains only telegram_delivery=success label=direct_test
```

- [ ] **Step 2: Configure Beszel and run its test**

Start the private relay, verify it is healthy with no published host port, then
run `/usr/local/libexec/bmo-configure-beszel-telegram` as host root. Verify only:

```text
beszel_webhook_count=1
beszel_test_accepted=true
```

Query the Hub database afterward and output only the webhook count and a boolean
that the single managed entry targets the internal relay. Never output the
value.

- [ ] **Step 3: Ask for two-message receipt confirmation**

Require confirmation of:

1. `[P6 HERMES PATH TEST]` from the strict host notifier;
2. `[BMO BESZEL]` plus Beszel's built-in `Test Alert` / “notification from
   Beszel” message.

Do not mark either delivered or P6 verified before the operator confirms both.

- [ ] **Step 4: Enable and prove the health timer**

After confirmation:

```bash
systemctl enable --now bmo-hermes-health-notify.timer
systemctl start bmo-hermes-health-notify.service
```

Verify the timer is enabled/active, the manual healthy run succeeds, state is
`failures=0` and `down_alerted=false`, and logs contain no URL/token/chat value.
Do not stop Hermes to force an alert; the state machine is covered by isolated
tests, and disrupting the production host runtime is unnecessary.

### Task 6: Final P6 audit and sanitized evidence

**Files:**
- Modify: `docs/backend-mvp/P6-TEST-EVIDENCE.md`
- Modify: `docs/backend-mvp/IMPLEMENTATION-STATUS.md`
- Modify: `README.md`
- Modify: `docs/README.md`
- Modify: `docs/NEXT-ACTION.md`
- Modify: `docs/roadmap/P6-EXECUTION-SPEC.md`
- Modify: `docs/roadmap/P6-P10-ROADMAP.md`
- Modify: `docs/operations/MAINTENANCE-AND-RECOVERY.md`
- Modify: `scripts/verify-backend-mvp-docs.py`

- [ ] **Step 1: Rerun the live P6 audit**

Verify service health, listeners, TLS, UFW, Tailscale SSH, Beszel metrics and
systemd rows, alert rules, webhook count, timer state, backup checksums, secret
metadata, and no P7 listeners/services.

- [ ] **Step 2: Update only sanitized evidence**

Record:

```text
Telegram credential metadata PASS (never value)
strict host test HTTP success + ok=true PASS
Beszel relay HTTP success after Telegram HTTP success + ok=true PASS
Beszel test accepted PASS
both labeled receipts confirmed PASS
Hermes timer enabled/active; threshold=3; one recovery behavior test PASS
known same-VPS outage limitation
```

Do not record the token, chat identifier, Shoutrrr URL, PocketBase JWT, API
response body, or Telegram request URL.

- [ ] **Step 3: Verify repository and host artifacts**

Run:

```bash
python3 -m unittest -v \
  tests.operations.test_beszel_telegram_relay \
  tests.operations.test_bmo_telegram_notify \
  tests.operations.test_configure_beszel_telegram
python3 -m py_compile \
  ops/telegram/beszel_telegram_relay.py \
  ops/telegram/bmo_telegram_notify.py \
  ops/telegram/configure_beszel_telegram.py \
  scripts/verify-backend-mvp-docs.py
python3 scripts/verify-backend-mvp-docs.py
git diff --check
```

Scan tracked/modified files for actual Telegram token patterns, not merely the
word “Telegram” or its URL scheme. Confirm Git ignores and docs contain no
runtime credential.

- [ ] **Step 4: Stop after P6**

Report P6 verification, residual reboot/cloud-init warnings, changed host files,
uncommitted repository changes, and the evidence path. Do not start P7.
