# Spotify Integration

**Adapter/API:** `SOURCE_VERIFIED` at source/test tier
**Live OAuth:** `BLOCKED_EXTERNAL_SECRET` until app credentials, protected provider-key secret, and exact callback registration are proven.

Backend is the confidential OAuth client and token/action owner. The frozen flow uses server-side Authorization Code, exact allow-listed callback, single-use expiring state, least scopes, encrypted token storage, and server refresh. Mobile receives only normalized connection/playback state.

The candidate route surface includes the callback, normalized search, device and active-device discovery, playback state, and action execution. The explicit allowlist covers search/resolution, play/resume, pause, next, previous, track, artist, album, playlist, transfer/select device, seek, volume, shuffle, repeat, and queue. Each is ownership-checked, allow-listed, confirmed when policy requires, idempotent where possible, and audited without raw provider payloads.

Spotify playback occurs on a user's Spotify device, not the BMO speaker. No active player yields `NO_ACTIVE_SPOTIFY_DEVICE`. Client secret, access/refresh token, authorization code, and provider body never enter mobile state, Hermes context, logs, chat, memory, or exports.

Provider authorization behavior must be rechecked against current official Spotify documentation during implementation.

Phase 2.6 source now includes a concrete bounded Spotify Web API client, exact
Authorization Code exchange, single-use expiring `OAuthState`, AES-256-GCM
provider-token envelope, expiry-aware refresh with one bounded 401 retry,
normalized search/device/playback results, explicit action mapping, and safe
plugin status. Candidate runtime acceptance remains blocked until credentials,
protected provider-key provisioning, callback registration, and a real Spotify
account/device are available. No Spotify audio is routed through Audio Service
or the ESP speaker.
