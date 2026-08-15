# Spotify Integration

**Source state:** `SOURCE_READY`

**Candidate runtime:** `CANDIDATE_RUNTIME_READY` only after the immutable
candidate image is built

**Live OAuth:** `BLOCKED_EXTERNAL_SECRET`

The Backend is the confidential Spotify OAuth client, credential owner,
refresh authority, provider adapter, and Spotify Connect action executor.
Mobile calls authenticated BMO routes; Hermes may request only a validated
semantic action. Neither component receives a Spotify access token, refresh
token, client secret, provider URL, endpoint, or raw provider response.

Spotify audio remains on the user's Spotify device. It never routes through the
BMO speaker, Audio Service, Piper, Kokoro, or the device proactive-audio path.

## Exact scopes

- `user-read-private`: store the Spotify user ID and account market.
- `user-read-playback-state`: list devices and read current playback.
- `user-modify-playback-state`: play, pause, skip, seek, volume, shuffle,
  repeat, and transfer playback.
- `playlist-read-private`: resolve the user's private playlists.

No `streaming`, email, library-write, playlist-write, or collaborative-playlist
scope is requested.

## Credential lifecycle

The access and refresh tokens are encrypted with AES-256-GCM using the dedicated
`SPOTIFY_TOKEN_ENCRYPTION_KEY`. Only ciphertext, nonce, authentication tag, key
version, expiry, scopes, Spotify account metadata, authorization timestamp, and
preferred device are persisted. The key is loaded only from a protected secret
file in candidate/runtime configuration.

Spotify refresh tokens do not expose issuance time. The Backend stores
`authorizedAt`, treats six calendar months as the reauthorization deadline, and
transitions to `RECONNECT_REQUIRED` after the deadline or provider
`invalid_grant`. Unusable credential rows are deleted. Refresh is keyed
single-flight and database-lock guarded; a replacement refresh token is stored
atomically, while an omitted replacement preserves the existing ciphertext.

## OAuth

`POST /api/v1/integrations/spotify/connect` returns only an authorization URL.
The state is 32 random bytes represented as a URL-safe hex value; only its
SHA-256 verifier is persisted in `OAuthState`. It is tied to the authenticated
BMO user, exact configured redirect URI, ten-minute expiry, and single-use
claim. The callback does not trust a Mobile bearer token. It derives ownership
only from validated state and never logs the callback code or provider token
response.

Candidate OAuth uses an exact operator loopback redirect, for example:

```text
http://127.0.0.1:<operator-port>/api/v1/integrations/spotify/callback
```

The operator forwards that local port through SSH to VPS `127.0.0.1:3010`.
Candidate Caddy remains unchanged. Production redirect registration is a later
Production Promotion concern.

## Playback and device policy

The semantic action set is:

```text
PLAY, PLAY_TRACK, PLAY_ARTIST, PLAY_ALBUM, PLAY_PLAYLIST,
RESUME, PAUSE, NEXT, PREVIOUS, SEEK, VOLUME, SHUFFLE, REPEAT, TRANSFER, SEARCH
```

Natural-language resolution is bounded, deterministic, market-aware, and does
not require popularity ranking. Device selection is explicit requested device,
valid preferred device, active device, then typed `NO_ACTIVE_DEVICE`. A missing
device never returns a fake success. Playback-control 403 is projected as
`PREMIUM_REQUIRED`; 401/`invalid_grant`, 429, timeout, and 5xx outcomes are
projected as stable BMO-safe errors without provider bodies.

`QUEUE` and arbitrary Spotify proxying are outside Phase 2.6.
