# Spotify Integration

**Adapter/API:** `READY_TO_IMPLEMENT`
**Live OAuth:** `BLOCKED` until app credentials and exact callback registration are proven.

Backend is the confidential OAuth client and token/action owner. The frozen flow uses server-side Authorization Code, exact allow-listed callback, single-use expiring state, least scopes, encrypted token storage, and server refresh. Mobile receives only normalized connection/playback state.

Initial route surface is enumerated in the integration matrix, including `GET /api/v1/integrations/spotify/callback`. Initial actions are play/search, pause/resume, next/previous, volume, shuffle, queue, current playback, and device list. Each is ownership-checked, allow-listed, confirmed when policy requires, idempotent where possible, and audited without raw provider payloads.

Spotify playback occurs on a user's Spotify device, not the BMO speaker. No active player yields `NO_ACTIVE_SPOTIFY_DEVICE`. Client secret, access/refresh token, authorization code, and provider body never enter mobile state, Hermes context, logs, chat, memory, or exports.

Provider authorization behavior must be rechecked against current official Spotify documentation during implementation.
