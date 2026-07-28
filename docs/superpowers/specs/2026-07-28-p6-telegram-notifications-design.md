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
argument. The Beszel Hub stores only a token-free generic webhook for an
internal relay. The relay receives the same root-owned credential files as
read-only container mounts, so neither the Telegram token nor a token-bearing
Shoutrrr URL is stored in the Hub database.

A Telegram API operation succeeds only when the HTTPS request completes with a
successful HTTP status and the decoded Telegram response contains boolean
`ok=true`. A client error, non-success HTTP status, invalid JSON, non-boolean
`ok`, or `ok=false` is a failure. Error output contains only a bounded error
category and, where available, the numeric HTTP status; it never contains the
request URL, response body, token, or chat identifier.

## Notification paths

### Beszel

Configure the existing authenticated user settings through Beszel's loopback
API, not by editing the live SQLite database. Preserve existing settings and
add one token-free generic webhook targeting an internal
`telegram-relay` Compose service.

The pinned Shoutrrr 0.14.1 Telegram client cannot be used for this boundary: it
can discard a transport/API error and return success. The relay instead reuses
the strict in-process Telegram client described above. It returns HTTP success
to Beszel only after Telegram itself returned HTTP 2xx and boolean `ok=true`;
all other outcomes return a fixed error status and sanitized body. The relay
has no published host port, runs read-only with all capabilities dropped and
core dumps disabled, and logs only a bounded result category.

Use Beszel's notification-test action for a labeled P6 Beszel test. Never print
the request body, stored URL, response body, or authorization material.

### Hermes health

Install a small host notifier, a timer/service pair, and a static test service:

```text
/usr/local/libexec/bmo-hermes-health-notify
/usr/local/libexec/bmo-beszel-telegram-relay
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
cannot be enabled as a recurring service. Both credential-consuming systemd
services set `LimitCORE=0`.

## Testing

Before activation:

- test token-file absence and malformed state handling without a real token;
- test the state machine for healthy, failures one through three, repeated
  failure, recovery, and notification-send failure;
- test that the Beszel relay returns success only after the strict sender
  succeeds, maps delivery failure to a fixed error, and never logs request
  paths or exception messages;
- validate all three unit files and confirm their credential paths;
- confirm no token-shaped value appears in tracked or modified files.

After the operator installs the token:

1. verify directory/file owner and modes without printing contents;
2. validate the bot identity and target delivery without logging the URL or
   response body, requiring both HTTP success and Telegram `ok=true`;
3. start the private relay and confirm it has no published host port;
4. configure Beszel and confirm one managed relay webhook exists using a
   boolean or count only;
5. send a labeled Beszel test through the relay;
6. send a labeled Hermes-notifier test without changing Hermes health;
7. ask the operator to confirm both messages arrived;
8. enable the timer, run a normal healthy check, and verify sanitized service
   state and logs;
9. rerun the P6 audit and update sanitized evidence.

P6 remains in progress until both labeled test messages are confirmed received.

## Recovery and rotation

Token rotation replaces only the root-owned token file using the same hidden
interactive procedure, restarts the private relay so it reloads the
credential, sends both tests again, and then revokes the previous token.

If notification delivery fails, verify file metadata, bot reachability, the
configured target, Beszel webhook presence, timer state, and sanitized journal
and relay errors. Never print the token or a Telegram request URL during
diagnosis.
