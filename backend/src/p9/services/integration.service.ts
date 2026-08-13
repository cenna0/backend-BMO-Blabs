import { createHash, randomBytes } from "node:crypto";
import type { Prisma, PrismaClient } from "../../generated/prisma/client.js";
import { IntegrationProvider, IntegrationStatus, SpotifyActionStatus, WhatsAppRuleScope, WhatsAppSendStatus } from "../../generated/prisma/enums.js";
import { withP9Transaction } from "../db/client.js";
import { P9Repositories } from "../db/repositories.js";
import { P9Error } from "../errors.js";
import { decryptProviderToken, encryptProviderToken } from "../integrations.crypto.js";
import { parseSpotifyAction, parseWhatsAppRulesPatch } from "../integrations.validation.js";
import { SpotifyProviderError, type SpotifySearchType } from "../providers/spotify.client.js";
import type { HermesWhatsAppMessage } from "../providers/hermes-whatsapp.client.js";
import { HermesWhatsAppProviderError } from "../providers/hermes-whatsapp.client.js";

const OAUTH_TTL_MS = 10 * 60_000;
const CONFIRMATION_TTL_MS = 5 * 60_000;
const SPOTIFY_SCOPES = ["user-read-playback-state", "user-modify-playback-state", "user-read-currently-playing", "user-read-private"];
const TOKEN_REFRESH_SKEW_MS = 30_000;
const ALL_SEARCH_TYPES: SpotifySearchType[] = ["track", "artist", "album", "playlist"];

type PublicConnection = { provider: "whatsapp" | "spotify"; status: string; connectedAt: string | null; scopes: string[] };

function publicConnection(row: any, provider: "whatsapp" | "spotify"): PublicConnection {
  return { provider, status: row.status, connectedAt: row.connectedAt?.toISOString() ?? null, scopes: row.scopes ?? [] };
}

export interface HermesWhatsAppBoundary {
  connect?(userId: string): Promise<{ externalReference?: string; status?: string }>;
  status?(): Promise<{ status: string; queueLength: number; uptime: number | null; scriptHash: string | null; sendReadReceipts: boolean | null }>;
  poll?(): Promise<HermesWhatsAppMessage[]>;
  qr?(userId: string): Promise<{ qr: string | null; expiresAt: Date | null }>;
  confirmScanned?(userId: string): Promise<void>;
  disconnect?(userId: string): Promise<void>;
  send?(userId: string, recipientRef: string, message: string): Promise<{ providerMessageRef?: string }>;
}

export interface SpotifyProviderBoundary {
  exchangeCode?(code: string, redirectUri: string): Promise<{ accessToken: string; refreshToken?: string; expiresIn: number; scopes: string[]; externalReference?: string }>;
  refreshToken?(refreshToken: string): Promise<{ accessToken: string; refreshToken?: string; expiresIn: number; scopes: string[]; externalReference?: string }>;
  search?(accessToken: string, query: string, types: SpotifySearchType[]): Promise<unknown>;
  devices?(accessToken: string): Promise<unknown[]>;
  playback?(accessToken: string): Promise<unknown | null>;
  action?(accessToken: string, action: string, payload: Record<string, unknown>): Promise<{ code: string; metadata?: string }>;
}

export class IntegrationService {
  constructor(private readonly options: {
    client: PrismaClient;
    repositories: P9Repositories;
    publicBaseUrl: string;
    providerEncryptionKey?: string;
    spotifyClientId?: string;
    spotifyClientSecret?: string;
    spotifyCallbackUrl?: string;
    whatsApp?: HermesWhatsAppBoundary;
    whatsAppInbound?: (input: { userId: string; deliveryId: string; deviceId: string; text: string }) => Promise<void>;
    spotify?: SpotifyProviderBoundary;
  }) {}

  async connection(userId: string, provider: IntegrationProvider): Promise<PublicConnection> {
    const row = await this.options.repositories.integrationConnection.findUnique({ where: { userId_provider: { userId, provider } } });
    return publicConnection(row ?? { status: IntegrationStatus.DISCONNECTED, scopes: [] }, provider === IntegrationProvider.WHATSAPP ? "whatsapp" : "spotify");
  }

  async connectWhatsApp(userId: string, requestId?: string): Promise<{ connection: PublicConnection; blocked: boolean }> {
    await this.#assertWhatsAppBindingAvailable(userId);
    const result = await this.#upsertConnection(userId, IntegrationProvider.WHATSAPP, requestId);
    if (!this.options.whatsApp?.connect) return { connection: publicConnection(result, "whatsapp"), blocked: true };
    try {
      const external = await this.options.whatsApp.connect(userId);
      const connected = external.status === "connected";
      const updated = await this.options.repositories.integrationConnection.update({ where: { id: result.id }, data: { status: connected ? IntegrationStatus.CONNECTED : IntegrationStatus.PENDING, ...(connected ? { connectedAt: new Date() } : {}), externalReference: external.externalReference ?? null } });
      return { connection: publicConnection(updated, "whatsapp"), blocked: !connected };
    } catch {
      await this.options.repositories.integrationConnection.update({ where: { id: result.id }, data: { status: IntegrationStatus.ERROR } });
      throw new P9Error("SERVICE_UNAVAILABLE", 503, "WhatsApp provider is unavailable");
    }
  }

  async whatsappConnection(userId: string): Promise<PublicConnection> {
    const row = await this.#getConnection(userId, IntegrationProvider.WHATSAPP);
    if (!row || row.status === IntegrationStatus.DISCONNECTED || !this.options.whatsApp?.status) return publicConnection(row ?? { status: IntegrationStatus.DISCONNECTED, scopes: [] }, "whatsapp");
    try {
      const status = await this.options.whatsApp.status();
      if (status.status !== "connected" && row.status === IntegrationStatus.CONNECTED) {
        const updated = await this.options.repositories.integrationConnection.update({ where: { id: row.id }, data: { status: IntegrationStatus.ERROR } });
        return publicConnection(updated, "whatsapp");
      }
    } catch {
      if (row.status === IntegrationStatus.CONNECTED) {
        const updated = await this.options.repositories.integrationConnection.update({ where: { id: row.id }, data: { status: IntegrationStatus.ERROR } });
        return publicConnection(updated, "whatsapp");
      }
    }
    return publicConnection(row, "whatsapp");
  }

  async whatsappQr(userId: string): Promise<{ qr: string | null; expiresAt: string | null; status: string }> {
    const row = await this.#getConnection(userId, IntegrationProvider.WHATSAPP);
    if (!this.options.whatsApp?.qr) return { qr: null, expiresAt: null, status: row?.status ?? IntegrationStatus.DISCONNECTED };
    const result = await this.options.whatsApp.qr(userId);
    return { qr: result.qr, expiresAt: result.expiresAt?.toISOString() ?? null, status: row?.status ?? IntegrationStatus.PENDING };
  }

  async confirmWhatsApp(userId: string, requestId?: string): Promise<PublicConnection> {
    if (!this.options.whatsApp?.confirmScanned) throw new P9Error("BLOCKED_EXTERNAL_SECRET", 503, "WhatsApp provider is not configured");
    await this.#assertWhatsAppBindingAvailable(userId);
    try {
      await this.options.whatsApp.confirmScanned(userId);
    } catch (error) {
      if (error instanceof HermesWhatsAppProviderError && error.code === "NOT_CONNECTED") throw new P9Error("CONFLICT", 409, "WhatsApp is not connected");
      throw new P9Error("SERVICE_UNAVAILABLE", 503, "WhatsApp provider is unavailable");
    }
    const row = await this.#setStatus(userId, IntegrationProvider.WHATSAPP, IntegrationStatus.CONNECTED, requestId);
    return publicConnection(row, "whatsapp");
  }

  async disconnectWhatsApp(userId: string, requestId?: string): Promise<void> {
    await this.options.whatsApp?.disconnect?.(userId);
    await this.#setStatus(userId, IntegrationProvider.WHATSAPP, IntegrationStatus.DISCONNECTED, requestId);
  }

  async pollWhatsApp(): Promise<{ processed: number; queued: number }> {
    if (!this.options.whatsApp?.poll) return { processed: 0, queued: 0 };
    const messages = await this.options.whatsApp.poll();
    let processed = 0;
    let queued = 0;
    for (const message of messages) {
      // This is the authoritative BMO group boundary. It must run before owner lookup,
      // duplicate lookup, persistence, notification evaluation, or proactive delivery.
      if (message.isGroup === true) continue;
      const owners = await this.options.repositories.integrationConnection.findMany({ where: { provider: IntegrationProvider.WHATSAPP, status: IntegrationStatus.CONNECTED }, select: { id: true, userId: true } });
      if (owners.length !== 1) continue;
      const owner = owners[0];
      if (!owner) continue;
      const duplicate = await this.options.repositories.whatsAppDelivery.findFirst({ where: { provider: IntegrationProvider.WHATSAPP, connectionId: owner.id, providerMessageRef: message.messageId } });
      if (duplicate) continue;
      const delivery = await this.options.repositories.whatsAppDelivery.create({ data: {
        userId: owner.userId,
        connectionId: owner.id,
        provider: IntegrationProvider.WHATSAPP,
        direction: "INBOUND",
        status: "RECEIVED",
        providerMessageRef: message.messageId,
        metadata: JSON.stringify({ chatId: message.chatId, senderId: message.senderId, isGroup: message.isGroup, bodyLength: message.body.length }),
      } });
      processed += 1;
      const rules = await this.options.repositories.whatsAppNotificationRule.findMany({ where: { userId: owner.userId, connectionId: owner.id, provider: IntegrationProvider.WHATSAPP, enabled: true } });
      const shouldSpeak = rules.some((rule: any) => rule.speakOnDevice === true && (rule.scope === "ALL" || (rule.scope === "GROUP" && message.isGroup && rule.opaqueTargetRef === message.chatId) || (rule.scope === "CONTACT" && rule.opaqueTargetRef === message.senderId)));
      if (!shouldSpeak || !this.options.whatsAppInbound) continue;
      const device = await this.options.repositories.device.findFirst({ where: { userId: owner.userId, status: "ACTIVE" }, orderBy: { createdAt: "asc" }, select: { id: true } });
      if (!device) continue;
      await this.options.whatsAppInbound({ userId: owner.userId, deliveryId: delivery.id, deviceId: device.id, text: message.body });
      queued += 1;
    }
    return { processed, queued };
  }

  async whatsappRules(userId: string): Promise<unknown[]> {
    const connection = await this.#getConnection(userId, IntegrationProvider.WHATSAPP);
    if (!connection) return [];
    const rows = await this.options.repositories.whatsAppNotificationRule.findMany({ where: { userId, connectionId: connection.id, provider: IntegrationProvider.WHATSAPP }, orderBy: [{ scope: "asc" }, { id: "asc" }] });
    return rows.map((row: any) => ({ id: row.id, scope: row.scope, targetRef: row.opaqueTargetRef, enabled: row.enabled, speakOnDevice: row.speakOnDevice }));
  }

  async updateWhatsAppRules(userId: string, input: unknown, requestId?: string): Promise<unknown[]> {
    const parsed = parseWhatsAppRulesPatch(input);
    const connection = await this.#ensureConnection(userId, IntegrationProvider.WHATSAPP);
    return withP9Transaction(this.options.client, async (tx) => {
      const repo = new P9Repositories(tx);
      await repo.whatsAppNotificationRule.deleteMany({ where: { userId, connectionId: connection.id, provider: IntegrationProvider.WHATSAPP } });
      for (const rule of parsed.rules) {
        await repo.whatsAppNotificationRule.create({ data: {
          userId, connectionId: connection.id, provider: IntegrationProvider.WHATSAPP,
          scope: rule.scope as WhatsAppRuleScope, opaqueTargetRef: rule.targetRef ?? null,
          enabled: rule.enabled, speakOnDevice: rule.speakOnDevice,
        } });
      }
      await this.#audit(repo, userId, "whatsapp.rules.updated", "integration", connection.id, requestId);
      const rows = await repo.whatsAppNotificationRule.findMany({ where: { userId, connectionId: connection.id, provider: IntegrationProvider.WHATSAPP }, orderBy: [{ scope: "asc" }, { id: "asc" }] });
      return rows.map((row: any) => ({ id: row.id, scope: row.scope, targetRef: row.opaqueTargetRef, enabled: row.enabled, speakOnDevice: row.speakOnDevice }));
    });
  }

  async whatsappPreview(userId: string, input: { recipientRef: string; message: string; idempotencyKey: string }, requestId?: string): Promise<unknown> {
    const connection = await this.#requireConnectedWhatsAppOwner(userId);
    const now = await this.options.repositories.databaseNow();
    const existing = await this.options.repositories.whatsAppSendRequest.findUnique({ where: { userId_idempotencyKey: { userId, idempotencyKey: input.idempotencyKey } } });
    if (existing) return this.#publicSend(existing);
    const row = await this.options.repositories.whatsAppSendRequest.create({ data: {
      userId, connectionId: connection.id, provider: IntegrationProvider.WHATSAPP,
      opaqueRecipientRef: input.recipientRef, preview: input.message, idempotencyKey: input.idempotencyKey,
      confirmationExpiresAt: new Date(now.getTime() + CONFIRMATION_TTL_MS),
    } });
    await this.#audit(this.options.repositories, userId, "whatsapp.send.preview", "whatsapp_send", row.id, requestId);
    return this.#publicSend(row);
  }

  async whatsappConfirm(userId: string, requestId: string, requestContextId?: string): Promise<unknown> {
    const row = await this.options.repositories.whatsAppSendRequest.findFirst({ where: { id: requestId, userId, provider: IntegrationProvider.WHATSAPP } });
    if (!row) throw new P9Error("OWNERSHIP_DENIED", 404, "Send request not found");
    const now = await this.options.repositories.databaseNow();
    if (row.confirmationExpiresAt <= now || row.status === WhatsAppSendStatus.EXPIRED) throw new P9Error("CONFLICT", 409, "Send confirmation expired");
    await this.#requireConnectedWhatsAppOwner(userId);
    if (!this.options.whatsApp?.send) throw new P9Error("BLOCKED_EXTERNAL_SECRET", 503, "WhatsApp provider is not configured");
    const claimed = await this.options.repositories.whatsAppSendRequest.updateMany({ where: { id: row.id, userId, status: WhatsAppSendStatus.PENDING_CONFIRMATION, confirmationExpiresAt: { gt: now } }, data: { status: WhatsAppSendStatus.SENDING, confirmedAt: now } });
    if (claimed.count !== 1) {
      const current = await this.options.repositories.whatsAppSendRequest.findFirst({ where: { id: row.id, userId } });
      if (!current) throw new P9Error("OWNERSHIP_DENIED", 404, "Send request not found");
      return this.#publicSend(current);
    }
    try {
      const sent = await this.options.whatsApp.send(userId, row.opaqueRecipientRef, row.preview);
      const finished = await this.options.repositories.whatsAppSendRequest.update({ where: { id: row.id }, data: { status: WhatsAppSendStatus.SUCCEEDED } });
      await this.options.repositories.whatsAppDelivery.create({ data: { userId, connectionId: row.connectionId, provider: IntegrationProvider.WHATSAPP, sendRequestId: row.id, direction: "OUTBOUND", status: "DELIVERED", providerMessageRef: sent.providerMessageRef ?? null, deliveredAt: now } });
      return this.#publicSend(finished);
    } catch {
      const failed = await this.options.repositories.whatsAppSendRequest.update({ where: { id: row.id }, data: { status: WhatsAppSendStatus.FAILED, errorCode: "PROVIDER_SEND_FAILED" } });
      return this.#publicSend(failed);
    }
  }

  async spotifyConnect(userId: string): Promise<{ authorizationUrl: string; state: string }> {
    if (!this.options.spotify || !this.options.spotifyClientId || !this.options.spotifyClientSecret || !this.options.spotifyCallbackUrl) throw new P9Error("BLOCKED_EXTERNAL_SECRET", 503, "Spotify provider is not configured");
    const redirectUri = this.options.spotifyCallbackUrl;
    const state = randomBytes(32).toString("hex");
    const verifier = createHash("sha256").update(state).digest("hex");
    await this.options.repositories.oAuthState.create({ data: { userId, provider: IntegrationProvider.SPOTIFY, stateVerifier: verifier, redirectUri, expiresAt: new Date(Date.now() + OAUTH_TTL_MS) } });
    const params = new URLSearchParams({ response_type: "code", client_id: this.options.spotifyClientId, redirect_uri: redirectUri, state, scope: SPOTIFY_SCOPES.join(" ") });
    return { authorizationUrl: `https://accounts.spotify.com/authorize?${params.toString()}`, state };
  }

  async spotifyCallback(state: string, code?: string, error?: string): Promise<{ ok: boolean }> {
    if (!/^[a-f0-9]{64}$/u.test(state)) throw new P9Error("AUTHENTICATION_FAILED", 401, "Invalid OAuth state");
    const verifier = createHash("sha256").update(state).digest("hex");
    const now = await this.options.repositories.databaseNow();
    const oauth = await this.options.repositories.oAuthState.findFirst({ where: { stateVerifier: verifier, provider: IntegrationProvider.SPOTIFY, usedAt: null, expiresAt: { gt: now } } });
    if (!oauth || oauth.redirectUri !== this.options.spotifyCallbackUrl) throw new P9Error("AUTHENTICATION_FAILED", 401, "Invalid OAuth state");
    const used = await this.options.repositories.oAuthState.updateMany({ where: { id: oauth.id, usedAt: null }, data: { usedAt: now } });
    if (used.count !== 1) throw new P9Error("AUTHENTICATION_FAILED", 401, "Invalid OAuth state");
    if (error) throw new P9Error("CONFLICT", 409, "Spotify authorization was denied");
    if (!code || !this.options.spotify?.exchangeCode || !this.options.providerEncryptionKey) throw new P9Error("BLOCKED_EXTERNAL_SECRET", 503, "Spotify provider is not configured");
    let tokens: Awaited<ReturnType<NonNullable<SpotifyProviderBoundary["exchangeCode"]>>>;
    try {
      tokens = await this.options.spotify.exchangeCode(code, oauth.redirectUri);
    } catch {
      await this.options.repositories.integrationConnection.updateMany({ where: { userId: oauth.userId, provider: IntegrationProvider.SPOTIFY }, data: { status: IntegrationStatus.ERROR } });
      throw new P9Error("SERVICE_UNAVAILABLE", 503, "Spotify authorization is unavailable");
    }
    const connection = await this.#ensureConnection(oauth.userId, IntegrationProvider.SPOTIFY);
    const key = Buffer.from(this.options.providerEncryptionKey, "base64url");
    if (key.length !== 32) throw new P9Error("SERVICE_UNAVAILABLE", 503, "Provider encryption is unavailable");
    const access = encryptProviderToken(tokens.accessToken, key);
    const refresh = tokens.refreshToken ? encryptProviderToken(tokens.refreshToken, key) : null;
    await withP9Transaction(this.options.client, async (tx) => {
      const repo = new P9Repositories(tx);
      await repo.spotifyCredential.upsert({ where: { userId: oauth.userId }, create: { userId: oauth.userId, connectionId: connection.id, provider: IntegrationProvider.SPOTIFY, accessTokenCiphertext: access.ciphertext, accessTokenNonce: access.nonce, accessTokenTag: access.tag, refreshTokenCiphertext: refresh?.ciphertext ?? null, refreshTokenNonce: refresh?.nonce ?? null, refreshTokenTag: refresh?.tag ?? null, keyVersion: access.keyVersion, expiresAt: new Date(now.getTime() + tokens.expiresIn * 1000), scopes: tokens.scopes }, update: { connectionId: connection.id, accessTokenCiphertext: access.ciphertext, accessTokenNonce: access.nonce, accessTokenTag: access.tag, refreshTokenCiphertext: refresh?.ciphertext ?? null, refreshTokenNonce: refresh?.nonce ?? null, refreshTokenTag: refresh?.tag ?? null, keyVersion: access.keyVersion, expiresAt: new Date(now.getTime() + tokens.expiresIn * 1000), scopes: tokens.scopes } });
      await repo.integrationConnection.update({ where: { id: connection.id }, data: { status: IntegrationStatus.CONNECTED, scopes: tokens.scopes, externalReference: tokens.externalReference ?? null, connectedAt: now } });
    });
    return { ok: true };
  }

  async spotifyDisconnect(userId: string): Promise<void> { await this.options.repositories.spotifyCredential.deleteMany({ where: { userId } }); await this.#setStatus(userId, IntegrationProvider.SPOTIFY, IntegrationStatus.DISCONNECTED); }
  async spotifySearch(userId: string, query: string, types: SpotifySearchType[] = ALL_SEARCH_TYPES): Promise<unknown> {
    if (!this.options.spotify?.search) throw new P9Error("BLOCKED_EXTERNAL_SECRET", 503, "Spotify provider is not configured");
    return this.#withSpotifyToken(userId, (accessToken) => this.options.spotify!.search!(accessToken, query, types));
  }
  async spotifyDevices(userId: string): Promise<unknown[]> { return this.#spotifyProviderCall(userId, "devices"); }
  async spotifyActiveDevice(userId: string): Promise<unknown> {
    const devices = await this.spotifyDevices(userId);
    return (devices as Array<{ isActive?: boolean }>).find((device) => device.isActive === true) ?? null;
  }
  async spotifyPlayback(userId: string): Promise<unknown> { const value = await this.#spotifyProviderCall(userId, "playback"); return value ?? { code: "NO_ACTIVE_SPOTIFY_DEVICE" }; }

  async spotifyAction(userId: string, input: unknown, requestId?: string): Promise<unknown> {
    const parsed = parseSpotifyAction(input);
    const connection = await this.#ensureConnection(userId, IntegrationProvider.SPOTIFY);
    const existing = await this.options.repositories.spotifyAction.findUnique({ where: { userId_idempotencyKey: { userId, idempotencyKey: parsed.idempotencyKey } } });
    if (existing) return this.#publicSpotifyAction(existing);
    const now = await this.options.repositories.databaseNow();
    const row = await this.options.repositories.spotifyAction.create({ data: { userId, connectionId: connection.id, provider: IntegrationProvider.SPOTIFY, action: parsed.action, payload: parsed.payload as Prisma.InputJsonValue, idempotencyKey: parsed.idempotencyKey, status: parsed.confirmed ? SpotifyActionStatus.CONFIRMED : SpotifyActionStatus.PENDING_CONFIRMATION, confirmationExpiresAt: parsed.confirmed ? null : new Date(now.getTime() + CONFIRMATION_TTL_MS) } });
    if (!parsed.confirmed) return this.#publicSpotifyAction(row);
    if (!this.options.spotify?.action || !this.options.providerEncryptionKey) {
      const failed = await this.options.repositories.spotifyAction.update({ where: { id: row.id }, data: { status: SpotifyActionStatus.FAILED, errorCode: "BLOCKED_EXTERNAL_SECRET" } });
      return this.#publicSpotifyAction(failed);
    }
    try {
      const result = await this.#executeSpotifyAction(userId, parsed.action, parsed.payload);
      const updated = await this.options.repositories.spotifyAction.update({ where: { id: row.id }, data: { status: SpotifyActionStatus.SUCCEEDED, resultCode: result.code, resultMetadata: result.metadata ?? null, confirmedAt: now } });
      await this.#audit(this.options.repositories, userId, "spotify.action", "spotify_action", row.id, requestId);
      return this.#publicSpotifyAction(updated);
    } catch (error) {
      const failed = await this.options.repositories.spotifyAction.update({ where: { id: row.id }, data: { status: SpotifyActionStatus.FAILED, errorCode: this.#safeProviderErrorCode(error) } });
      return this.#publicSpotifyAction(failed);
    }
  }

  async pluginCatalog(userId: string): Promise<unknown[]> {
    const [whatsapp, spotify] = await Promise.all([this.connection(userId, IntegrationProvider.WHATSAPP), this.connection(userId, IntegrationProvider.SPOTIFY)]);
    return [{ id: "whatsapp", title: "WhatsApp", installed: whatsapp.status !== IntegrationStatus.DISCONNECTED, status: whatsapp.status }, { id: "spotify", title: "Spotify", installed: spotify.status !== IntegrationStatus.DISCONNECTED, status: spotify.status }];
  }

  async #spotifyProviderCall(userId: string, operation: "devices" | "playback"): Promise<any> {
    if (!this.options.spotify?.[operation] || !this.options.providerEncryptionKey) throw new P9Error("BLOCKED_EXTERNAL_SECRET", 503, "Spotify provider is not configured");
    const credential = await this.options.repositories.spotifyCredential.findUnique({ where: { userId } });
    if (!credential) throw new P9Error("CONFLICT", 409, "Spotify is not connected");
    return this.#withSpotifyToken(userId, (accessToken) => this.options.spotify![operation]!(accessToken));
  }

  async #withSpotifyToken<T>(userId: string, operation: (accessToken: string) => Promise<T>): Promise<T> {
    try {
      return await operation(await this.#accessToken(userId));
    } catch (error) {
      if (!(error instanceof SpotifyProviderError) || error.code !== "AUTHORIZATION_REVOKED") throw this.#asP9ProviderError(error);
      try {
        return await operation(await this.#accessToken(userId, true));
      } catch (retryError) {
        throw this.#asP9ProviderError(retryError);
      }
    }
  }

  async #accessToken(userId: string, forceRefresh = false): Promise<string> {
    if (!this.options.providerEncryptionKey) throw new P9Error("BLOCKED_EXTERNAL_SECRET", 503, "Spotify provider is not configured");
    const credential = await this.options.repositories.spotifyCredential.findUnique({ where: { userId } });
    if (!credential) throw new P9Error("CONFLICT", 409, "Spotify is not connected");
    const key = Buffer.from(this.options.providerEncryptionKey, "base64url");
    if (key.length !== 32) throw new P9Error("SERVICE_UNAVAILABLE", 503, "Provider encryption is unavailable");
    try {
      const accessToken = decryptProviderToken({ ciphertext: credential.accessTokenCiphertext, nonce: credential.accessTokenNonce, tag: credential.accessTokenTag, keyVersion: credential.keyVersion }, key);
      const now = await this.options.repositories.databaseNow();
      if (!forceRefresh && credential.expiresAt.getTime() > now.getTime() + TOKEN_REFRESH_SKEW_MS) return accessToken;
      if (!this.options.spotify?.refreshToken || !credential.refreshTokenCiphertext || !credential.refreshTokenNonce || !credential.refreshTokenTag) throw new P9Error("SERVICE_UNAVAILABLE", 503, "Spotify authorization requires reauthentication");
      const refreshToken = decryptProviderToken({ ciphertext: credential.refreshTokenCiphertext, nonce: credential.refreshTokenNonce, tag: credential.refreshTokenTag, keyVersion: credential.keyVersion }, key);
      const tokens = await this.options.spotify.refreshToken(refreshToken);
      const scopes = tokens.scopes.length > 0 ? tokens.scopes : credential.scopes;
      const refreshedAccess = encryptProviderToken(tokens.accessToken, key);
      const refreshedToken = tokens.refreshToken ? encryptProviderToken(tokens.refreshToken, key) : null;
      await this.options.repositories.spotifyCredential.update({ where: { userId }, data: {
        accessTokenCiphertext: refreshedAccess.ciphertext, accessTokenNonce: refreshedAccess.nonce, accessTokenTag: refreshedAccess.tag,
        ...(refreshedToken ? { refreshTokenCiphertext: refreshedToken.ciphertext, refreshTokenNonce: refreshedToken.nonce, refreshTokenTag: refreshedToken.tag } : {}),
        keyVersion: refreshedAccess.keyVersion, expiresAt: new Date(now.getTime() + tokens.expiresIn * 1_000), scopes,
      } });
      await this.options.repositories.integrationConnection.updateMany({ where: { userId, provider: IntegrationProvider.SPOTIFY }, data: { status: IntegrationStatus.CONNECTED, scopes } });
      return tokens.accessToken;
    } catch {
      if (forceRefresh) await this.options.repositories.integrationConnection.updateMany({ where: { userId, provider: IntegrationProvider.SPOTIFY }, data: { status: IntegrationStatus.ERROR } });
      throw new P9Error("SERVICE_UNAVAILABLE", 503, "Provider credential is unavailable");
    }
  }

  async #executeSpotifyAction(userId: string, action: string, payload: Record<string, unknown>): Promise<{ code: string; metadata?: string }> {
    if (action === "SEARCH") {
      if (!this.options.spotify?.search || typeof payload.query !== "string") throw new P9Error("INVALID_INPUT", 400, "Spotify search query is required");
      const result = await this.#withSpotifyToken(userId, (accessToken) => this.options.spotify!.search!(accessToken, payload.query as string, ALL_SEARCH_TYPES));
      return { code: "SPOTIFY_SEARCH_COMPLETED", metadata: JSON.stringify({ resultCount: Object.values(result as Record<string, unknown>).reduce<number>((total, value) => total + (Array.isArray(value) ? value.length : 0), 0) }).slice(0, 2000) };
    }
    if (action === "QUEUE" && typeof payload.uri !== "string" && typeof payload.query === "string") {
      if (!this.options.spotify?.search) throw new P9Error("BLOCKED_EXTERNAL_SECRET", 503, "Spotify provider is not configured");
      const results = await this.#withSpotifyToken(userId, (accessToken) => this.options.spotify!.search!(accessToken, payload.query as string, ["track"]));
      const selected = this.#selectSpotifyTarget(results, payload.query as string, "track");
      if (!selected) throw new P9Error("CONFLICT", 409, "Spotify match not found");
      return this.#withSpotifyToken(userId, (accessToken) => this.options.spotify!.action!(accessToken, "QUEUE", { uri: selected.uri, ...(typeof payload.deviceId === "string" ? { deviceId: payload.deviceId } : {}) }));
    }
    if (action === "PLAY" && typeof payload.uri !== "string" && typeof payload.query === "string") {
      if (!this.options.spotify?.search) throw new P9Error("BLOCKED_EXTERNAL_SECRET", 503, "Spotify provider is not configured");
      const targetType = typeof payload.targetType === "string" && ["track", "artist", "album", "playlist"].includes(payload.targetType) ? payload.targetType as SpotifySearchType : undefined;
      const results = await this.#withSpotifyToken(userId, (accessToken) => this.options.spotify!.search!(accessToken, payload.query as string, targetType ? [targetType] : ALL_SEARCH_TYPES));
      const selected = this.#selectSpotifyTarget(results, payload.query as string, targetType);
      if (!selected) throw new P9Error("CONFLICT", 409, "Spotify match not found");
      const resolvedAction = selected.type === "track" ? "PLAY_TRACK" : selected.type === "artist" ? "PLAY_ARTIST" : selected.type === "album" ? "PLAY_ALBUM" : "PLAY_PLAYLIST";
      return this.#withSpotifyToken(userId, (accessToken) => this.options.spotify!.action!(accessToken, resolvedAction, { uri: selected.uri, ...(typeof payload.deviceId === "string" ? { deviceId: payload.deviceId } : {}) }));
    }
    return this.#withSpotifyToken(userId, (accessToken) => this.options.spotify!.action!(accessToken, action, payload));
  }

  #selectSpotifyTarget(results: unknown, query: string, targetType?: SpotifySearchType): { type: SpotifySearchType; uri: string } | null {
    if (!results || typeof results !== "object") return null;
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const types: SpotifySearchType[] = targetType ? [targetType] : ALL_SEARCH_TYPES;
    const candidates = types.flatMap((type) => {
      const values = (results as Record<string, unknown>)[`${type}s`];
      return Array.isArray(values) ? values.filter((value): value is { name?: string; uri?: string } => typeof value === "object" && value !== null).map((value) => ({ type, uri: typeof value.uri === "string" ? value.uri : "", name: typeof value.name === "string" ? value.name : "" })) : [];
    }).filter((value) => value.uri.length > 0);
    return candidates.sort((left, right) => Number(right.name.toLocaleLowerCase() === normalizedQuery) - Number(left.name.toLocaleLowerCase() === normalizedQuery))[0] ?? null;
  }

  #asP9ProviderError(error: unknown): P9Error {
    if (error instanceof P9Error) return error;
    if (error instanceof SpotifyProviderError && error.code === "AUTHORIZATION_REVOKED") return new P9Error("SERVICE_UNAVAILABLE", 503, "Spotify authorization is unavailable");
    return new P9Error("SERVICE_UNAVAILABLE", 503, "Spotify provider is unavailable");
  }

  #safeProviderErrorCode(error: unknown): string {
    if (error instanceof P9Error) return error.code;
    if (error instanceof SpotifyProviderError) return error.code;
    return "SPOTIFY_PROVIDER_FAILED";
  }

  async #getConnection(userId: string, provider: IntegrationProvider): Promise<any | null> { return this.options.repositories.integrationConnection.findUnique({ where: { userId_provider: { userId, provider } } }); }
  async #assertWhatsAppBindingAvailable(userId: string): Promise<void> {
    const rows = await this.options.repositories.integrationConnection.findMany({ where: { provider: IntegrationProvider.WHATSAPP }, select: { userId: true } });
    if (rows.some((row: any) => row.userId !== userId)) throw new P9Error("OWNERSHIP_DENIED", 404, "WhatsApp connection is not available");
  }
  async #requireConnectedWhatsAppOwner(userId: string): Promise<any> {
    const connection = await this.#getConnection(userId, IntegrationProvider.WHATSAPP);
    const owners = await this.options.repositories.integrationConnection.findMany({ where: { provider: IntegrationProvider.WHATSAPP, status: IntegrationStatus.CONNECTED }, select: { id: true, userId: true } });
    if (!connection || connection.status !== IntegrationStatus.CONNECTED || owners.length !== 1 || owners[0]?.userId !== userId || owners[0]?.id !== connection.id) throw new P9Error("OWNERSHIP_DENIED", 404, "WhatsApp connection is not available");
    return connection;
  }
  async #ensureConnection(userId: string, provider: IntegrationProvider): Promise<any> { const current = await this.#getConnection(userId, provider); if (current) return current; return this.options.repositories.integrationConnection.create({ data: { userId, provider, scopes: [], status: IntegrationStatus.DISCONNECTED } }); }
  async #upsertConnection(userId: string, provider: IntegrationProvider, requestId?: string): Promise<any> { const row = await this.#ensureConnection(userId, provider); await this.options.repositories.integrationConnection.update({ where: { id: row.id }, data: { status: IntegrationStatus.PENDING, disconnectedAt: null } }); await this.#audit(this.options.repositories, userId, `${provider.toLowerCase()}.connect`, "integration", row.id, requestId); return this.options.repositories.integrationConnection.findUniqueOrThrow({ where: { id: row.id } }); }
  async #setStatus(userId: string, provider: IntegrationProvider, status: IntegrationStatus, requestId?: string): Promise<any> { const row = await this.#ensureConnection(userId, provider); const updated = await this.options.repositories.integrationConnection.update({ where: { id: row.id }, data: { status, ...(status === IntegrationStatus.CONNECTED ? { connectedAt: new Date(), disconnectedAt: null } : { disconnectedAt: new Date() }) } }); await this.#audit(this.options.repositories, userId, `${provider.toLowerCase()}.status`, "integration", row.id, requestId); return updated; }
  #publicSend(row: any) { return { id: row.id, recipientRef: row.opaqueRecipientRef, preview: row.preview, status: row.status, confirmationExpiresAt: row.confirmationExpiresAt.toISOString(), errorCode: row.errorCode ?? null }; }
  #publicSpotifyAction(row: any) { return { id: row.id, action: row.action, status: row.status, confirmationExpiresAt: row.confirmationExpiresAt?.toISOString() ?? null, resultCode: row.resultCode ?? null, errorCode: row.errorCode ?? null }; }
  #audit(repo: P9Repositories, userId: string, eventType: string, resourceType: string, resourceId: string, requestId?: string) { return repo.auditEvent.create({ data: { eventType, outcome: "success", actorType: "user", resourceType, resourceId, userId, ...(requestId ? { requestId } : {}), metadata: {} } }); }
}
