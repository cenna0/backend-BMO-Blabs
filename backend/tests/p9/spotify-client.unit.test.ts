import { describe, expect, it, vi } from "vitest";

import { SpotifyApiClient, SpotifyProviderError } from "../../src/p9/providers/spotify.client.js";

function response(body: unknown, status = 200): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("SpotifyApiClient", () => {
  it("exchanges an authorization code using the confidential server client", async () => {
    const fetcher = vi.fn().mockResolvedValue(response({
      access_token: "access-secret",
      refresh_token: "refresh-secret",
      expires_in: 3600,
      scope: "user-read-private user-modify-playback-state",
    }));
    const client = new SpotifyApiClient({ clientId: "client-id", clientSecret: "client-secret", fetcher });

    await expect(client.exchangeCode("authorization-code", "https://api.example/callback")).resolves.toEqual({
      accessToken: "access-secret",
      refreshToken: "refresh-secret",
      expiresIn: 3600,
      scopes: ["user-read-private", "user-modify-playback-state"],
    });
    expect(fetcher).toHaveBeenCalledWith("https://accounts.spotify.com/api/token", expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ authorization: expect.stringMatching(/^Basic /u), "content-type": "application/x-www-form-urlencoded" }),
    }));
    const init = fetcher.mock.calls[0]?.[1] as RequestInit;
    expect(String(init.body)).toContain("grant_type=authorization_code");
    expect(String(init.body)).toContain("redirect_uri=https%3A%2F%2Fapi.example%2Fcallback");
    expect(String(init.body)).not.toContain("client-secret");
  });

  it("normalizes search results without returning the raw provider envelope", async () => {
    const fetcher = vi.fn().mockResolvedValue(response({
      tracks: { items: [{ id: "t1", name: "Backburner", uri: "spotify:track:t1", artists: [{ name: "NIKI" }] }] },
      artists: { items: [{ id: "a1", name: "NIKI", uri: "spotify:artist:a1" }] },
      albums: { items: [] },
      playlists: { items: [] },
      secret_provider_field: "must-not-leak",
    }));
    const client = new SpotifyApiClient({ clientId: "id", clientSecret: "secret", fetcher });

    await expect(client.search("access-token", "Backburner", ["track", "artist"])).resolves.toEqual({
      tracks: [{ id: "t1", name: "Backburner", uri: "spotify:track:t1", artists: ["NIKI"] }],
      artists: [{ id: "a1", name: "NIKI", uri: "spotify:artist:a1" }],
      albums: [],
      playlists: [],
    });
    expect(fetcher.mock.calls[0]?.[0]).toContain("type=track%2Cartist");
    const requestHeaders = fetcher.mock.calls[0]?.[1] && new Headers((fetcher.mock.calls[0]?.[1] as RequestInit).headers);
    expect(requestHeaders?.get("authorization")).toBe("Bearer access-token");
    expect(requestHeaders?.get("accept")).toBe("application/json");
  });

  it("passes the authenticated account market to search", async () => {
    const fetcher = vi.fn().mockResolvedValue(response({ tracks: { items: [] }, artists: { items: [] }, albums: { items: [] }, playlists: { items: [] } }));
    const client = new SpotifyApiClient({ clientId: "id", clientSecret: "secret", fetcher });

    await client.search("access-token", "Backburner", ["track"], "ID");

    expect(fetcher.mock.calls[0]?.[0]).toContain("market=ID");
  });

  it("normalizes the current Spotify account without exposing provider fields", async () => {
    const fetcher = vi.fn().mockResolvedValue(response({ account_id: "spotify-account", id: "spotify-profile", country: "ID", product: "premium", email: "secret@example.test" }));
    const client = new SpotifyApiClient({ clientId: "id", clientSecret: "secret", fetcher });

    const currentUser = await client.currentUser("access-token");
    expect(currentUser).toEqual({ accountId: "spotify-account", profileId: "spotify-profile", market: "ID", product: "premium" });
    const requestHeaders = fetcher.mock.calls[0]?.[1] && new Headers((fetcher.mock.calls[0]?.[1] as RequestInit).headers);
    expect(requestHeaders?.get("authorization")).toBe("Bearer access-token");
    expect(requestHeaders?.get("authorization")).not.toContain("spotify-account");
    expect(JSON.stringify(currentUser)).not.toContain("access-token");
  });

  it("requires Spotify account_id and never falls back to the mutable profile id", async () => {
    const fetcher = vi.fn().mockResolvedValue(response({ id: "spotify-profile", country: "ID", product: "premium" }));
    const client = new SpotifyApiClient({ clientId: "id", clientSecret: "secret", fetcher });

    await expect(client.currentUser("access-token")).rejects.toMatchObject({ code: "INVALID_PROVIDER_RESPONSE" });
  });

  it("maps the explicit playback capability set to allowlisted Spotify endpoints", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response({ devices: [{ id: "d1", name: "Laptop", type: "Computer", is_active: true, is_restricted: false, volume_percent: 50, supports_volume: true }] }))
      .mockResolvedValueOnce(response(null, 204))
      .mockResolvedValueOnce(response(null, 204))
      .mockResolvedValueOnce(response(null, 204))
      .mockResolvedValueOnce(response(null, 204))
      .mockResolvedValueOnce(response(null, 204))
      .mockResolvedValueOnce(response(null, 204))
      .mockResolvedValueOnce(response(null, 204))
      .mockResolvedValueOnce(response(null, 204))
      .mockResolvedValueOnce(response(null, 204))
      .mockResolvedValueOnce(response(null, 204))
      .mockResolvedValueOnce(response(null, 204))
      .mockResolvedValueOnce(response(null, 204))
      .mockResolvedValueOnce(response(null, 204));
    fetcher.mockResolvedValueOnce(response(null, 204));
    const client = new SpotifyApiClient({ clientId: "id", clientSecret: "secret", fetcher });

    await client.devices("access");
    for (const [action, payload] of [
      ["RESUME", {}], ["PAUSE", {}], ["NEXT", {}], ["PREVIOUS", {}],
      ["PLAY_TRACK", { uri: "spotify:track:t1" }], ["PLAY_ARTIST", { uri: "spotify:artist:a1" }], ["PLAY_ALBUM", { uri: "spotify:album:al1" }], ["PLAY_PLAYLIST", { uri: "spotify:playlist:p1" }], ["TRANSFER", { deviceId: "d1", play: true }],
      ["SEEK", { positionMs: 12_000 }], ["VOLUME", { volume: 50 }],
      ["SHUFFLE", { state: true }], ["REPEAT", { state: "context" }],
    ] as const) {
      await client.action("access", action, payload);
    }
    expect(fetcher.mock.calls.map(([url, init]) => `${init?.method}:${url}`).slice(1)).toEqual([
      "PUT:https://api.spotify.com/v1/me/player/play",
      "PUT:https://api.spotify.com/v1/me/player/pause",
      "POST:https://api.spotify.com/v1/me/player/next",
      "POST:https://api.spotify.com/v1/me/player/previous",
      "PUT:https://api.spotify.com/v1/me/player/play",
      "PUT:https://api.spotify.com/v1/me/player/play",
      "PUT:https://api.spotify.com/v1/me/player/play",
      "PUT:https://api.spotify.com/v1/me/player/play",
      "PUT:https://api.spotify.com/v1/me/player",
      "PUT:https://api.spotify.com/v1/me/player/seek?position_ms=12000",
      "PUT:https://api.spotify.com/v1/me/player/volume?volume_percent=50",
      "PUT:https://api.spotify.com/v1/me/player/shuffle?state=true",
      "PUT:https://api.spotify.com/v1/me/player/repeat?state=context",
    ]);
  });

  it("normalizes provider failures and never exposes response bodies", async () => {
    const fetcher = vi.fn().mockResolvedValue(response({ error: "invalid_grant", secret: "provider-secret" }, 401));
    const client = new SpotifyApiClient({ clientId: "id", clientSecret: "secret", fetcher });

    await expect(client.refreshToken("refresh-token")).rejects.toMatchObject({ status: 401, code: "INVALID_GRANT" });
    await expect(client.refreshToken("refresh-token")).rejects.not.toThrow("provider-secret");
    expect(fetcher).toHaveBeenCalled();
    expect(new SpotifyProviderError(503, "PROVIDER_UNAVAILABLE").message).not.toContain("secret");
  });

  it("distinguishes invalid_grant from an ordinary revoked API access token", async () => {
    const fetcher = vi.fn().mockResolvedValue(response({ error: "invalid_grant", error_description: "refresh-secret" }, 400));
    const client = new SpotifyApiClient({ clientId: "id", clientSecret: "secret", fetcher });

    await expect(client.refreshToken("refresh-token")).rejects.toMatchObject({ status: 400, code: "INVALID_GRANT" });
    await expect(client.refreshToken("refresh-token")).rejects.not.toThrow("refresh-secret");
  });

  it("maps provider playback authorization failures to Premium-required", async () => {
    const fetcher = vi.fn().mockResolvedValue(response({ error: { status: 403, message: "Premium required" } }, 403));
    const client = new SpotifyApiClient({ clientId: "id", clientSecret: "secret", fetcher });

    await expect(client.action("access-token", "PAUSE", {})).rejects.toMatchObject({ status: 403, code: "PREMIUM_REQUIRED" });
  });

  it.each([
    [429, "RATE_LIMITED"],
    [500, "PROVIDER_UNAVAILABLE"],
    [504, "PROVIDER_UNAVAILABLE"],
  ] as const)("maps provider status %s to a safe %s result", async (status, code) => {
    const fetcher = vi.fn().mockResolvedValue(response({ error: "provider-secret" }, status));
    const client = new SpotifyApiClient({ clientId: "id", clientSecret: "secret", fetcher });

    await expect(client.action("access-token", "PAUSE", {})).rejects.toMatchObject({ status, code });
    await expect(client.action("access-token", "PAUSE", {})).rejects.not.toThrow("provider-secret");
  });

  it("rejects a track action when the semantic URI is not a Spotify track URI", async () => {
    const fetcher = vi.fn().mockResolvedValue(response(null, 204));
    const client = new SpotifyApiClient({ clientId: "id", clientSecret: "secret", fetcher });

    await expect(client.action("access-token", "PLAY_TRACK", { uri: "https://example.test/track" })).rejects.toMatchObject({ code: "PROVIDER_REQUEST_FAILED" });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
