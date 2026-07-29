# P6 Telegram Group Target Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move both hardened P6 Telegram paths to the approved group and prove
them with exact labeled tests while preserving normal alerts and every existing
security control.

**Architecture:** The root-only chat credential remains the single destination
source for the systemd notifier and private Beszel relay. The notifier's static
test action uses the new fixed Hermes label. The relay recognizes only Beszel
0.18.7's exact built-in test body; exact matches receive the group-test label
and all other payloads retain the existing normal label.

**Tech Stack:** Python 3.12 standard library, `unittest`, systemd 255
credentials/sandboxing, Docker Compose, PocketBase REST API, Beszel 0.18.7,
Telegram Bot API.

---

## File structure

- `tests/operations/test_bmo_telegram_notify.py`: proves the static Hermes test
  action selects the exact group-test label.
- `ops/telegram/bmo_telegram_notify.py`: changes only the static test label;
  health alert and recovery behavior remain unchanged.
- `tests/operations/test_beszel_telegram_relay.py`: proves exact test-body
  relabeling and fail-closed handling of normal and near-match payloads.
- `ops/telegram/beszel_telegram_relay.py`: formats an exact Beszel built-in test
  body with the group-test label and every other payload with the existing
  normal label.
- `/usr/local/libexec/bmo-hermes-health-notify`: verified deployed notifier.
- `/usr/local/libexec/bmo-beszel-telegram-relay`: verified deployed relay.
- `/opt/bmo/config/telegram/chat-id`: atomically replaced root-owned group
  destination; the value is intentionally absent from tracked files.

### Task 1: Fixed Hermes group-test label

**Files:**
- Modify: `tests/operations/test_bmo_telegram_notify.py`
- Modify: `ops/telegram/bmo_telegram_notify.py`

- [ ] **Step 1: Write the failing CLI behavior test**

Add imports for `os`, `redirect_stdout`, `StringIO`, and `unittest.mock.patch`,
then add:

```python
class CommandTests(unittest.TestCase):
    def test_static_test_uses_exact_group_test_label(self) -> None:
        with tempfile.TemporaryDirectory() as credentials_directory:
            credentials = Path(credentials_directory)
            (credentials / "telegram-bot-token").write_text(
                "1:fake-token\n",
                encoding="utf-8",
            )
            (credentials / "telegram-chat-id").write_text(
                "-123\n",
                encoding="utf-8",
            )
            output = StringIO()
            with (
                patch.dict(
                    os.environ,
                    {"CREDENTIALS_DIRECTORY": credentials_directory},
                ),
                patch(
                    "ops.telegram.bmo_telegram_notify.send_telegram",
                ) as sender,
                redirect_stdout(output),
            ):
                result = main(["test"])

        self.assertEqual(result, 0)
        sender.assert_called_once()
        self.assertEqual(
            sender.call_args.args[2].splitlines()[0],
            "[P6 HERMES GROUP TEST]",
        )
        self.assertIn(
            "telegram_delivery=success label=direct_test",
            output.getvalue(),
        )
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
python3 -m unittest -v \
  tests.operations.test_bmo_telegram_notify.CommandTests
```

Expected: failure showing the current first line is
`[P6 HERMES PATH TEST]`.

- [ ] **Step 3: Implement the minimal fixed-label change**

Change only the static `test` action's first message line:

```python
"[P6 HERMES GROUP TEST]\n"
```

Do not alter `check`, the three-failure state machine, DOWN/RECOVERED messages,
credential validation, HTTP validation, or error sanitization.

- [ ] **Step 4: Run notifier verification**

Run:

```bash
python3 -m unittest -v tests.operations.test_bmo_telegram_notify
python3 -m py_compile ops/telegram/bmo_telegram_notify.py
```

Expected: all notifier tests pass and compilation exits zero.

### Task 2: Exact-match Beszel test relabeling

**Files:**
- Modify: `tests/operations/test_beszel_telegram_relay.py`
- Modify: `ops/telegram/beszel_telegram_relay.py`

- [ ] **Step 1: Write the failing exact-match test**

Add an HTTP-level test that POSTs the exact Beszel 0.18.7 body:

```python
def test_exact_beszel_builtin_test_payload_uses_group_test_label(self) -> None:
    messages: list[str] = []

    def sender(token: str, chat_id: str, message: str) -> None:
        messages.append(message)

    server = self.start_server(sender)
    status, body = self.request(
        server,
        "POST",
        "/notify",
        b"This is a notification from Beszel.",
    )

    self.assertEqual((status, body), (204, b""))
    self.assertEqual(
        messages,
        [
            "[BMO BESZEL GROUP TEST]\n"
            "This is a notification from Beszel.",
        ],
    )
```

- [ ] **Step 2: Add fail-closed regression tests**

Add an HTTP-level test that loops over these nonmatching payloads:

```python
near_matches = (
    "This is a notification from Beszel",
    "This is a notification from Beszel. ",
    " This is a notification from Beszel.",
    "This is a notification from Beszel.\n",
    "this is a notification from Beszel.",
    "This is a notification from Beszel. extra",
    "CPU averaged 91% for the previous 10 minutes.",
)
```

For each body, require HTTP `204` and:

```python
self.assertEqual(messages, [f"[BMO BESZEL]\n{payload}"])
self.assertNotIn("[BMO BESZEL GROUP TEST]", messages[0])
```

This proves there is no trim, case-fold, substring, prefix, or normalized
matching and that ordinary alerts retain the original label.

- [ ] **Step 3: Run the relay tests and verify RED**

Run:

```bash
python3 -m unittest -v tests.operations.test_beszel_telegram_relay
```

Expected: only the exact built-in test case fails because it receives the
existing `[BMO BESZEL]` label.

- [ ] **Step 4: Implement exact formatting**

Add:

```python
BESZEL_BUILT_IN_TEST_PAYLOAD = "This is a notification from Beszel."
BESZEL_ALERT_LABEL = "[BMO BESZEL]"
BESZEL_GROUP_TEST_LABEL = "[BMO BESZEL GROUP TEST]"


def format_telegram_message(message: str) -> str:
    label = (
        BESZEL_GROUP_TEST_LABEL
        if message == BESZEL_BUILT_IN_TEST_PAYLOAD
        else BESZEL_ALERT_LABEL
    )
    return f"{label}\n{message}"
```

Replace the current inline formatting with:

```python
format_telegram_message(message)
```

Do not change request validation, error handling, logging, response codes,
credential loading, bind address, or server behavior.

- [ ] **Step 5: Run the full notification suite**

Run:

```bash
python3 -m unittest -v \
  tests.operations.test_beszel_telegram_relay \
  tests.operations.test_bmo_telegram_notify \
  tests.operations.test_configure_beszel_telegram
python3 -m py_compile \
  ops/telegram/beszel_telegram_relay.py \
  ops/telegram/bmo_telegram_notify.py \
  ops/telegram/configure_beszel_telegram.py
git diff --check
```

Expected: every test passes, all three files compile, and the diff check is
clean.

### Task 3: Secure host activation

**Files:**
- Install: `/usr/local/libexec/bmo-hermes-health-notify`
- Install: `/usr/local/libexec/bmo-beszel-telegram-relay`
- Replace: `/opt/bmo/config/telegram/chat-id`

- [ ] **Step 1: Snapshot safe pre-change evidence**

Output only script hashes, credential metadata, systemd sandbox properties,
relay mount destinations/modes, container health, and published-port count.
Never output environment variables, credential contents, API bodies, request
URLs, or stored Shoutrrr values.

- [ ] **Step 2: Install verified scripts atomically**

Use a root-equivalent, network-disabled helper container with only the two
source files mounted read-only and `/usr/local/libexec` mounted read-write.
Create root-owned temporary files at the existing modes and rename them over
the deployed paths. Verify deployed hashes equal repository hashes.

- [ ] **Step 3: Atomically replace the chat credential**

Use a network-disabled root-equivalent helper container with only
`/opt/bmo/config/telegram` mounted read-write. Set `umask 077`, create the
temporary file in that directory, write the approved group identifier with one
trailing newline, set `root:root` mode `0600`, and rename it over `chat-id`.
The approved value is supplied only to the live command and is not stored in
this plan, shell history, logs, or repository.

- [ ] **Step 4: Validate credential state without values**

Report booleans proving the directory is `root:root` `0700`, both files are
regular/nonempty/single-line `root:root` `0600`, and the chat file equals the
approved group identifier. Do not output either value.

- [ ] **Step 5: Recreate and verify the relay**

Recreate only `bmo-telegram-relay` through the existing Compose project so its
read-only bind mount references the replaced inode. Verify:

```text
health=healthy
published_ports=0
read_only=true
cap_add_count=0
cap_drop_all=true
no_new_privileges=true
privileged=false
credential_mounts_read_only=true
```

Verify the Beszel Hub and Agent remain healthy and no unrelated container is
recreated.

- [ ] **Step 6: Verify systemd sandboxing remains unchanged**

Run `systemd-analyze verify` on the installed units and compare the effective
security properties with the pre-change snapshot. The units themselves are not
modified. Confirm the Hermes timer remains enabled and active.

### Task 4: Authenticated update and two automated receipts

- [ ] **Step 1: Configure Beszel through its authenticated API**

Run the verified root-owned configuration helper from a read-only,
capability-free helper container with host-loopback networking and read-only
access to the Beszel data directory. The database is opened read-only only to
mint a five-minute nonrefreshable token. Accept only:

```text
beszel_webhook_count=1
beszel_test_accepted=true
```

The helper PATCHes existing settings through the authenticated PocketBase API
and invokes Beszel's authenticated built-in test endpoint. It never edits the
database.

- [ ] **Step 2: Verify the stored target without displaying it**

Use authenticated API output in memory and print only:

```text
beszel_webhook_count=1
beszel_managed_target_is_internal_relay=true
```

Do not print the target, token, Authorization header, request body, or response
body.

- [ ] **Step 3: Send the Hermes group test**

Start `bmo-telegram-test.service`. Accept only service success and the sanitized
journal line:

```text
telegram_delivery=success label=direct_test
```

The delivered first line must be `[P6 HERMES GROUP TEST]`.

- [ ] **Step 4: Verify automated delivery and security evidence**

Require the relay journal to contain a new
`beszel_relay_delivery=success` entry for the authenticated test and no URL,
token, chat value, message body, or response body. Recheck both container and
systemd hardening, P7 `NOT_STARTED`, and `git status`. Do not push.

- [ ] **Step 5: Stop for manual receipt confirmation**

Report that both automated paths succeeded, identify the two expected labels,
and wait for explicit operator confirmation. Do not update receipt evidence or
claim the migration manually verified before confirmation. Do not start P7.
