# Spotify Integration

**Adapter/API:** `EXISTING_VERIFIED` at source/test tier
**Live OAuth:** `BLOCKED_EXTERNAL_SECRET` until app credentials, protected provider-key secret, and exact callback registration are proven.

Backend is the confidential OAuth client and token/action owner. The frozen flow uses server-side Authorization Code, exact allow-listed callback, single-use expiring state, least scopes, encrypted token storage, and server refresh. Mobile receives only normalized connection/playback state.

Initial route surface is enumerated in the integration matrix, including `GET /api/v1/integrations/spotify/callback`. Initial actions are play/search, pause/resume, next/previous, volume, shuffle, queue, current playback, and device list. Each is ownership-checked, allow-listed, confirmed when policy requires, idempotent where possible, and audited without raw provider payloads.

Spotify playback occurs on a user's Spotify device, not the BMO speaker. No active player yields `NO_ACTIVE_SPOTIFY_DEVICE`. Client secret, access/refresh token, authorization code, and provider body never enter mobile state, Hermes context, logs, chat, memory, or exports.

Provider authorization behavior must be rechecked against current official Spotify documentation during implementation.

Phase 2 source now exposes the frozen owner-scoped routes, exact callback allowlist,
single-use expiring `OAuthState`, AES-256-GCM provider-token envelope, normalized
device/playback results, allowlisted action/idempotency/confirmation records, and
the two-plugin safe catalog. The provider adapter remains an injected boundary;
without external credentials it fails closed and never returns tokens to mobile.
