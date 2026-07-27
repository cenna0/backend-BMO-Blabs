# BMO Hardware Handoff — Current Backend Status

**Audited:** 2026-07-26

This file separates **protocol implemented locally** from **public VPS deployment proven**. Hardware should not interpret “implemented” as “reachable on the public domain”.

| Capability | Current status | Evidence boundary |
|---|---|---|
| Public HTTP/WebSocket contract implementation | VERIFIED — backend/local | P1/P5 backend evidence |
| WebSocket auth/close codes/connection replacement | VERIFIED — backend/local | automated + manual evidence |
| Heartbeat/reconnect state sync | VERIFIED — backend/local | P5 tests + 1-hour soak |
| Raw WAV validation/upload | VERIFIED — backend/local | automated + manual evidence |
| Idempotency/request conflict/device busy | VERIFIED — backend/local | P5 tests/manual evidence |
| Temp WAV/MP3 lifecycle + expiry | VERIFIED — backend/local | P5 tests/manual evidence |
| faster-whisper real inference | VERIFIED — local | P2 + P5 STT investigation |
| Current STT tuning `medium` + `BMO` hotword | SELECTED — local | P5 STT accuracy investigation |
| Kokoro real TTS | VERIFIED — local | P3/P5 manual evidence |
| Kokoro current runtime `af_heart` + speed `0.80` | SELECTED — local | P5 manual listening + 2026-07-26 runtime decision |
| FFmpeg MP3 24 kHz mono 96 kbps | VERIFIED — local generation | ffprobe evidence |
| Hermes real `/v1/responses` | VERIFIED — local integration | P5 manual evidence addendum |
| Real RVC inference | **NOT VERIFIED** | model/fallback exists; runtime inference pending P8 |
| Kokoro fallback when RVC unavailable | VERIFIED | P3/P5 evidence |
| BMO backend on production VPS/domain | **NOT VERIFIED** | P7 pending |
| `api.personalbmo.web.id` public E2E | **NOT RUN** | P7 pending |
| Physical ESP32 integration | **NOT RUN** | P10 pending |
| PostgreSQL/Prisma application data layer | **NOT IMPLEMENTED/DEPLOYED YET** | P9 planned |

## What the hardware team can do now

- implement firmware against the canonical contract and this handoff pack;
- build/test local state machine, WAV generation, retry/reconnect logic, and decoder behavior using fixtures/mocks;
- prepare the exact WSS/HTTP integration layer.

Before `DEPLOYMENT_STATUS` can become `VERIFIED`, P7 must re-audit the actual deployed source routes/events/runtime config against the canonical contract; documentation alone is not evidence of the live build.

## What requires backend deployment first

- real public WSS connection to `api.personalbmo.web.id`;
- real HTTPS WAV upload;
- real `audio_ready`/MP3 download through the production domain;
- physical end-to-end acceptance.

See [`DEPLOYMENT-CONFIG.md`](DEPLOYMENT-CONFIG.md) for the go/no-go marker.
