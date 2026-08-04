# Proposed Additive Hardware Events

**Status:** `PROPOSED — DOES NOT MODIFY v1.0.5`

Hardware Contract v1.0.5 remains byte-for-byte unchanged in this branch. The
following is a future additive proposal, tentatively named **HW Contract
v1.1.0**, to be reviewed and versioned with the hardware team before any
firmware or Backend implementation.

## Dedicated lifecycle

Backend → device:

```json
{
  "event": "scheduled_audio_ready",
  "schedule_run_id": "<opaque-id>",
  "delivery_attempt_id": "<opaque-id>",
  "audio_url": "https://api.personalbmo.web.id/scheduled-audio/<id>.mp3",
  "expires_at": "<iso-8601>",
  "idempotency_key": "<opaque-key>",
  "format": "mp3"
}
```

Device → Backend:

```json
{
  "event": "scheduled_audio_playback_done",
  "schedule_run_id": "<opaque-id>",
  "delivery_attempt_id": "<opaque-id>",
  "idempotency_key": "<opaque-key>",
  "played_at": "<iso-8601>"
}
```

Failure/expiry lifecycle:

```text
scheduled_audio_ready
  → scheduled_audio_playback_done
  → scheduled_audio_acknowledged

or

scheduled_audio_ready
  → scheduled_audio_playback_failed
  → scheduled_audio_expired
```

The exact event list, ack semantics, download retry, TTL, offline behavior,
clock rules, and error codes are OPEN until a hardware review. The names are
deliberately not aliases for `audio_ready`, `audio_playback_done`, or
`request_failed`.

## Compatibility rules

- v1.0.5 devices continue using only their existing request-bound lifecycle.
- Backend feature-detects the additive version or targets mobile-only delivery
  when scheduled-audio capability is absent.
- A scheduled event never carries credentials, raw WAV, provider tokens, or
  unbounded text.
- Scheduled audio has its own temporary URL namespace and cleanup policy.
- No P9 architecture document authorizes a firmware change.
