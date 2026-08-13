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

The WhatsApp implementation may only use a local Hermes interface proven from
the installed runtime. The Hermes documentation's `hermes whatsapp` command
and Baileys session are not treated as an HTTP API. If the installed runtime
does not expose a supported local bridge boundary readable by the operator,
implementation stops at the protected-access gate rather than guessing.

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

An approved Hermes inbound event is first normalized to an opaque provider
sender/reference and checked against the authenticated user's connection and
notification rules. The Backend stores sanitized delivery metadata only. If
the rule requests device speech, it enqueues the existing generic
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
