import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { IntegrationProvider } from "../../src/generated/prisma/enums.js";
import { encryptProviderToken, decryptProviderToken } from "../../src/p9/integrations.crypto.js";
import { IntegrationService } from "../../src/p9/services/integration.service.js";

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
    scopes: ["user-read-private"],
  };
  const repositories: any = {
    databaseNow: vi.fn().mockResolvedValue(now),
    spotifyCredential: {
      findUnique: vi.fn(async ({ where }: any) => where.userId === userA ? credential : null),
      update: vi.fn(async ({ data }: any) => Object.assign(credential, data)),
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
    refreshToken: vi.fn().mockResolvedValue({ accessToken: "new-access", expiresIn: 3600, scopes: [] }),
    devices: vi.fn().mockResolvedValue([{ id: "d1", isActive: true }]),
    search: vi.fn().mockResolvedValue({ tracks: [], artists: [{ name: "NIKI", uri: "spotify:artist:a1" }], albums: [], playlists: [] }),
    action: vi.fn().mockResolvedValue({ code: "SPOTIFY_COMMAND_ACCEPTED" }),
  };
  const service = new IntegrationService({ client: {} as any, repositories, publicBaseUrl: "http://127.0.0.1:3010", providerEncryptionKey: key.toString("base64url"), spotifyCallbackUrl: "https://api.personalbmo.web.id/api/v1/integrations/spotify/callback", spotify: spotify as any });
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

  it("derives provider access only from the authenticated owner and does not leak another user's credential", async () => {
    const f = fixture();
    await expect(f.service.spotifyDevices(userB)).rejects.toMatchObject({ code: "CONFLICT", status: 409 });
    expect(f.spotify.devices).not.toHaveBeenCalled();
  });

  it("resolves a natural-language play request to a provider URI before execution", async () => {
    const f = fixture();
    const row = { id: "00000000-0000-4000-8000-000000000004", userId: userA, connectionId: connectionA, provider: IntegrationProvider.SPOTIFY, action: "PLAY", payload: {}, status: "CONFIRMED", confirmationExpiresAt: null, resultCode: null, resultMetadata: null, errorCode: null };
    f.repositories.spotifyAction.findUnique.mockResolvedValue(null);
    f.repositories.spotifyAction.create.mockResolvedValue(row);
    f.repositories.spotifyAction.update.mockImplementation(async ({ data }: any) => ({ ...row, ...data }));
    await expect(f.service.spotifyAction(userA, { action: "PLAY", idempotencyKey: "play:niki", payload: { query: "NIKI", targetType: "artist" }, confirmed: true })).resolves.toMatchObject({ status: "SUCCEEDED" });
    expect(f.spotify.search).toHaveBeenCalledWith("new-access", "NIKI", ["artist"]);
    expect(f.spotify.action).toHaveBeenCalledWith("new-access", "PLAY_ARTIST", { uri: "spotify:artist:a1" });
  });

  it("generates the exact callback, scopes, and single-use state contract", async () => {
    const f = fixture();
    const service = new IntegrationService({
      client: {} as any,
      repositories: f.repositories,
      publicBaseUrl: "http://127.0.0.1:3010",
      providerEncryptionKey: f.key.toString("base64url"),
      spotifyClientId: "client-id",
      spotifyClientSecret: "client-secret",
      spotifyCallbackUrl: "https://api.personalbmo.web.id/api/v1/integrations/spotify/callback",
      spotify: { exchangeCode: vi.fn() } as any,
    });
    const result = await service.spotifyConnect(userA);
    const url = new URL(result.authorizationUrl);
    expect(url.origin + url.pathname).toBe("https://accounts.spotify.com/authorize");
    expect(url.searchParams.get("redirect_uri")).toBe("https://api.personalbmo.web.id/api/v1/integrations/spotify/callback");
    expect(url.searchParams.get("scope")?.split(" ")).toEqual(expect.arrayContaining(["user-read-playback-state", "user-modify-playback-state", "user-read-currently-playing", "user-read-private"]));
    expect(result.state).toMatch(/^[a-f0-9]{64}$/u);
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
    f.repositories.oAuthState.findFirst.mockResolvedValue({ id: "oauth", userId: userA, redirectUri: "https://api.personalbmo.web.id/api/v1/integrations/spotify/callback", expiresAt: f.now, usedAt: null });
    f.repositories.oAuthState.updateMany.mockResolvedValue({ count: 0 });
    await expect(f.service.spotifyCallback("a".repeat(64), "code")).rejects.toMatchObject({ code: "AUTHENTICATION_FAILED" });
    f.repositories.oAuthState.updateMany.mockResolvedValue({ count: 1 });
    await expect(f.service.spotifyCallback("a".repeat(64), undefined, "access_denied")).rejects.toMatchObject({ code: "CONFLICT" });
    f.repositories.oAuthState.findFirst.mockResolvedValue(null);
    await expect(f.service.spotifyCallback("a".repeat(64), "code")).rejects.toMatchObject({ code: "AUTHENTICATION_FAILED" });
  });
});
