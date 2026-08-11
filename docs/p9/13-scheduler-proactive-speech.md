# Scheduler and Generic Proactive Speech

**Backend:** `READY_TO_IMPLEMENT`
**Physical playback:** `PENDING_PHYSICAL_ESP`

Backend owns schedule definitions, due-run claiming, retries, idempotency, wording/audio orchestration, and delivery audit. PostgreSQL is the durable clock/state source; an in-memory timer is not.

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
