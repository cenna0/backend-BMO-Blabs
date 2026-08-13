# Scheduler and Generic Proactive Speech

**Backend:** `READY_TO_IMPLEMENT`
**Physical playback:** `PENDING_PHYSICAL_ESP`

Backend owns schedule definitions, due-run claiming, retries, idempotency, wording/audio orchestration, and delivery audit. PostgreSQL is the durable clock/state source; an in-memory timer is not.

Source/test status: the eight owner-scoped schedule REST routes, Jakarta
normalization (`Morning=09:00`, `Afternoon=13:00`, `Evening=18:00`), optimistic
version conflicts, database-clock occurrence/missed-run creation, atomic leases,
five-minute expiry, recurrence advance/one-shot completion, and one generic
`CHAT|SCHEDULE|WHATSAPP` delivery worker are implemented. The runtime installs no
physical sender. Device rows therefore remain `PENDING`; no playback is claimed.
Mobile-only targets persist as source-neutral delivery intents without inventing
a device identifier or a device-scoped status event.

Durable schedule states are `ACTIVE`, `PAUSED`, `CANCELLED`, and `COMPLETED`. UI labels such as `MONITORING` and `WEEKLY` describe presentation/frequency, not lifecycle state.

```text
Schedule -> unique due occurrence -> ScheduleRun lease
         -> generic ProactiveDelivery(source=SCHEDULE)
         -> optional Hermes wording -> Audio Service MP3
         -> proactive_audio_ready -> ESP acknowledgement/result
```

- Use an occurrence/idempotency key so restart/concurrency cannot speak twice.
- Record missed-run, retry, expiry, offline-device, receipt, and playback states separately.
- Chat and WhatsApp may create the same generic delivery type with different source metadata.
- Backend delivery success does not prove physical playback.
- Schedules never become memory automatically.
