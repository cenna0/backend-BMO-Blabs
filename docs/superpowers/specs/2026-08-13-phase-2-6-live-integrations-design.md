# Phase 2.6 Live WhatsApp and Spotify Candidate Integration Design

**Date:** 2026-08-13
**Scope:** Candidate environment only
**Baseline:** `a8a38023fc35bb52a0751ae2140428709dc6f910`

## Goal

Complete the live WhatsApp and Spotify provider boundaries against the isolated
candidate environment while preserving the existing Backend ownership model,
voice pipeline, generic proactive-delivery contract, and production runtime.

## Architecture

The Backend remains the only public application authority. Mobile and device
clients call the Backend; the Backend owns authenticated user identity,
connection metadata, rules, encrypted Spotify credentials, idempotency, audit
records, and delivery state. Hermes remains a private loopback runtime and owns
the WhatsApp session and provider conversation state. Spotify playback remains
on the user's Spotify Connect device; no Spotify audio enters Audio Service or
the ESP speaker path.

The Spotify implementation adds a concrete server-side Web API client. It uses
Authorization Code exchange, exact callback matching, single-use expiring state,
AES-256-GCM token envelopes, expiry-aware refresh, one bounded retry after a
401, and normalized provider errors. The action boundary explicitly allowlists
search, natural-language resolution inputs, playback/context selection, device
transfer, pause/resume/skip, seek, volume, shuffle, and repeat.

The WhatsApp implementation uses the installed Hermes 0.20.0 Baileys bridge
unchanged as a transport-only process for the user's personal WhatsApp
account. `hermes-gateway.service` keeps `WHATSAPP_ENABLED=false`; a separate
`joy-whatsapp-bridge.service` binds the official bridge to loopback
`127.0.0.1:3001` with the paired session at
`/home/hermes/.hermes/whatsapp/session` and `--mode bot`. `bot` is transport
semantics, not a second-number product identity. Joy Backend is the sole
`GET /messages` consumer and the launcher uses official
`WHATSAPP_DM_POLICY=pairing` only to admit events to the private queue. An
optional protected non-wildcard `WHATSAPP_ALLOWED_USERS` value is used only by
the official owner-forward gate; it is not a Backend notification filter. The
Backend independently owns `ALL`/`CONTACT`/explicit `GROUP` notification rules;
groups are disabled by default and never become Hermes prompts or privileged
tools. The Hermes gateway's group-policy variable is not treated as
enforcement.

## Spotify capability contract

The provider boundary exposes these operations:

- catalog search for track, artist, album, and playlist;
- URI/context resolution from a bounded natural-language query;
- start/resume, pause, next, previous;
- play a track, artist, album, or playlist URI/context;
- list devices, identify the active device, and transfer/select playback;
- current playback, seek, volume, shuffle, and repeat.

All requests receive the server-derived authenticated user's credential. Device
IDs, Spotify URIs, search terms, and action payloads are bounded and validated;
arbitrary user IDs, tokens, client secrets, provider URLs, and raw provider
responses are rejected or normalized. Spotify Premium/account/device limits
are returned as bounded provider outcomes, not translated into core-health
failures.

## WhatsApp data flow

An approved bridge inbound event is normalized to bounded provider metadata and
checked against the authenticated user's connection and Backend notification
rules. The message body is untrusted data and is never passed to Hermes
reasoning or privileged tools. Owner-typed events are metadata-only and do not
notify; `/send` echoes are suppressed by the official bridge tracker. The
Backend stores no raw message body. An enabled rule emits a generic mobile
notification and, if requested, enqueues the existing generic
`ProactiveDeliveryService` with source `WHATSAPP`; physical completion remains
`PENDING_PHYSICAL_ESP` without real ESP evidence. Outbound sends use the
existing preview, confirmation, ownership, idempotency, and delivery lifecycle.

## Security and external gates

Candidate provider secrets are read only from protected runtime locations and
are never committed, logged, returned to mobile, or included in documentation.
The candidate Backend remains loopback-bound. The Spotify callback diff is
prepared as a single exact Caddy path to `127.0.0.1:3010`, with health,
catalog, REST, and WebSocket paths excluded; activation requires explicit
operator authorization. WhatsApp pairing requires a physical QR scan. Hermes
session data remains in Hermes-owned persistent storage and is never copied to
the repository.

## Verification

Automated tests cover provider HTTP methods and normalization, OAuth exchange,
encrypted persistence, refresh and retry, invalid/revoked credentials,
allowlisted action validation, owner isolation, idempotency, and bounded
provider failures. Candidate acceptance covers real OAuth, Spotify devices and
actions, WhatsApp send/receive/status/persistence, provider isolation, and
restart persistence where external credentials and operator actions permit.
The existing auth, mobile WebSocket, chat/Hermes, memory, schedules, device
WebSocket, Wi-Fi, and whole-WAV voice regressions remain required. Production
promotion is explicitly outside this design.
