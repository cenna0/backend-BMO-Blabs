# Source-of-Truth Matrix — Frozen

| Data/decision | Source of truth | Derived/cache only |
|---|---|---|
| Account/profile/DOB credential | PostgreSQL | access-token claims |
| Session/refresh revocation | PostgreSQL | mobile secure storage holds raw refresh token |
| Device ownership/pairing | PostgreSQL | live socket registry |
| Physical authenticated connection | Backend in-memory device socket registry | PostgreSQL binding resolves owner capability |
| User/device/personalization settings | PostgreSQL | ESP applied/current cache |
| Wi-Fi desired state | encrypted PostgreSQL record | ESP local active network; mobile status |
| Chat/history | PostgreSQL | Hermes request context |
| Curated memory | PostgreSQL via MemoryGateway | bounded prompt context |
| Schedule/run/delivery | PostgreSQL | worker lease/in-memory timer |
| Device telemetry current state/logs | PostgreSQL with bounded retention | observability metrics |
| Generic proactive delivery | PostgreSQL | live socket attempt |
| Spotify tokens/action audit | encrypted PostgreSQL + provider playback truth | normalized Hermes/mobile result |
| WhatsApp session | Hermes/provider persistence | PostgreSQL connection metadata/rules/delivery audit |
| Existing voice request lifecycle | Backend in-memory registry | temporary WAV/MP3 artifacts |
| STT/TTS model state | Audio Service runtime | Backend readiness summary |
| Public routing/TLS | Caddy active runtime config | repository templates |

If source and runtime differ, the integration status must name both tiers; neither docs nor a client cache may silently override the owner above.
