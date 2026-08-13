import { createHash, randomBytes } from "node:crypto";
import type { Prisma, PrismaClient } from "../../generated/prisma/client.js";
import { IntegrationProvider, IntegrationStatus, SpotifyActionStatus, WhatsAppRuleScope, WhatsAppSendStatus } from "../../generated/prisma/enums.js";
import { withP9Transaction } from "../db/client.js";
import { P9Repositories } from "../db/repositories.js";
import { P9Error } from "../errors.js";
import { decryptProviderToken, encryptProviderToken } from "../integrations.crypto.js";
import { parseSpotifyAction, parseWhatsAppRulesPatch } from "../integrations.validation.js";

const OAUTH_TTL_MS = 10 * 60_000;
const CONFIRMATION_TTL_MS = 5 * 60_000;
const SPOTIFY_SCOPES = ["user-read-playback-state", "user-modify-playback-state", "user-read-currently-playing", "user-read-private"];

type PublicConnection = { provider: "whatsapp" | "spotify"; status: string; connectedAt: string | null; scopes: string[] };

function publicConnection(row: any, provider: "whatsapp" | "spotify"): PublicConnection {
  return { provider, status: row.status, connectedAt: row.connectedAt?.toISOString() ?? null, scopes: row.scopes ?? [] };
}

export interface HermesWhatsAppBoundary {
  connect?(userId: string): Promise<{ externalReference?: string }>;
  qr?(userId: string): Promise<{ qr: string | null; expiresAt: Date | null }>;
  confirmScanned?(userId: string): Promise<void>;
  disconnect?(userId: string): Promise<void>;
  send?(userId: string, recipientRef: string, message: string): Promise<{ providerMessageRef?: string }>;
}

export interface SpotifyProviderBoundary {
  exchangeCode?(code: string, redirectUri: string): Promise<{ accessToken: string; refreshToken?: string; expiresIn: number; scopes: string[]; externalReference?: string }>;
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
    whatsApp?: HermesWhatsAppBoundary;
    spotify?: SpotifyProviderBoundary;
  }) {}

  async connection(userId: string, provider: IntegrationProvider): Promise<PublicConnection> {
    const row = await this.options.repositories.integrationConnection.findUnique({ where: { userId_provider: { userId, provider } } });
    return publicConnection(row ?? { status: IntegrationStatus.DISCONNECTED, scopes: [] }, provider === IntegrationProvider.WHATSAPP ? "whatsapp" : "spotify");
  }

  async connectWhatsApp(userId: string, requestId?: string): Promise<{ connection: PublicConnection; blocked: boolean }> {
    const result = await this.#upsertConnection(userId, IntegrationProvider.WHATSAPP, requestId);
    if (!this.options.whatsApp?.connect) return { connection: publicConnection(result, "whatsapp"), blocked: true };
    const external = await this.options.whatsApp.connect(userId);
    const updated = await this.options.repositories.integrationConnection.update({ where: { id: result.id }, data: { status: IntegrationStatus.PENDING, externalReference: external.externalReference ?? null } });
    return { connection: publicConnection(updated, "whatsapp"), blocked: false };
  }

  async whatsappQr(userId: string): Promise<{ qr: string | null; expiresAt: string | null; status: string }> {
    const row = await this.#getConnection(userId, IntegrationProvider.WHATSAPP);
    if (!this.options.whatsApp?.qr) return { qr: null, expiresAt: null, status: row?.status ?? IntegrationStatus.DISCONNECTED };
    const result = await this.options.whatsApp.qr(userId);
    return { qr: result.qr, expiresAt: result.expiresAt?.toISOString() ?? null, status: row?.status ?? IntegrationStatus.PENDING };
  }

  async confirmWhatsApp(userId: string, requestId?: string): Promise<PublicConnection> {
    if (!this.options.whatsApp?.confirmScanned) throw new P9Error("BLOCKED_EXTERNAL_SECRET", 503, "WhatsApp provider is not configured");
    await this.options.whatsApp.confirmScanned(userId);
    const row = await this.#setStatus(userId, IntegrationProvider.WHATSAPP, IntegrationStatus.CONNECTED, requestId);
    return publicConnection(row, "whatsapp");
  }

  async disconnectWhatsApp(userId: string, requestId?: string): Promise<void> {
    await this.options.whatsApp?.disconnect?.(userId);
    await this.#setStatus(userId, IntegrationProvider.WHATSAPP, IntegrationStatus.DISCONNECTED, requestId);
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
    const connection = await this.#ensureConnection(userId, IntegrationProvider.WHATSAPP);
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
    if (!process.env.SPOTIFY_CLIENT_ID || !process.env.SPOTIFY_CLIENT_SECRET || !process.env.SPOTIFY_CALLBACK_URL) throw new P9Error("BLOCKED_EXTERNAL_SECRET", 503, "Spotify provider is not configured");
    const redirectUri = this.options.publicBaseUrl + "/api/v1/integrations/spotify/callback";
    if (process.env.SPOTIFY_CALLBACK_URL !== redirectUri) throw new P9Error("BLOCKED_EXTERNAL_SECRET", 503, "Spotify callback is not registered");
    const state = randomBytes(32).toString("hex");
    const verifier = createHash("sha256").update(state).digest("hex");
    await this.options.repositories.oAuthState.create({ data: { userId, provider: IntegrationProvider.SPOTIFY, stateVerifier: verifier, redirectUri, expiresAt: new Date(Date.now() + OAUTH_TTL_MS) } });
    const params = new URLSearchParams({ response_type: "code", client_id: process.env.SPOTIFY_CLIENT_ID, redirect_uri: redirectUri, state, scope: SPOTIFY_SCOPES.join(" ") });
    return { authorizationUrl: `https://accounts.spotify.com/authorize?${params.toString()}`, state };
  }

  async spotifyCallback(state: string, code?: string, error?: string): Promise<{ ok: boolean }> {
    if (!/^[a-f0-9]{64}$/u.test(state)) throw new P9Error("AUTHENTICATION_FAILED", 401, "Invalid OAuth state");
    const verifier = createHash("sha256").update(state).digest("hex");
    const now = await this.options.repositories.databaseNow();
    const oauth = await this.options.repositories.oAuthState.findFirst({ where: { stateVerifier: verifier, provider: IntegrationProvider.SPOTIFY, usedAt: null, expiresAt: { gt: now } } });
    if (!oauth || oauth.redirectUri !== this.options.publicBaseUrl + "/api/v1/integrations/spotify/callback") throw new P9Error("AUTHENTICATION_FAILED", 401, "Invalid OAuth state");
    const used = await this.options.repositories.oAuthState.updateMany({ where: { id: oauth.id, usedAt: null }, data: { usedAt: now } });
    if (used.count !== 1) throw new P9Error("AUTHENTICATION_FAILED", 401, "Invalid OAuth state");
    if (error || !code || !this.options.spotify?.exchangeCode || !this.options.providerEncryptionKey) throw new P9Error("BLOCKED_EXTERNAL_SECRET", 503, "Spotify provider is not configured");
    const tokens = await this.options.spotify.exchangeCode(code, oauth.redirectUri);
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
  async spotifyDevices(userId: string): Promise<unknown[]> { return this.#spotifyProviderCall(userId, "devices"); }
  async spotifyPlayback(userId: string): Promise<unknown> { const value = await this.#spotifyProviderCall(userId, "playback"); return value ?? { code: "NO_ACTIVE_SPOTIFY_DEVICE" }; }

  async spotifyAction(userId: string, input: unknown, requestId?: string): Promise<unknown> {
    const parsed = parseSpotifyAction(input);
    const connection = await this.#ensureConnection(userId, IntegrationProvider.SPOTIFY);
    const existing = await this.options.repositories.spotifyAction.findUnique({ where: { userId_idempotencyKey: { userId, idempotencyKey: parsed.idempotencyKey } } });
    if (existing) return this.#publicSpotifyAction(existing);
    const now = await this.options.repositories.databaseNow();
    const row = await this.options.repositories.spotifyAction.create({ data: { userId, connectionId: connection.id, provider: IntegrationProvider.SPOTIFY, action: parsed.action, payload: parsed.payload as Prisma.InputJsonValue, idempotencyKey: parsed.idempotencyKey, status: parsed.confirmed ? SpotifyActionStatus.CONFIRMED : SpotifyActionStatus.PENDING_CONFIRMATION, confirmationExpiresAt: parsed.confirmed ? null : new Date(now.getTime() + CONFIRMATION_TTL_MS) } });
    if (!parsed.confirmed) return this.#publicSpotifyAction(row);
    if (!this.options.spotify?.action || !this.options.providerEncryptionKey) throw new P9Error("BLOCKED_EXTERNAL_SECRET", 503, "Spotify provider is not configured");
    const accessToken = await this.#accessToken(userId);
    const result = await this.options.spotify.action(accessToken, parsed.action, parsed.payload);
    const updated = await this.options.repositories.spotifyAction.update({ where: { id: row.id }, data: { status: SpotifyActionStatus.SUCCEEDED, resultCode: result.code, resultMetadata: result.metadata ?? null, confirmedAt: now } });
    await this.#audit(this.options.repositories, userId, "spotify.action", "spotify_action", row.id, requestId);
    return this.#publicSpotifyAction(updated);
  }

  async pluginCatalog(userId: string): Promise<unknown[]> {
    const [whatsapp, spotify] = await Promise.all([this.connection(userId, IntegrationProvider.WHATSAPP), this.connection(userId, IntegrationProvider.SPOTIFY)]);
    return [{ id: "whatsapp", title: "WhatsApp", installed: whatsapp.status !== IntegrationStatus.DISCONNECTED, status: whatsapp.status }, { id: "spotify", title: "Spotify", installed: spotify.status !== IntegrationStatus.DISCONNECTED, status: spotify.status }];
  }

  async #spotifyProviderCall(userId: string, operation: "devices" | "playback"): Promise<any> {
    if (!this.options.spotify?.[operation] || !this.options.providerEncryptionKey) throw new P9Error("BLOCKED_EXTERNAL_SECRET", 503, "Spotify provider is not configured");
    const credential = await this.options.repositories.spotifyCredential.findUnique({ where: { userId } });
    if (!credential) throw new P9Error("CONFLICT", 409, "Spotify is not connected");
    return this.options.spotify[operation](await this.#accessToken(userId));
  }

  async #accessToken(userId: string): Promise<string> {
    if (!this.options.providerEncryptionKey) throw new P9Error("BLOCKED_EXTERNAL_SECRET", 503, "Spotify provider is not configured");
    const credential = await this.options.repositories.spotifyCredential.findUnique({ where: { userId } });
    if (!credential) throw new P9Error("CONFLICT", 409, "Spotify is not connected");
    const key = Buffer.from(this.options.providerEncryptionKey, "base64url");
    if (key.length !== 32) throw new P9Error("SERVICE_UNAVAILABLE", 503, "Provider encryption is unavailable");
    try {
      return decryptProviderToken({ ciphertext: credential.accessTokenCiphertext, nonce: credential.accessTokenNonce, tag: credential.accessTokenTag, keyVersion: credential.keyVersion }, key);
    } catch {
      throw new P9Error("SERVICE_UNAVAILABLE", 503, "Provider credential is unavailable");
    }
  }

  async #getConnection(userId: string, provider: IntegrationProvider): Promise<any | null> { return this.options.repositories.integrationConnection.findUnique({ where: { userId_provider: { userId, provider } } }); }
  async #ensureConnection(userId: string, provider: IntegrationProvider): Promise<any> { const current = await this.#getConnection(userId, provider); if (current) return current; return this.options.repositories.integrationConnection.create({ data: { userId, provider, scopes: [], status: IntegrationStatus.DISCONNECTED } }); }
  async #upsertConnection(userId: string, provider: IntegrationProvider, requestId?: string): Promise<any> { const row = await this.#ensureConnection(userId, provider); await this.options.repositories.integrationConnection.update({ where: { id: row.id }, data: { status: IntegrationStatus.PENDING, disconnectedAt: null } }); await this.#audit(this.options.repositories, userId, `${provider.toLowerCase()}.connect`, "integration", row.id, requestId); return this.options.repositories.integrationConnection.findUniqueOrThrow({ where: { id: row.id } }); }
  async #setStatus(userId: string, provider: IntegrationProvider, status: IntegrationStatus, requestId?: string): Promise<any> { const row = await this.#ensureConnection(userId, provider); const updated = await this.options.repositories.integrationConnection.update({ where: { id: row.id }, data: { status, ...(status === IntegrationStatus.CONNECTED ? { connectedAt: new Date(), disconnectedAt: null } : { disconnectedAt: new Date() }) } }); await this.#audit(this.options.repositories, userId, `${provider.toLowerCase()}.status`, "integration", row.id, requestId); return updated; }
  #publicSend(row: any) { return { id: row.id, recipientRef: row.opaqueRecipientRef, preview: row.preview, status: row.status, confirmationExpiresAt: row.confirmationExpiresAt.toISOString(), errorCode: row.errorCode ?? null }; }
  #publicSpotifyAction(row: any) { return { id: row.id, action: row.action, status: row.status, confirmationExpiresAt: row.confirmationExpiresAt?.toISOString() ?? null, resultCode: row.resultCode ?? null, errorCode: row.errorCode ?? null }; }
  #audit(repo: P9Repositories, userId: string, eventType: string, resourceType: string, resourceId: string, requestId?: string) { return repo.auditEvent.create({ data: { eventType, outcome: "success", actorType: "user", resourceType, resourceId, userId, ...(requestId ? { requestId } : {}), metadata: {} } }); }
}
