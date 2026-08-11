# P9 System Architecture — Frozen

```text
Mobile --HTTPS/WSS /api/v1/ws--> Caddy --> Backend API service
                                              |-- Prisma --> private PostgreSQL
                                              |-- loopback --> Hermes
                                              |-- loopback --> Audio Service
                                              |-- HTTPS --> Spotify
                                              `-- adapter --> Hermes-owned WhatsApp session

ESP32 --WSS /ws + HTTP raw WAV/MP3--> Caddy --> Backend API service
```

## Boundary rules

- Caddy owns TLS/routing only. Backend owns authentication, authorization, APIs, application state, orchestration, and audit.
- PostgreSQL owns durable BMO data. Hermes owns reasoning/personality and its WhatsApp session, not BMO application records.
- Audio Service owns bounded STT/TTS/FFmpeg processing, not identity or durable media.
- Mobile never calls PostgreSQL, Hermes, Audio Service, ESP, or provider APIs directly.
- ESP owns local Wi-Fi application, recording, playback, display, and firmware behavior. The VPS owns desired state and delivery records.
- Mobile realtime and device WSS are independent contracts.

## Frozen flows

### Pairing and identity

Mobile bearer creates/reads/claims/revokes a six-digit challenge. Claim supplies the out-of-band device credential. Later device authentication uses current runtime `device_id`/`device_token`; owner-only features bind only when an active Prisma Device matches hardware ID and SHA-256 token verifier.

Slice 1 implements this bridge in the single Backend runtime. Binding is
asynchronous after legacy credential success: the live socket remains voice-
capable when no row binds, while the registry exposes no application owner for
additive operations. The review candidate packages this runtime on loopback;
public Caddy routing and production deployment are unchanged.

### Wi-Fi

Mobile -> Backend authorization -> encrypted desired state in PostgreSQL -> device event queue -> ESP applies/reconnects -> receipt/result -> Backend state -> mobile realtime. First-boot connectivity is firmware-owned and unresolved.

### Chat

Mobile REST creates an idempotent message -> Backend persists -> bounded memory context -> Hermes -> Backend persists assistant result -> mobile realtime. Hermes has no direct DB access.

### Proactive speech and schedule

Schedule/WhatsApp/chat source -> Backend generic delivery -> optional Hermes wording -> Audio Service MP3 -> additive ESP event -> physical acknowledgement. Backend success is not playback success.

### Telemetry and settings

ESP sends sanitized logs/telemetry -> Backend validates/bounds -> PostgreSQL current state/audit -> mobile. Mobile settings -> Backend DB -> optional additive ESP settings event -> applied acknowledgement.
