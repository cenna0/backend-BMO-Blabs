# P6 Telegram and Hermes Health Notification Design

**Date:** 2026-07-28
**Scope:** P6 only
**Status:** Approved for implementation

## Goal

Complete the P6 Telegram gate without exposing the bot token. Configure the
existing Beszel Hub to send Telegram alerts and add an independent host health
check for the loopback-only Hermes service. Send one labeled test through each
path and require operator confirmation that both arrived.

This work does not deploy or modify P7 application services.

## Credential boundary

Runtime credentials live outside Git:

```text
/opt/bmo/config/telegram/             root:root 0700
/opt/bmo/config/telegram/bot-token    root:root 0600
/opt/bmo/config/telegram/chat-id      root:root 0600
```

The operator enters the token from `/dev/tty` with terminal echo disabled. The
command text contains no token. The chat identifier is installed separately
without recording its value in repository documentation or sanitized evidence.

The token must not appear in:

- chat or agent history;
- shell command arguments or environment variables;
- systemd unit text or journal output;
- Git, documentation, or evidence;
- diagnostic command output.

The host notifier receives both files through systemd `LoadCredential`. Its
Python process reads them from the service credential directory and calls the
Telegram HTTPS API in-process, so the token never becomes a child-process
argument. Beszel necessarily stores its Shoutrrr URL in protected Hub data;
that data and its backups are treated as credential-bearing recovery material.

## Notification paths

### Beszel

Configure the existing authenticated user settings through Beszel's loopback
API, not by editing the live SQLite database. Preserve existing settings and
add one Telegram Shoutrrr URL targeting the configured private chat. Assemble
the documented Telegram scheme only in process memory. Beszel stores the
resulting URL in its Hub database; this design does not assume that field is
encrypted, so Hub data and backups remain credential-bearing material.

Use Beszel's notification-test action for a labeled P6 Beszel test. Never print
the request body, stored URL, response body, or authorization material.

### Hermes health

Install a small host notifier, a timer/service pair, and a static test service:

```text
/usr/local/libexec/bmo-hermes-health-notify
/etc/systemd/system/bmo-hermes-health-notify.service
/etc/systemd/system/bmo-hermes-health-notify.timer
/etc/systemd/system/bmo-telegram-test.service
```

The timer runs once per minute. The notifier requests
`http://127.0.0.1:8642/health` with a short timeout and validates a successful
HTTP response whose JSON contains `status=ok`, `platform=hermes-agent`, and the
expected installed version.

Persistent state records only:

```text
consecutive failure count
whether a down alert has already been sent
```

State transitions:

```text
healthy
  -> reset failure count
  -> if previously alerted down, send one recovery notification and clear it

unhealthy, failures 1-2
  -> increment count
  -> do not notify

unhealthy, failure 3
  -> send one critical down notification
  -> mark down alert sent

unhealthy after failure 3
  -> retain down state
  -> do not send repeated alerts
```

If Telegram delivery fails, retain the pending state so the next timer run can
retry rather than falsely recording a successful notification.

The health and test services use `DynamicUser`, systemd credentials, systemd
sandboxing, no new privileges, a private temporary directory, a service-owned
state directory, restricted filesystem access, and only the address families
required for loopback health and Telegram HTTPS. The test service is static and
cannot be enabled as a recurring service.

## Testing

Before activation:

- test token-file absence and malformed state handling without a real token;
- test the state machine for healthy, failures one through three, repeated
  failure, recovery, and notification-send failure;
- validate both unit files and confirm their credential paths;
- confirm no token-shaped value appears in tracked or modified files.

After the operator installs the token:

1. verify directory/file owner and modes without printing contents;
2. validate the bot identity and target delivery without logging the URL or
   response body;
3. configure Beszel and confirm one Telegram webhook exists using a boolean or
   count only;
4. send a labeled Beszel test;
5. send a labeled Hermes-notifier test without changing Hermes health;
6. ask the operator to confirm both messages arrived;
7. enable the timer, run a normal healthy check, and verify sanitized service
   state and logs;
8. rerun the P6 audit and update sanitized evidence.

P6 remains in progress until both labeled test messages are confirmed received.

## Recovery and rotation

Token rotation replaces only the root-owned token file using the same hidden
interactive procedure, updates the Beszel Shoutrrr URL through its authenticated
API, sends both tests again, and then revokes the previous token.

If notification delivery fails, verify file metadata, bot reachability, the
configured target, Beszel webhook presence, timer state, and sanitized journal
errors. Never print the token or the complete Telegram/Shoutrrr URL during
diagnosis.
