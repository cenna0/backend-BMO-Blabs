# Spotify Integration Boundary

**Status:** `PROPOSED`

Backend owns Spotify OAuth, token encryption, provider calls, action policy,
and normalized status. Mobile owns the consent UI; Hermes may propose a typed
action but never receives tokens or calls Spotify directly.

## OAuth boundary

```text
Mobile → Backend creates state and authorization URL
       → Spotify consent
       → Backend callback validates state + exact redirect
       → Backend exchanges code and encrypts access/refresh tokens
       → Mobile receives connection status only
```

The initial implementation should re-check current Spotify policy and use the
server-side Authorization Code flow when the client secret is protected by the
Backend. PKCE remains the alternative when an authorization code is handled by
the mobile client. Redirect URIs are exact allow-listed values and state is
single-use. Current official guidance distinguishes these flows and requires
refresh handling; the implementation phase must pin the applicable scopes and
policy rather than copying an old scope list.

Reference: [Spotify authorization guidance](https://developer.spotify.com/documentation/web-api/concepts/authorization).

## Action boundary

Supported initial action families are play/search, pause, resume, next,
previous, volume, shuffle, current playback, queue, and device listing. Each
action is user-scoped, validated against an allowlist, idempotent where the
provider permits it, and recorded as a redacted `SpotifyAction`.

Spotify playback happens on the user's active Spotify device, not through the
BMO speaker. If no active device exists, Backend returns a distinct
`NO_ACTIVE_SPOTIFY_DEVICE` result and BMO gives a short honest response.

## Credential policy

- Encrypt access and refresh tokens before PostgreSQL storage using an
  application key-management boundary and `keyVersion`.
- Keep client secret, tokens, authorization codes, and verifiers out of logs,
  chat history, memory, exports, mobile state, and Hermes payloads.
- Revoke/disconnect deletes ciphertext after provider revocation confirmation
  or records a bounded cleanup retry.
- Provider response is normalized to status/device metadata; raw payload is not
  returned to Hermes by default.
