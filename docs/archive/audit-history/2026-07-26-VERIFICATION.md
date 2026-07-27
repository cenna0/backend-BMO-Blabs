# BMO Docs Re-Verification — 2026-07-26

**Result:** PASS for documentation/handoff consistency  
**Source-code re-audit:** PENDING — backend source was not included in the uploaded ZIP

## Automated structural results

```text
Markdown files checked: 36
Broken local links: 0
Canonical source hash mismatches: 0
Missing handoff required sections: 0
Missing canonical event/error/close-code coverage: 0
Invented JSON event names in handoff examples: 0
Hardware acceptance tests: 25 unique IDs (HW-AT-001..HW-AT-025)
Detected Telegram/OpenAI-style secret patterns: 0
Deployment gate present: YES (NOT_VERIFIED)
Device token handoff sentinel present: YES (PROVIDED_OUT_OF_BAND)
```

## Canonical integrity

All preserved hashes match the original uploaded package:

```text
Hardware Contract v1.0.5: MATCH
PRD v1.2.0: MATCH
Archived Backend Implementation v1.0.5: MATCH
```

## Handoff coverage verified

### ESP32 → Backend

```text
authenticate
audio_playback_done
audio_playback_failed
```

### Backend → ESP32

```text
authenticated
authentication_failed
connection_replaced
display_status
audio_ready
request_failed
```

### Upload error coverage

```text
WEBSOCKET_NOT_CONNECTED
DEVICE_BUSY
INVALID_DEVICE_CREDENTIALS
MISSING_REQUIRED_HEADER
INVALID_REQUEST_ID
REQUEST_ID_CONFLICT
UNSUPPORTED_AUDIO_TYPE
AUDIO_TOO_LARGE
INVALID_AUDIO_FORMAT
```

### Pipeline error coverage

```text
NO_SPEECH
INVALID_AUDIO
STT_FAILED
HERMES_FAILED
TTS_FAILED
AUDIO_EXPIRED
PIPELINE_TIMEOUT
INTERNAL_ERROR
```

### Playback failure reasons

```text
DOWNLOAD_FAILED
DECODE_FAILED
PLAYBACK_FAILED
```

### WebSocket close codes

```text
4001
4003
4008
```

## Active-document stale marker check

The active entrypoint/reference docs no longer claim:

```text
Active implementation phase: P5
P1 status: READY, NOT AUTHORIZED
WHISPER_MODEL=small
TEMP_AUDIO_DIR=/opt/bmo-mvp/temp-audio
```

Historical evidence/PRD/archive may still contain old values in their original context and are explicitly labeled/lower authority.

## Manual semantic review points

Re-review confirmed:

- public protocol set is unchanged;
- `thinking`/HTTP `202` ordering is documented as race-safe;
- duplicate upload and duplicate `audio_ready` behavior is explicit;
- in-memory backend restart behavior is explicit;
- MP3 `404` vs expired `410 AUDIO_EXPIRED` distinction is explicit;
- RVC is not falsely claimed as real-verified;
- public domain is not falsely claimed as already deployed;
- database readiness does not move voice request state out of memory;
- Caddy/Tailscale/Beszel/backup decisions are separated from firmware protocol;
- production runtime uses built images rather than live source bind mounts;
- no real token/key from the conversation was copied into final docs.

## Remaining external verification gates

The documentation package itself is ready. These are intentionally still pending implementation evidence:

1. P6 VPS foundation.
2. P7 public `api.personalbmo.web.id` deployment and external fake ESP32 E2E.
3. P8 real RVC inference + resource benchmark.
4. P9 PostgreSQL/Prisma readiness + restore test.
5. P10 physical ESP32 acceptance.
6. Fresh source-aware docs-vs-code audit from the actual Git checkout during P7/P10.

Until P7 passes, `hardware-handoff/DEPLOYMENT-CONFIG.md` must remain `NOT_VERIFIED`.
