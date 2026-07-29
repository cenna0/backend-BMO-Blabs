# P6 Telegram Group Target Design

**Status:** APPROVED

**Goal:** Move both existing P6 Telegram notification paths to the
`monitorvpsBMO` group, prove them with exact labeled receipt tests, and preserve
all existing P6 security controls without starting P7.

## Scope

This is a P6 maintenance change. P7 remains `NOT_STARTED`.

The change updates the root-owned Telegram chat credential atomically, refreshes
the private relay so it reads the replacement file, and updates Beszel's managed
Shoutrrr target through Beszel's authenticated HTTP API. No database write,
credential disclosure, security-control reduction, push, or P7 work is allowed.

## Test labels

The static Hermes receipt action sends:

```text
[P6 HERMES GROUP TEST]
```

Beszel 0.18.7's authenticated test endpoint supplies this fixed body:

```text
This is a notification from Beszel.
```

The private relay compares the decoded request body to that exact string. Only
an exact match is relabeled:

```text
[BMO BESZEL GROUP TEST]
This is a notification from Beszel.
```

Every other nonempty payload retains the existing behavior:

```text
[BMO BESZEL]
<original payload>
```

Matching is deliberately strict. There is no trimming, case folding, substring
matching, prefix matching, or punctuation normalization. If a future Beszel
release changes the built-in body, the request is delivered as a normal Beszel
message and never receives the group-test label. This is the fail-closed
behavior for labeling.

## Activation flow

1. Add regression tests for the fixed Hermes label, the exact Beszel test-body
   rewrite, and representative near-match/non-test payloads that must retain the
   normal label.
2. Implement only the behavior required by those tests and rerun the complete
   P6 notification test suite.
3. Install the verified notifier and relay scripts without changing their
   owners, modes, credential-loading model, network exposure, or sandboxing.
4. Atomically replace `/opt/bmo/config/telegram/chat-id` using a temporary
   mode-`0600`, root-owned file in the same directory followed by rename.
5. Validate the credential directory and both credential files using metadata
   and booleans only. Never print either credential value.
6. Recreate the private relay container so its read-only file bind mount
   references the replacement chat-ID inode. Verify it is healthy, has no
   published port, and retains all existing container hardening.
7. Run the Beszel configuration helper. It obtains short-lived authentication
   material in memory, patches the existing settings through the loopback API,
   preserves unrelated settings, and calls Beszel's authenticated built-in test
   endpoint. Neither the token nor the complete Shoutrrr target is printed.
8. Start the static Hermes test service. Both paths accept success only after
   Telegram returns HTTP 2xx and decoded boolean `ok=true`.
9. Stop after both automated sends succeed and wait for the operator to confirm
   receipt of the two exact labels.

## Security invariants

- The bot token and complete Shoutrrr target never appear in output, logs,
  process arguments, shell history, repository changes, or evidence.
- `/opt/bmo/config/telegram` remains `root:root` mode `0700`.
- Both credential files remain regular, nonempty, single-line `root:root`
  mode-`0600` files.
- Systemd credential loading and every existing service sandbox directive
  remain unchanged.
- The relay remains private, read-only, capability-free, non-privileged, and
  without a published host port.
- Beszel settings are changed only through its authenticated API. The local
  database may be read to mint the existing short-lived authentication token,
  but it is never edited directly.
- Normal Beszel alert text and labels remain unchanged.
- P7 remains `NOT_STARTED`, and no Git push occurs.

## Verification

Automated verification must prove:

- exact Hermes group-test label selection;
- exact Beszel built-in payload relabeling;
- near-match and ordinary alert payloads retain `[BMO BESZEL]`;
- notification unit syntax and sandbox properties remain valid;
- repository tests, compilation, and diff checks pass;
- protected credential metadata and requested-chat match return booleans only;
- Beszel API update reports one managed target and accepts its test;
- the relay remains healthy and private;
- both strict Telegram sends report success;
- P7 documentation and runtime state remain `NOT_STARTED`.

Manual receipt confirmation remains the final gate. No documentation may claim
the new group receipts were confirmed until the operator confirms both.
