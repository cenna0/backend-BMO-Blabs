import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { IntegrationProvider } from "../../src/generated/prisma/enums.js";
import { encryptProviderToken, decryptProviderToken } from "../../src/p9/integrations.crypto.js";
import { IntegrationService } from "../../src/p9/services/integration.service.js";
import { SpotifyProviderError } from "../../src/p9/providers/spotify.client.js";

const userA = "00000000-0000-4000-8000-000000000001";
const userB = "00000000-0000-4000-8000-000000000002";
const connectionA = "00000000-0000-4000-8000-000000000003";

function fixture() {
  const key = Buffer.alloc(32, 9);
  const now = new Date("2026-08-13T00:00:00.000Z");
  const access = encryptProviderToken("old-access", key);
  const refresh = encryptProviderToken("refresh-secret", key);
  const credential: any = {
    userId: userA,
    connectionId: connectionA,
    provider: IntegrationProvider.SPOTIFY,
    accessTokenCiphertext: access.ciphertext,
    accessTokenNonce: access.nonce,
    accessTokenTag: access.tag,
    refreshTokenCiphertext: refresh.ciphertext,
    refreshTokenNonce: refresh.nonce,
    refreshTokenTag: refresh.tag,
    keyVersion: 1,
    expiresAt: new Date(now.getTime() - 1),
    authorizedAt: new Date("2026-08-01T00:00:00.000Z"),
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    spotifyAccountId: "spotify-account",
    spotifyProfileId: "spotify-profile",
    market: "ID",
    preferredDeviceId: null,
    scopes: ["user-read-private"],
  };
  const repositories: any = {
    databaseNow: vi.fn().mockResolvedValue(now),
    spotifyCredential: {
      findUnique: vi.fn(async ({ where }: any) => {
        if (where.userId !== undefined) return where.userId === userA ? credential : null;
        if (where.spotifyAccountId !== undefined) return where.spotifyAccountId === credential.spotifyAccountId ? credential : null;
        return null;
      }),
      update: vi.fn(async ({ data }: any) => Object.assign(credential, data)),
      upsert: vi.fn(),
      deleteMany: vi.fn(),
    },
    integrationConnection: {
      findUnique: vi.fn().mockResolvedValue({ id: connectionA, userId: userA, provider: IntegrationProvider.SPOTIFY, status: "CONNECTED", scopes: credential.scopes, connectedAt: now }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      create: vi.fn(),
      update: vi.fn(),
    },
    spotifyAction: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    auditEvent: { create: vi.fn() },
    oAuthState: { create: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn() },
  };
  const spotify = {
    exchangeCode: vi.fn(),
    currentUser: vi.fn(),
    refreshToken: vi.fn().mockResolvedValue({ accessToken: "new-access", expiresIn: 3600, scopes: [] }),
    devices: vi.fn().mockResolvedValue([{ id: "d1", isActive: true }]),
    search: vi.fn().mockResolvedValue({ tracks: [], artists: [{ name: "NIKI", uri: "spotify:artist:a1" }], albums: [], playlists: [] }),
    action: vi.fn().mockResolvedValue({ code: "SPOTIFY_COMMAND_ACCEPTED" }),
  };
  const service = new IntegrationService({ client: {} as any, repositories, publicBaseUrl: "http://127.0.0.1:3010", spotifyTokenEncryptionKey: key.toString("base64url"), spotifyCallbackUrl: "https://api.personalbmo.web.id/api/v1/integrations/spotify/callback", spotify: spotify as any });
  return { key, now, credential, repositories, spotify, service };
}

describe("Spotify IntegrationService", () => {
  it("refreshes expired credentials, preserves refresh token when omitted, and stores ciphertext only", async () => {
    const f = fixture();
    await expect(f.service.spotifyDevices(userA)).resolves.toEqual([{ id: "d1", isActive: true }]);
    expect(f.spotify.refreshToken).toHaveBeenCalledWith("refresh-secret");
    expect(decryptProviderToken({ ciphertext: f.credential.accessTokenCiphertext, nonce: f.credential.accessTokenNonce, tag: f.credential.accessTokenTag, keyVersion: f.credential.keyVersion }, f.key)).toBe("new-access");
    expect(f.credential.accessTokenCiphertext).not.toContain("new-access");
    expect(decryptProviderToken({ ciphertext: f.credential.refreshTokenCiphertext, nonce: f.credential.refreshTokenNonce, tag: f.credential.refreshTokenTag, keyVersion: f.credential.keyVersion }, f.key)).toBe("refresh-secret");
    expect(f.repositories.integrationConnection.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { status: "CONNECTED", scopes: ["user-read-private"] } }));
  });

  it("stores a replacement refresh token when Spotify returns one", async () => {
    const f = fixture();
    f.spotify.refreshToken.mockResolvedValue({ accessToken: "new-access", refreshToken: "replacement-refresh", expiresIn: 3600, scopes: [] });

    await f.service.spotifyDevices(userA);

    expect(decryptProviderToken({ ciphertext: f.credential.refreshTokenCiphertext, nonce: f.credential.refreshTokenNonce, tag: f.credential.refreshTokenTag, keyVersion: f.credential.keyVersion }, f.key)).toBe("replacement-refresh");
  });

  it("derives provider access only from the authenticated owner and does not leak another user's credential", async () => {
    const f = fixture();
    await expect(f.service.spotifyDevices(userB)).rejects.toMatchObject({ code: "CONFLICT", status: 409 });
    expect(f.spotify.devices).not.toHaveBeenCalled();
  });

  it("disconnects by deleting the owner credential before exposing a disconnected status", async () => {
    const f = fixture();

    await f.service.spotifyDisconnect(userA);

    expect(f.repositories.spotifyCredential.deleteMany).toHaveBeenCalledWith({ where: { userId: userA } });
    expect(f.repositories.integrationConnection.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "DISCONNECTED", externalReference: null }) }));
  });

  it("resolves a natural-language play request to a provider URI before execution", async () => {
    const f = fixture();
    const row = { id: "00000000-0000-4000-8000-000000000004", userId: userA, connectionId: connectionA, provider: IntegrationProvider.SPOTIFY, action: "PLAY", payload: {}, status: "CONFIRMED", confirmationExpiresAt: null, resultCode: null, resultMetadata: null, errorCode: null };
    f.repositories.spotifyAction.findUnique.mockResolvedValue(null);
    f.repositories.spotifyAction.create.mockResolvedValue(row);
    f.repositories.spotifyAction.update.mockImplementation(async ({ data }: any) => ({ ...row, ...data }));
    await expect(f.service.spotifyAction(userA, { action: "PLAY", idempotencyKey: "play:niki", payload: { query: "NIKI", targetType: "artist" }, confirmed: true })).resolves.toMatchObject({ status: "SUCCEEDED" });
    expect(f.spotify.search).toHaveBeenCalledWith("new-access", "NIKI", ["artist"], "ID");
    expect(f.spotify.action).toHaveBeenCalledWith("new-access", "PLAY_ARTIST", { uri: "spotify:artist:a1", deviceId: "d1" });
  });

  it("generates the exact callback, scopes, and single-use state contract", async () => {
    const f = fixture();
    const service = new IntegrationService({
      client: {} as any,
      repositories: f.repositories,
      publicBaseUrl: "http://127.0.0.1:3010",
      spotifyTokenEncryptionKey: f.key.toString("base64url"),
      spotifyClientId: "client-id",
      spotifyClientSecret: "client-secret",
      spotifyCallbackUrl: "https://api.personalbmo.web.id/api/v1/integrations/spotify/callback",
      spotify: { exchangeCode: vi.fn() } as any,
    });
    const result = await service.spotifyConnect(userA);
    const url = new URL(result.authorizationUrl);
    expect(url.origin + url.pathname).toBe("https://accounts.spotify.com/authorize");
    expect(url.searchParams.get("redirect_uri")).toBe("https://api.personalbmo.web.id/api/v1/integrations/spotify/callback");
    expect(url.searchParams.get("scope")?.split(" ")).toEqual([
      "user-read-private",
      "user-read-playback-state",
      "user-modify-playback-state",
      "playlist-read-private",
    ]);
    expect(result).not.toHaveProperty("state");
    expect(f.repositories.oAuthState.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ userId: userA, redirectUri: "https://api.personalbmo.web.id/api/v1/integrations/spotify/callback" }) }));
  });

  it.each([
    ["short", "AUTHENTICATION_FAILED"],
    ["A".repeat(64), "AUTHENTICATION_FAILED"],
  ])("rejects %s OAuth state without provider access", async (state, code) => {
    const f = fixture();
    await expect(f.service.spotifyCallback(state)).rejects.toMatchObject({ code });
    expect(f.spotify.refreshToken).not.toHaveBeenCalled();
  });

  it("rejects expired, reused, and provider-denied OAuth callbacks after state validation", async () => {
    const f = fixture();
    f.repositories.oAuthState.findFirst.mockResolvedValue({ id: "oauth", userId: userA, redirectUri: "https://api.personalbmo.web.id/api/v1/integrations/spotify/callback", expiresAt: f.now, usedAt: f.now });
    f.repositories.integrationConnection.findUnique.mockResolvedValue({ status: "DISCONNECTED" });
    await expect(f.service.spotifyCallback("a".repeat(64), "code")).rejects.toMatchObject({ code: "AUTHENTICATION_FAILED" });
    f.repositories.oAuthState.findFirst.mockResolvedValue({ id: "oauth", userId: userA, redirectUri: "https://api.personalbmo.web.id/api/v1/integrations/spotify/callback", expiresAt: f.now, usedAt: null });
    await expect(f.service.spotifyCallback("a".repeat(64), undefined, "access_denied")).rejects.toMatchObject({ code: "CONFLICT" });
    f.repositories.oAuthState.findFirst.mockResolvedValue(null);
    await expect(f.service.spotifyCallback("a".repeat(64), "code")).rejects.toMatchObject({ code: "AUTHENTICATION_FAILED" });
  });

  it("persists Spotify account metadata and preserves an existing refresh token during callback", async () => {
    const f = fixture();
    f.repositories.oAuthState.findFirst.mockResolvedValue({ id: "oauth", userId: userA, redirectUri: "https://api.personalbmo.web.id/api/v1/integrations/spotify/callback", expiresAt: new Date(f.now.getTime() + 60_000), usedAt: null });
    f.repositories.oAuthState.updateMany.mockResolvedValue({ count: 1 });
    f.spotify.exchangeCode = vi.fn().mockResolvedValue({ accessToken: "callback-access", expiresIn: 3600, scopes: ["user-read-private"] });
    f.spotify.currentUser = vi.fn().mockResolvedValue({ accountId: "spotify-account-2", profileId: "spotify-profile-2", market: "ID", product: "premium" });
    const transactionClient = { spotifyCredential: f.repositories.spotifyCredential, integrationConnection: f.repositories.integrationConnection };
    const service = new IntegrationService({
      client: { $transaction: async (work: (client: unknown) => Promise<unknown>) => work(transactionClient) } as any,
      repositories: f.repositories,
      publicBaseUrl: "http://127.0.0.1:3010",
      spotifyTokenEncryptionKey: f.key.toString("base64url"),
      spotifyClientId: "client-id",
      spotifyClientSecret: "client-secret",
      spotifyCallbackUrl: "https://api.personalbmo.web.id/api/v1/integrations/spotify/callback",
      spotify: f.spotify as any,
    });

    await expect(service.spotifyCallback("a".repeat(64), "authorization-code")).resolves.toEqual({ ok: true, returnTo: "bmomobile://plugin-detail?id=spotify" });
    expect(f.spotify.currentUser).toHaveBeenCalledWith("callback-access");
    expect(f.repositories.spotifyCredential.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        spotifyAccountId: "spotify-account-2", spotifyProfileId: "spotify-profile-2", authorizedAt: f.now, market: "ID",
        refreshTokenCiphertext: f.credential.refreshTokenCiphertext,
      }),
      update: expect.objectContaining({
        spotifyAccountId: "spotify-account-2", spotifyProfileId: "spotify-profile-2", authorizedAt: f.now, market: "ID",
        refreshTokenCiphertext: f.credential.refreshTokenCiphertext,
      }),
    }));
  });

  it("keeps one BMO connection when Spotify profile id changes for the same account_id", async () => {
    const f = fixture();
    f.repositories.oAuthState.findFirst.mockResolvedValue({ id: "oauth", userId: userA, redirectUri: "https://api.personalbmo.web.id/api/v1/integrations/spotify/callback", expiresAt: new Date(f.now.getTime() + 60_000), usedAt: null });
    f.repositories.oAuthState.updateMany.mockResolvedValue({ count: 1 });
    f.spotify.exchangeCode.mockResolvedValue({ accessToken: "callback-access", expiresIn: 3600, scopes: ["user-read-private"] });
    f.spotify.currentUser
      .mockResolvedValueOnce({ accountId: "spotify-account", profileId: "spotify-profile-old", market: "ID", product: "premium" })
      .mockResolvedValueOnce({ accountId: "spotify-account", profileId: "spotify-profile-new", market: "ID", product: "premium" });
    const transactionClient = { spotifyCredential: f.repositories.spotifyCredential, integrationConnection: f.repositories.integrationConnection };
    const service = new IntegrationService({
      client: { $transaction: async (work: (client: unknown) => Promise<unknown>) => work(transactionClient) } as any,
      repositories: f.repositories,
      publicBaseUrl: "http://127.0.0.1:3010",
      spotifyTokenEncryptionKey: f.key.toString("base64url"),
      spotifyClientId: "client-id",
      spotifyClientSecret: "client-secret",
      spotifyCallbackUrl: "https://api.personalbmo.web.id/api/v1/integrations/spotify/callback",
      spotify: f.spotify as any,
    });

    await service.spotifyCallback("a".repeat(64), "authorization-code");
    await service.spotifyCallback("a".repeat(64), "authorization-code");

    expect(f.repositories.integrationConnection.create).not.toHaveBeenCalled();
    expect(f.repositories.spotifyCredential.upsert).toHaveBeenCalledTimes(2);
    expect(f.repositories.spotifyCredential.upsert.mock.calls.map(([input]: any) => input.where)).toEqual([{ userId: userA }, { userId: userA }]);
    expect(f.repositories.spotifyCredential.upsert.mock.calls.map(([input]: any) => input.update.spotifyAccountId)).toEqual(["spotify-account", "spotify-account"]);
    expect(f.repositories.spotifyCredential.upsert.mock.calls[1]?.[0].update.spotifyProfileId).toBe("spotify-profile-new");
  });

  it("rejects linking an account_id already owned by another BMO user", async () => {
    const f = fixture();
    f.repositories.oAuthState.findFirst.mockResolvedValue({ id: "oauth", userId: userA, redirectUri: "https://api.personalbmo.web.id/api/v1/integrations/spotify/callback", expiresAt: new Date(f.now.getTime() + 60_000), usedAt: null });
    f.repositories.oAuthState.updateMany.mockResolvedValue({ count: 1 });
    f.spotify.exchangeCode.mockResolvedValue({ accessToken: "callback-access", expiresIn: 3600, scopes: ["user-read-private"] });
    f.spotify.currentUser.mockResolvedValue({ accountId: "spotify-account", profileId: "spotify-profile", market: "ID", product: "premium" });
    f.repositories.spotifyCredential.findUnique.mockImplementation(async ({ where }: any) => {
      if (where.spotifyAccountId === "spotify-account") return { ...f.credential, userId: userB };
      if (where.userId === userA) return f.credential;
      return null;
    });
    const transactionClient = { spotifyCredential: f.repositories.spotifyCredential, integrationConnection: f.repositories.integrationConnection };
    const service = new IntegrationService({
      client: { $transaction: async (work: (client: unknown) => Promise<unknown>) => work(transactionClient) } as any,
      repositories: f.repositories,
      publicBaseUrl: "http://127.0.0.1:3010",
      spotifyTokenEncryptionKey: f.key.toString("base64url"),
      spotifyClientId: "client-id",
      spotifyClientSecret: "client-secret",
      spotifyCallbackUrl: "https://api.personalbmo.web.id/api/v1/integrations/spotify/callback",
      spotify: f.spotify as any,
    });

    await expect(service.spotifyCallback("a".repeat(64), "authorization-code")).rejects.toMatchObject({ code: "OWNERSHIP_DENIED" });
    expect(f.repositories.spotifyCredential.upsert).not.toHaveBeenCalled();
  });

  it("forces reauthorization after the six-month refresh-token lifetime", async () => {
    const f = fixture();
    f.credential.authorizedAt = new Date("2026-02-13T00:00:00.000Z");

    await expect(f.service.spotifyDevices(userA)).rejects.toMatchObject({ code: "RECONNECT_REQUIRED" });
    expect(f.spotify.refreshToken).not.toHaveBeenCalled();
    expect(f.repositories.spotifyCredential.deleteMany).toHaveBeenCalledWith({ where: { userId: userA } });
  });

  it("marks invalid_grant as reconnect-required and wipes the credential", async () => {
    const f = fixture();
    f.spotify.refreshToken.mockRejectedValue(new SpotifyProviderError(400, "INVALID_GRANT"));

    await expect(f.service.spotifyDevices(userA)).rejects.toMatchObject({ code: "RECONNECT_REQUIRED" });
    expect(f.repositories.spotifyCredential.deleteMany).toHaveBeenCalledWith({ where: { userId: userA } });
    expect(f.repositories.integrationConnection.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: userA, provider: IntegrationProvider.SPOTIFY },
      data: expect.objectContaining({ status: "RECONNECT_REQUIRED" }),
    }));
  });

  it("serializes concurrent refreshes for one user", async () => {
    const f = fixture();
    let release!: () => void;
    const refreshGate = new Promise<void>((resolve) => { release = resolve; });
    f.spotify.refreshToken.mockImplementation(async () => { await refreshGate; return { accessToken: "new-access", expiresIn: 3600, scopes: [] }; });

    const first = f.service.spotifyDevices(userA);
    const second = f.service.spotifyDevices(userA);
    await Promise.resolve();
    release();
    await Promise.all([first, second]);

    expect(f.spotify.refreshToken).toHaveBeenCalledTimes(1);
  });

  it("uses explicit, preferred, then active device and rejects when none is usable", async () => {
    const f = fixture();
    f.repositories.spotifyCredential.findUnique.mockImplementation(async () => ({ ...f.credential, preferredDeviceId: "preferred" }));
    f.spotify.devices.mockResolvedValue([
      { id: "active", name: "Phone", isActive: true },
      { id: "preferred", name: "Laptop", isActive: false },
    ]);
    const explicit = { action: "PAUSE", idempotencyKey: "pause-explicit", payload: { deviceId: "active" }, confirmed: true };
    const preferred = { action: "PAUSE", idempotencyKey: "pause-preferred", payload: {}, confirmed: true };
    for (const input of [explicit, preferred]) {
      const row = { id: `row-${input.idempotencyKey}`, userId: userA, connectionId: connectionA, provider: IntegrationProvider.SPOTIFY, action: "PAUSE", payload: input.payload, status: "CONFIRMED", confirmationExpiresAt: null, resultCode: null, resultMetadata: null, errorCode: null };
      f.repositories.spotifyAction.findUnique.mockResolvedValueOnce(null);
      f.repositories.spotifyAction.create.mockResolvedValueOnce(row);
      f.repositories.spotifyAction.update.mockImplementationOnce(async ({ data }: any) => ({ ...row, ...data }));
      await f.service.spotifyAction(userA, input);
    }
    expect(f.spotify.action).toHaveBeenNthCalledWith(1, "new-access", "PAUSE", { deviceId: "active" });
    expect(f.spotify.action).toHaveBeenNthCalledWith(2, "new-access", "PAUSE", { deviceId: "preferred" });

    f.spotify.devices.mockResolvedValue([]);
    const noDevice = { action: "PAUSE", idempotencyKey: "pause-none", payload: {}, confirmed: true };
    const row = { id: "row-pause-none", userId: userA, connectionId: connectionA, provider: IntegrationProvider.SPOTIFY, action: "PAUSE", payload: {}, status: "CONFIRMED", confirmationExpiresAt: null, resultCode: null, resultMetadata: null, errorCode: null };
    f.repositories.spotifyAction.findUnique.mockResolvedValueOnce(null);
    f.repositories.spotifyAction.create.mockResolvedValueOnce(row);
    f.repositories.spotifyAction.update.mockImplementationOnce(async ({ data }: any) => ({ ...row, ...data }));
    await expect(f.service.spotifyAction(userA, noDevice)).resolves.toMatchObject({ status: "FAILED", errorCode: "NO_ACTIVE_DEVICE" });
  });
});
