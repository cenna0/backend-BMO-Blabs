# Security and Encryption — Frozen Requirements

## Existing controls

- Argon2id password hashes; short HS256 access JWT; opaque hashed/rotating refresh tokens with replay-family revocation.
- Pairing codes are keyed digests with 10-minute TTL, single use, five attempts, and mobile authentication.
- PostgreSQL is private to the candidate network; Hermes and Audio Service are loopback-only; Caddy is the public edge.
- Device credential verifier is SHA-256 in the current schema; raw credential is provisioned out-of-band.

## Phase 1 blocker

A manually started Prisma Studio process listens on `*:5555`, is not part of declared Compose/systemd architecture, and can reach the candidate database. Current firewall rules could not be inspected without elevated privilege. This is `BLOCKED`: stop the process and verify listeners/firewall before Phase 2 or any deployment.

## Target controls

- DOB recovery is intentionally weaker than provider/MFA recovery: use uniform failure, aggressive per-IP/email throttling, short single-use hashed token, audit, and logout-all after reset. Never return/store DOB in normal safe-user surfaces or logs.
- Configure proxy-aware rate limiting deliberately for Caddy; current in-memory limiter and `trust proxy=false` require review before public activation.
- Encrypt Wi-Fi passwords and provider tokens with application AEAD, unique nonce/tag, and key version. Keep keys outside Git, DB, container image, and backups.
- Scope every query/action by authenticated user; validate physical binding before owner-only device payloads.
- Bound/redact logs, telemetry, upload metadata, provider errors, Hermes context, and bug-report attachments.
- Apply content type/size/transcode/opaque-path controls to avatar media.
- Public/private claims require Caddy, listener, container/network, and firewall evidence.
- Production migrations are explicit operator jobs after encrypted backup/restore and candidate evidence; never startup migration, `db push`, or reset.

Never document or log passwords, raw device/Wi-Fi/provider/Hermes/audio/database tokens, refresh/recovery/pairing values, session bytes, or database URLs.
