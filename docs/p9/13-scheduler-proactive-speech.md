# Scheduler and Proactive Speech Architecture

**Status:** `LOCKED + PROPOSED`

Schedules are structured application records, never memories. The scheduler
owns due-run computation and delivery state; `MemoryGateway` is not involved.

## Records and worker

The minimum durable lifecycle is:

```text
Schedule
  → ScheduleRun (one unique occurrence)
  → ScheduleDeliveryAttempt (one target/attempt)
  → ScheduleAcknowledgement (optional user/device receipt)
```

The worker claims due runs transactionally, uses `idempotencyKey` and
`occurrenceKey` to prevent duplicate execution, computes recurring times in
the schedule timezone, and records every retry/error. A PostgreSQL-backed job
runner such as pg-boss may be evaluated during P9.3, but it is not installed or
selected by this documentation task. The durable schedule tables remain the
domain source of truth regardless of worker library.

The initial product has one server-enforced schedule timezone: `Asia/Jakarta`.
Mobile displays and submits schedule times in that timezone; timezone is not a
user-editable setting. Database timestamps remain UTC-compatible `timestamptz`
values. Future multi-timezone support would require a separate product
decision.

## Delivery policy

- One-time and recurring schedules are supported.
- DST gaps/folds use an explicit timezone policy recorded with the run.
- Missed runs use the schedule's selected policy: skip, run once on recovery,
  or run in the next configured window.
- Delivery targets are explicit: mobile notification or device speech.
- Retries are bounded, backoff is recorded, and a retry never creates a second
  logical occurrence.
- Acknowledgement is separate from delivery success.

## Proactive speech flow

```text
Due run
 → target authorization/availability
 → optional Hermes wording using bounded schedule context
 → Backend asks Audio Service for ephemeral speech
 → Backend emits dedicated scheduled-audio event lifecycle
 → device plays/acknowledges or mobile receives status
```

The existing request-bound `display_status`, `audio_ready`, and playback events
remain reserved for a device-initiated voice request. Scheduled audio gets a
separate contract namespace and idempotency key.

## Server-only limitation

With a server-only scheduler, the VPS must be powered, the worker healthy, and
the target reachable at execution time. The system cannot guarantee exact-time
speech when the server, network, Caddy, Backend, or device is offline. It must
report `MISSED`, `RETRYING`, or `DELIVERY_UNAVAILABLE` honestly and never claim
that a device played audio without a receipt.

## Future ESP32 offline-alarm fallback

An additive firmware design may later allow a device to receive a small,
signed, versioned alarm bundle containing schedule ID, local fire time, repeat
rule, timezone/clock version, and a preloaded local chime or approved audio
asset reference. The device uses its RTC only after time synchronization,
fires locally without VPS access, stores a bounded local receipt, and uploads
the receipt after reconnect. It cannot perform cloud actions, generate new
TTS, or invent schedule changes offline. Conflict resolution is Backend-owned
and the bundle is invalidated on revocation or ownership change.
