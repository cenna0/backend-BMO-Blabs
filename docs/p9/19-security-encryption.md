# Security and Encryption — Frozen Requirements

## Existing controls

- Argon2id password hashes; short HS256 access JWT; opaque hashed/rotating refresh tokens with replay-family revocation.
- Pairing codes are keyed digests with 10-minute TTL, single use, five attempts, and mobile authentication.
- PostgreSQL has no host-published port; the host-networked integrated candidate reaches it only through a shared Unix-socket volume. Hermes and Audio Service are loopback-only; Caddy is the public edge.
- Device credential verifier is SHA-256 in the current schema; raw credential is provisioned out-of-band.

## Phase 2 port-5555 remediation

At the Phase 2 preflight, PID 217206 was confirmed as a manually started
`bmo-admin` Node process running Prisma Studio from the Backend workspace. It
was not owned by Docker, Compose, systemd, or a user service. Docker published
no port 5555 and the active sanitized Caddy config contained no 5555 route.
The process was terminated with `SIGTERM`; subsequent `ss`, `lsof`, process,
and local-connect checks found no listener or reachable service on port 5555.
Backend, PostgreSQL candidate, Hermes, Audio Service, and the other declared
containers remained healthy.

Passwordless privilege was unavailable, so UFW/nft policy could not be read.
That is retained as an operator evidence limitation for final topology sign-off,
not as an active Prisma Studio exposure: no process currently accepts the port.

## Target controls

- DOB recovery is intentionally weaker than provider/MFA recovery: use uniform failure, aggressive per-IP/email throttling, short single-use hashed token, audit, and logout-all after reset. Never return/store DOB in normal safe-user surfaces or logs.
- Keep proxy trust fixed to exactly one hop behind local Caddy. Real Express tests must prove the rightmost Caddy-supplied address owns the bucket and earlier forwarded entries cannot evade it. The in-memory store remains single-instance only.
- Encrypt Wi-Fi passwords and provider tokens with application AEAD, unique nonce/tag, and key version. Keep keys outside Git, DB, container image, and backups.
- Scope every query/action by authenticated user; validate physical binding before owner-only device payloads.
- Bound/redact logs, telemetry, upload metadata, provider errors, Hermes context, and bug-report attachments.
- Apply content type/size/transcode/opaque-path controls to avatar media.
- Public/private claims require Caddy, listener, container/network, and firewall evidence.
- Production migrations are explicit operator jobs after encrypted backup/restore and candidate evidence; never startup migration, `db push`, or reset.

Never document or log passwords, raw device/Wi-Fi/provider/Hermes/audio/database tokens, refresh/recovery/pairing values, session bytes, or database URLs.

Slice 1 now configures Express proxy trust as an explicit bounded hop count.
Production Compose sets exactly one trusted hop for local Caddy; the private
direct review candidate sets zero. Tests reject values above one, and real
router/Supertest cases prove attacker-controlled earlier `X-Forwarded-For`
entries cannot evade the rightmost-client bucket while distinct rightmost
clients remain separate. Public activation remains gated.

Slice 2B implements the weak MVP DOB recovery control in source: the two
verification failure cases share one sanitized envelope and timing-oriented
service path; IP and normalized-email counters are independent; the opaque
token lives for exactly 600 seconds and only its SHA-256 verifier is stored;
transactional compare-and-set permits one reset while revoking all session and
refresh families. Audits contain event/user/request identifiers only, never DOB
or the raw recovery token.

Avatar source limits multipart input to 5 MiB and JPEG/PNG/WebP declarations,
then verifies decoded metadata, bounds decoded pixels, strips metadata through
a WebP transcode, and writes a generated UUID key at mode 0600 in the dedicated
persistent Backend mount. Retrieval accepts only the exact UUID `.webp` path,
sets `image/webp`, `nosniff`, and immutable caching, and cannot address other
files. Compose declarations add no listener or public route. The review
candidate was not recreated and no production storage directory was created.
