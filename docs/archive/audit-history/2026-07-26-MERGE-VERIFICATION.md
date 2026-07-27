# BMO Docs Merge Verification — 2026-07-26

**Result:** PASS

This package uses the previous hardware-handoff package as its base and applies only the newer STT/Kokoro runtime synchronization. Infrastructure, P6–P10 roadmap, and hardware-handoff documents are preserved.

## Current runtime values

```env
WHISPER_MODEL=medium
WHISPER_HOTWORDS=BMO
WHISPER_DEVICE=cpu
WHISPER_COMPUTE_TYPE=int8
WHISPER_CPU_THREADS=4
WHISPER_WORKERS=1
WHISPER_BEAM_SIZE=5
WHISPER_VAD=true

KOKORO_LANG_CODE=a
KOKORO_VOICE=af_heart
KOKORO_SPEED=0.80
```

Historical P2 evidence may still mention `small`; historical P5 UAT evidence may state that production default `1.0` had not yet changed at that test time. Addenda mark the later `0.80` deployment decision without rewriting historical evidence.

## Preserved handoff/infra scope

- `hardware-handoff/` retained.
- `roadmap/P6-P10-ROADMAP.md` retained.
- `/opt/bmo` production layout retained.
- Caddy/domain/Tailscale/Beszel/Telegram/backup/deployment decisions retained.
- Real RVC remains unverified and is still a P8 gate; Kokoro fallback remains valid.

## Hardware contract integrity

SHA-256: `633e398a7fa39a3ebc469af7f9ca46fd04890339bb132ec7de2c2286207c6a44`

The Hardware Contract v1.0.5 was not modified by this merge. STT model/hotword and Kokoro voice speed are internal runtime settings and do not change endpoint/event/WAV/MP3/auth/retry/error contracts.
