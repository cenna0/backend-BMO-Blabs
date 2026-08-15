import { createHash, randomBytes } from "node:crypto";
import type { Prisma, PrismaClient } from "../../generated/prisma/client.js";
import { IntegrationProvider, IntegrationStatus, SpotifyActionStatus, WhatsAppConversationType, WhatsAppRuleScope, WhatsAppSendStatus } from "../../generated/prisma/enums.js";
import { withP9Transaction } from "../db/client.js";
import { P9Repositories } from "../db/repositories.js";
import { P9Error } from "../errors.js";
import { decryptProviderToken, encryptProviderToken } from "../integrations.crypto.js";
import { parseSpotifyAction, parseWhatsAppRulesPatch } from "../integrations.validation.js";
import { SpotifyProviderError, type SpotifyCurrentUser, type SpotifySearchType } from "../providers/spotify.client.js";
import type { HermesWhatsAppMessage } from "../providers/hermes-whatsapp.client.js";
import { HermesWhatsAppProviderError } from "../providers/hermes-whatsapp.client.js";
import { preferredWhatsAppDestination, type WhatsAppIdentityResolverBoundary } from "../providers/hermes-whatsapp-identity.client.js";
import type { MobileOutboundEvent } from "../websocket/mobile-events.js";

const OAUTH_TTL_MS = 10 * 60_000;
const CONFIRMATION_TTL_MS = 5 * 60_000;
const SPOTIFY_SCOPES = ["user-read-private", "user-read-playback-state", "user-modify-playback-state", "playlist-read-private"];
const TOKEN_REFRESH_SKEW_MS = 30_000;
const SPOTIFY_REFRESH_LIFETIME_MONTHS = 6;
const ALL_SEARCH_TYPES: SpotifySearchType[] = ["track", "artist", "album", "playlist"];

type PublicConnection = { provider: "whatsapp" | "spotify"; status: string; connectedAt: string | null; scopes: string[] };
type WhatsAppRuleRow = { id?: string; scope: "ALL" | "CONTACT" | "GROUP"; opaqueTargetRef: string | null; enabled: boolean; speakOnDevice: boolean; updatedAt?: Date };
type WhatsAppConversationRow = { id: string; userId: string; connectionId: string; provider: IntegrationProvider; opaqueChatRef: string; displayName: string; type: "DM" | "GROUP"; lastActivityAt: Date; createdAt?: Date };
type WhatsAppConversationAliasRow = { id: string; userId: string; connectionId: string; provider: IntegrationProvider; conversationId: string; providerRef: string };
type MobileEvents = { sendToUser(userId: string, event: MobileOutboundEvent): number };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function isUuid(value: unknown): value is string { return typeof value === "string" && UUID_PATTERN.test(value); }

function publicConnection(row: any, provider: "whatsapp" | "spotify"): PublicConnection {
  return { provider, status: row.status, connectedAt: row.connectedAt?.toISOString() ?? null, scopes: row.scopes ?? [] };
}

function matchingWhatsAppRule(rules: WhatsAppRuleRow[], conversation: WhatsAppConversationRow): WhatsAppRuleRow | undefined {
  if (conversation.type === "GROUP") return rules.find((rule) => rule.scope === "GROUP" && (rule.opaqueTargetRef === conversation.id || rule.opaqueTargetRef === conversation.opaqueChatRef));
  return rules.find((rule) => rule.scope === "CONTACT" && (rule.opaqueTargetRef === conversation.id || rule.opaqueTargetRef === conversation.opaqueChatRef));
}

function whatsappNotificationRule(rules: WhatsAppRuleRow[], conversation: WhatsAppConversationRow): WhatsAppRuleRow | undefined {
  const targeted = matchingWhatsAppRule(rules, conversation);
  if (targeted) return targeted;
  if (conversation.type === "GROUP") return undefined;
  return rules.find((rule) => rule.scope === "ALL" && rule.opaqueTargetRef === null);
}

function shouldNotifyWhatsApp(rules: WhatsAppRuleRow[], conversation: WhatsAppConversationRow): boolean {
  const rule = whatsappNotificationRule(rules, conversation);
  return rule?.enabled === true;
}

function uniqueProviderRefs(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))];
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
  exchangeCode?(code: string, redirectUri: string): Promise<{ accessToken: string; refreshToken?: string; expiresIn: number; scopes: string[] }>;
  refreshToken?(refreshToken: string): Promise<{ accessToken: string; refreshToken?: string; expiresIn: number; scopes: string[] }>;
  currentUser?(accessToken: string): Promise<SpotifyCurrentUser>;
  search?(accessToken: string, query: string, types: SpotifySearchType[], market?: string | null): Promise<unknown>;
  devices?(accessToken: string): Promise<unknown[]>;
  playback?(accessToken: string): Promise<unknown | null>;
  action?(accessToken: string, action: string, payload: Record<string, unknown>): Promise<{ code: string; metadata?: string }>;
}

export class IntegrationService {
  constructor(private readonly options: {
    client: PrismaClient;
    repositories: P9Repositories;
    publicBaseUrl: string;
    spotifyTokenEncryptionKey?: string;
    spotifyClientId?: string;
    spotifyClientSecret?: string;
    spotifyCallbackUrl?: string;
    whatsApp?: HermesWhatsAppBoundary;
    whatsAppIdentity?: WhatsAppIdentityResolverBoundary;
    whatsAppProactiveDelivery?: (input: { userId: string; deliveryId: string; deviceId: string; text: string }) => Promise<void>;
    mobileEvents?: MobileEvents;
    spotify?: SpotifyProviderBoundary;
  }) {
    this.#refreshFlights = new Map();
  }

  #refreshFlights: Map<string, Promise<string>>;

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
    const owners = await this.options.repositories.integrationConnection.findMany({ where: { provider: IntegrationProvider.WHATSAPP, status: IntegrationStatus.CONNECTED }, select: { id: true, userId: true } });
    if (owners.length !== 1 || !owners[0]) return { processed: 0, queued: 0 };
    const owner = owners[0];
    let processed = 0;
    let queued = 0;
    for (const message of messages) {
      const duplicate = await this.options.repositories.whatsAppDelivery.findFirst({ where: { provider: IntegrationProvider.WHATSAPP, connectionId: owner.id, providerMessageRef: message.messageId } });
      if (duplicate) continue;
      const conversation = await this.#upsertWhatsAppConversation(owner.userId, owner.id, message);
      const delivery = await this.options.repositories.whatsAppDelivery.create({ data: {
        userId: owner.userId,
        connectionId: owner.id,
        provider: IntegrationProvider.WHATSAPP,
        conversationId: conversation.id,
        direction: "INBOUND",
        status: "RECEIVED",
        providerMessageRef: message.messageId,
        metadata: JSON.stringify({ chatId: message.chatId, senderId: message.senderId, isGroup: message.isGroup, bodyLength: message.body.length, fromOwner: message.fromOwner === true }),
      } });
      processed += 1;
      // The bridge marks owner-typed messages separately from /send echoes. They
      // update bounded delivery metadata only; they never become BMO prompts,
      // notifications, or proactive speech.
      if (message.fromOwner === true) continue;
      const rules = await this.options.repositories.whatsAppNotificationRule.findMany({ where: { userId: owner.userId, connectionId: owner.id, provider: IntegrationProvider.WHATSAPP } });
      const notificationRule = whatsappNotificationRule(rules as WhatsAppRuleRow[], conversation);
      if (!shouldNotifyWhatsApp(rules as WhatsAppRuleRow[], conversation)) continue;
      if (this.options.mobileEvents) {
        try {
          this.options.mobileEvents.sendToUser(owner.userId, {
            event: "whatsapp_notification",
            conversationId: conversation.id,
            displayName: conversation.displayName,
            conversationType: conversation.type,
            receivedAt: new Date().toISOString(),
          });
        } catch {
          // A mobile socket failure must not make the provider poller unhealthy.
        }
      }
      const shouldSpeak = notificationRule?.speakOnDevice === true;
      if (!shouldSpeak || !this.options.whatsAppProactiveDelivery) continue;
      const device = await this.options.repositories.device.findFirst({ where: { userId: owner.userId, status: "ACTIVE" }, orderBy: { createdAt: "asc" }, select: { id: true } });
      if (!device) continue;
      await this.options.whatsAppProactiveDelivery({ userId: owner.userId, deliveryId: delivery.id, deviceId: device.id, text: message.body });
      queued += 1;
    }
    return { processed, queued };
  }

  async whatsappConversations(userId: string, input: { limit: number; cursor?: string | undefined }): Promise<{ conversations: unknown[]; nextCursor: string | null }> {
    const connection = await this.#getConnection(userId, IntegrationProvider.WHATSAPP);
    if (!connection) return { conversations: [], nextCursor: null };
    const cursor = input.cursor ? this.#decodeWhatsAppCursor(input.cursor) : null;
    const rows = await this.options.repositories.whatsAppConversation.findMany({
      where: {
        userId,
        connectionId: connection.id,
        provider: IntegrationProvider.WHATSAPP,
        ...(cursor ? { OR: [{ lastActivityAt: { lt: cursor.at } }, { lastActivityAt: cursor.at, id: { gt: cursor.id } }] } : {}),
      },
      orderBy: [{ lastActivityAt: "desc" }, { id: "asc" }],
      take: input.limit + 1,
    });
    const hasMore = rows.length > input.limit;
    const page = hasMore ? rows.slice(0, input.limit) : rows;
    const rules = await this.options.repositories.whatsAppNotificationRule.findMany({ where: { userId, connectionId: connection.id, provider: IntegrationProvider.WHATSAPP } });
    return {
      conversations: page.map((row: WhatsAppConversationRow) => this.#publicWhatsAppConversation(row, rules as WhatsAppRuleRow[])),
      nextCursor: hasMore && page.at(-1) ? this.#encodeWhatsAppCursor(page.at(-1)!) : null,
    };
  }

  async whatsappConversation(userId: string, conversationId: string): Promise<unknown> {
    if (!isUuid(conversationId)) throw new P9Error("OWNERSHIP_DENIED", 404, "WhatsApp conversation not found");
    const row = await this.options.repositories.whatsAppConversation.findFirst({ where: { id: conversationId, userId, provider: IntegrationProvider.WHATSAPP } });
    if (!row) throw new P9Error("OWNERSHIP_DENIED", 404, "WhatsApp conversation not found");
    const rules = await this.options.repositories.whatsAppNotificationRule.findMany({ where: { userId, connectionId: row.connectionId, provider: IntegrationProvider.WHATSAPP } });
    return this.#publicWhatsAppConversation(row, rules as WhatsAppRuleRow[]);
  }

  async resolveWhatsAppConversation(userId: string, input: { phoneNumber: string; displayName?: string | undefined }): Promise<unknown> {
    const connection = await this.#requireConnectedWhatsAppOwner(userId);
    const opaqueChatRef = `${input.phoneNumber.slice(1)}@s.whatsapp.net`;
    const providerRefs = await this.#expandWhatsAppRefs([opaqueChatRef]);
    const rules = await this.options.repositories.whatsAppNotificationRule.findMany({ where: { userId, connectionId: connection.id, provider: IntegrationProvider.WHATSAPP } });
    const candidates = await this.#conversationCandidates(userId, connection.id, providerRefs);
    const canonical = this.#chooseCanonicalConversation(candidates, rules as WhatsAppRuleRow[]);
    const row = canonical
      ? (input.displayName ? await this.options.repositories.whatsAppConversation.update({ where: { id: canonical.id }, data: { displayName: input.displayName } }) : canonical)
      : await this.options.repositories.whatsAppConversation.create({ data: {
        userId,
        connectionId: connection.id,
        provider: IntegrationProvider.WHATSAPP,
        opaqueChatRef,
        displayName: input.displayName ?? "WhatsApp contact",
        type: WhatsAppConversationType.DM,
        lastActivityAt: await this.options.repositories.databaseNow(),
      } });
    await this.#ensureConversationAliases(userId, connection.id, row, providerRefs);
    return this.#publicWhatsAppConversation(row, rules as WhatsAppRuleRow[]);
  }

  async whatsappRules(userId: string): Promise<unknown[]> {
    const connection = await this.#getConnection(userId, IntegrationProvider.WHATSAPP);
    if (!connection) return [];
    const rows = await this.options.repositories.whatsAppNotificationRule.findMany({ where: { userId, connectionId: connection.id, provider: IntegrationProvider.WHATSAPP }, orderBy: [{ scope: "asc" }, { id: "asc" }] });
    return this.#publicWhatsAppRules(rows as WhatsAppRuleRow[], userId, connection.id);
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
          scope: rule.scope as WhatsAppRuleScope, opaqueTargetRef: rule.conversationId ?? null,
          enabled: rule.enabled, speakOnDevice: rule.speakOnDevice,
        } });
      }
      await this.#audit(repo, userId, "whatsapp.rules.updated", "integration", connection.id, requestId);
      const rows = await repo.whatsAppNotificationRule.findMany({ where: { userId, connectionId: connection.id, provider: IntegrationProvider.WHATSAPP }, orderBy: [{ scope: "asc" }, { id: "asc" }] });
      return this.#publicWhatsAppRules(rows as WhatsAppRuleRow[], userId, connection.id);
    });
  }

  async whatsappPreview(userId: string, input: { conversationId: string; message: string; idempotencyKey: string }, requestId?: string): Promise<unknown> {
    const connection = await this.#requireConnectedWhatsAppOwner(userId);
    if (!isUuid(input.conversationId)) throw new P9Error("OWNERSHIP_DENIED", 404, "WhatsApp conversation not found");
    const conversation = await this.options.repositories.whatsAppConversation.findFirst({ where: { id: input.conversationId, userId, connectionId: connection.id, provider: IntegrationProvider.WHATSAPP } });
    if (!conversation) throw new P9Error("OWNERSHIP_DENIED", 404, "WhatsApp conversation not found");
    const recipientRef = preferredWhatsAppDestination(await this.#expandWhatsAppRefs([conversation.opaqueChatRef])) ?? conversation.opaqueChatRef;
    const now = await this.options.repositories.databaseNow();
    const existing = await this.options.repositories.whatsAppSendRequest.findUnique({ where: { userId_idempotencyKey: { userId, idempotencyKey: input.idempotencyKey } } });
    if (existing) return this.#publicSend(existing);
    const row = await this.options.repositories.whatsAppSendRequest.create({ data: {
      userId, connectionId: connection.id, provider: IntegrationProvider.WHATSAPP,
      conversationId: conversation.id, opaqueRecipientRef: recipientRef, preview: input.message, idempotencyKey: input.idempotencyKey,
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
      if (row.conversationId) await this.options.repositories.whatsAppConversation.update({ where: { id: row.conversationId }, data: { lastActivityAt: now } });
      await this.options.repositories.whatsAppDelivery.create({ data: { userId, connectionId: row.connectionId, provider: IntegrationProvider.WHATSAPP, conversationId: row.conversationId ?? null, sendRequestId: row.id, direction: "OUTBOUND", status: "DELIVERED", providerMessageRef: sent.providerMessageRef ?? null, deliveredAt: now } });
      return this.#publicSend(finished);
    } catch {
      const failed = await this.options.repositories.whatsAppSendRequest.update({ where: { id: row.id }, data: { status: WhatsAppSendStatus.FAILED, errorCode: "PROVIDER_SEND_FAILED" } });
      return this.#publicSend(failed);
    }
  }

  async spotifyConnect(userId: string): Promise<{ authorizationUrl: string }> {
    if (!this.options.spotify || !this.options.spotifyClientId || !this.options.spotifyClientSecret || !this.options.spotifyCallbackUrl) throw new P9Error("BLOCKED_EXTERNAL_SECRET", 503, "Spotify provider is not configured");
    const redirectUri = this.options.spotifyCallbackUrl;
    const state = randomBytes(32).toString("hex");
    const verifier = createHash("sha256").update(state).digest("hex");
    await this.options.repositories.oAuthState.create({ data: { userId, provider: IntegrationProvider.SPOTIFY, stateVerifier: verifier, redirectUri, expiresAt: new Date(Date.now() + OAUTH_TTL_MS) } });
    const params = new URLSearchParams({ response_type: "code", client_id: this.options.spotifyClientId, redirect_uri: redirectUri, state, scope: SPOTIFY_SCOPES.join(" ") });
    return { authorizationUrl: `https://accounts.spotify.com/authorize?${params.toString()}` };
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
    if (!code || !this.options.spotify?.exchangeCode || !this.options.spotifyTokenEncryptionKey) throw new P9Error("BLOCKED_EXTERNAL_SECRET", 503, "Spotify provider is not configured");
    let tokens: Awaited<ReturnType<NonNullable<SpotifyProviderBoundary["exchangeCode"]>>>;
    try {
      tokens = await this.options.spotify.exchangeCode(code, oauth.redirectUri);
    } catch {
      await this.options.repositories.integrationConnection.updateMany({ where: { userId: oauth.userId, provider: IntegrationProvider.SPOTIFY }, data: { status: IntegrationStatus.ERROR } });
      throw new P9Error("SERVICE_UNAVAILABLE", 503, "Spotify authorization is unavailable");
    }
    const connection = await this.#ensureConnection(oauth.userId, IntegrationProvider.SPOTIFY);
    const key = this.#spotifyKey();
    if (key.length !== 32) throw new P9Error("SERVICE_UNAVAILABLE", 503, "Provider encryption is unavailable");
    if (!this.options.spotify.currentUser) throw new P9Error("SERVICE_UNAVAILABLE", 503, "Spotify account identity is unavailable");
    let account: SpotifyCurrentUser;
    try {
      account = await this.options.spotify.currentUser(tokens.accessToken);
    } catch (error) {
      throw this.#asP9ProviderError(error);
    }
    if (!account.accountId) throw new P9Error("SERVICE_UNAVAILABLE", 503, "Spotify account identity is unavailable");
    const access = encryptProviderToken(tokens.accessToken, key);
    const refresh = tokens.refreshToken ? encryptProviderToken(tokens.refreshToken, key) : null;
    await withP9Transaction(this.options.client, async (tx) => {
      const repo = new P9Repositories(tx);
      const accountOwner = await repo.spotifyCredential.findUnique({ where: { spotifyAccountId: account.accountId } });
      if (accountOwner && accountOwner.userId !== oauth.userId) throw new P9Error("OWNERSHIP_DENIED", 404, "Spotify account is already connected");
      const current = await repo.spotifyCredential.findUnique({ where: { userId: oauth.userId } });
      const refreshFields = refresh
        ? { refreshTokenCiphertext: refresh.ciphertext, refreshTokenNonce: refresh.nonce, refreshTokenTag: refresh.tag }
        : { refreshTokenCiphertext: current?.refreshTokenCiphertext ?? null, refreshTokenNonce: current?.refreshTokenNonce ?? null, refreshTokenTag: current?.refreshTokenTag ?? null };
      await repo.spotifyCredential.upsert({ where: { userId: oauth.userId }, create: {
        userId: oauth.userId, connectionId: connection.id, provider: IntegrationProvider.SPOTIFY,
        spotifyAccountId: account.accountId, spotifyProfileId: account.profileId,
        accessTokenCiphertext: access.ciphertext, accessTokenNonce: access.nonce, accessTokenTag: access.tag,
        ...refreshFields, keyVersion: access.keyVersion, expiresAt: new Date(now.getTime() + tokens.expiresIn * 1000),
        authorizedAt: now, market: account?.market ?? null, preferredDeviceId: current?.preferredDeviceId ?? null, scopes: tokens.scopes,
      }, update: {
        connectionId: connection.id, spotifyAccountId: account.accountId, spotifyProfileId: account.profileId,
        accessTokenCiphertext: access.ciphertext, accessTokenNonce: access.nonce, accessTokenTag: access.tag,
        ...refreshFields, keyVersion: access.keyVersion, expiresAt: new Date(now.getTime() + tokens.expiresIn * 1000),
        authorizedAt: now, market: account?.market ?? current?.market ?? null, scopes: tokens.scopes,
      } });
      await repo.integrationConnection.update({ where: { id: connection.id }, data: { status: IntegrationStatus.CONNECTED, scopes: tokens.scopes, externalReference: account.accountId, connectedAt: now, disconnectedAt: null } });
    });
    return { ok: true };
  }

  async spotifyDisconnect(userId: string): Promise<void> { await this.options.repositories.spotifyCredential.deleteMany({ where: { userId } }); await this.#setStatus(userId, IntegrationProvider.SPOTIFY, IntegrationStatus.DISCONNECTED, undefined, true); }
  async spotifySearch(userId: string, query: string, types: SpotifySearchType[] = ALL_SEARCH_TYPES): Promise<unknown> {
    if (!this.options.spotify?.search) throw new P9Error("BLOCKED_EXTERNAL_SECRET", 503, "Spotify provider is not configured");
    const credential = await this.options.repositories.spotifyCredential.findUnique({ where: { userId } });
    if (!credential) throw new P9Error("CONFLICT", 409, "Spotify is not connected");
    return this.#withSpotifyToken(userId, (accessToken) => this.options.spotify!.search!(accessToken, query, types, credential.market ?? null));
  }
  async spotifyDevices(userId: string): Promise<unknown[]> { return this.#spotifyProviderCall(userId, "devices"); }
  async spotifyActiveDevice(userId: string): Promise<unknown> {
    const devices = await this.spotifyDevices(userId);
    return (devices as Array<{ isActive?: boolean }>).find((device) => device.isActive === true) ?? null;
  }
  async spotifyPlayback(userId: string): Promise<unknown> { const value = await this.#spotifyProviderCall(userId, "playback"); return value ?? { code: "NO_ACTIVE_DEVICE" }; }

  async spotifyPreferredDevice(userId: string, deviceId: string | null): Promise<{ device: unknown | null }> {
    if (!this.options.spotify?.devices || !this.options.spotifyTokenEncryptionKey) throw new P9Error("BLOCKED_EXTERNAL_SECRET", 503, "Spotify provider is not configured");
    const credential = await this.options.repositories.spotifyCredential.findUnique({ where: { userId } });
    if (!credential) throw new P9Error("CONFLICT", 409, "Spotify is not connected");
    if (deviceId === null) {
      await this.options.repositories.spotifyCredential.update({ where: { userId }, data: { preferredDeviceId: null } });
      return { device: null };
    }
    const devices = await this.spotifyDevices(userId);
    const selected = (devices as Array<{ id?: unknown }>).find((device) => device.id === deviceId);
    if (!selected) throw new P9Error("CONFLICT", 409, "Spotify device is unavailable");
    await this.options.repositories.spotifyCredential.update({ where: { userId }, data: { preferredDeviceId: deviceId } });
    return { device: selected };
  }

  async spotifyAction(userId: string, input: unknown, requestId?: string): Promise<unknown> {
    const parsed = parseSpotifyAction(input);
    const connection = await this.#ensureConnection(userId, IntegrationProvider.SPOTIFY);
    const existing = await this.options.repositories.spotifyAction.findUnique({ where: { userId_idempotencyKey: { userId, idempotencyKey: parsed.idempotencyKey } } });
    if (existing) return this.#publicSpotifyAction(existing);
    const now = await this.options.repositories.databaseNow();
    const row = await this.options.repositories.spotifyAction.create({ data: { userId, connectionId: connection.id, provider: IntegrationProvider.SPOTIFY, action: parsed.action, payload: parsed.payload as Prisma.InputJsonValue, idempotencyKey: parsed.idempotencyKey, status: parsed.confirmed ? SpotifyActionStatus.CONFIRMED : SpotifyActionStatus.PENDING_CONFIRMATION, confirmationExpiresAt: parsed.confirmed ? null : new Date(now.getTime() + CONFIRMATION_TTL_MS) } });
    if (!parsed.confirmed) return this.#publicSpotifyAction(row);
    if (!this.options.spotify?.action || !this.options.spotifyTokenEncryptionKey) {
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

  async #expandWhatsAppRefs(refs: string[]): Promise<string[]> {
    const normalized = uniqueProviderRefs(refs);
    if (!this.options.whatsAppIdentity) return normalized;
    try {
      return uniqueProviderRefs(await this.options.whatsAppIdentity.expand(normalized));
    } catch {
      return normalized;
    }
  }

  async #upsertWhatsAppConversation(userId: string, connectionId: string, message: HermesWhatsAppMessage): Promise<WhatsAppConversationRow> {
    const type = message.isGroup ? WhatsAppConversationType.GROUP : WhatsAppConversationType.DM;
    const providerName = message.isGroup ? message.chatName : message.senderName;
    const displayName = providerName?.trim().slice(0, 120) || (message.isGroup ? "WhatsApp group" : "WhatsApp contact");
    const refs = message.isGroup ? [message.chatId] : await this.#expandWhatsAppRefs([message.chatId, message.senderId]);
    const rules = await this.options.repositories.whatsAppNotificationRule.findMany({ where: { userId, connectionId, provider: IntegrationProvider.WHATSAPP } });
    const candidates = await this.#conversationCandidates(userId, connectionId, refs);
    const canonical = this.#chooseCanonicalConversation(candidates, rules as WhatsAppRuleRow[]);
    if (canonical && candidates.length > 1) {
      await this.#mergeDuplicateWhatsAppConversations(userId, connectionId, canonical, candidates.filter((candidate) => candidate.id !== canonical.id), rules as WhatsAppRuleRow[]);
    }
    const activity = await this.options.repositories.databaseNow();
    const row = canonical
      ? await this.options.repositories.whatsAppConversation.update({ where: { id: canonical.id }, data: { type, lastActivityAt: activity, ...((canonical.displayName === "WhatsApp contact" || canonical.displayName === "WhatsApp group") ? { displayName } : {}) } })
      : await this.options.repositories.whatsAppConversation.create({ data: {
        userId,
        connectionId,
        provider: IntegrationProvider.WHATSAPP,
        opaqueChatRef: message.chatId,
        displayName,
        type,
        lastActivityAt: activity,
      } });
    await this.#ensureConversationAliases(userId, connectionId, row, refs);
    return row as WhatsAppConversationRow;
  }

  async #conversationCandidates(userId: string, connectionId: string, refs: string[]): Promise<WhatsAppConversationRow[]> {
    const provider = IntegrationProvider.WHATSAPP;
    const aliases = await this.options.repositories.whatsAppConversationAlias.findMany({ where: { userId, connectionId, provider, providerRef: { in: refs } } }) as WhatsAppConversationAliasRow[];
    const rows: WhatsAppConversationRow[] = [];
    for (const ref of refs) {
      const row = await this.options.repositories.whatsAppConversation.findFirst({ where: { userId, connectionId, provider, opaqueChatRef: ref } });
      if (row) rows.push(row as WhatsAppConversationRow);
    }
    const aliasConversationIds = [...new Set(aliases.map((alias) => alias.conversationId))];
    if (aliasConversationIds.length > 0) {
      const aliasRows = await this.options.repositories.whatsAppConversation.findMany({ where: { userId, connectionId, provider, id: { in: aliasConversationIds } } });
      rows.push(...(aliasRows as WhatsAppConversationRow[]));
    }
    return [...new Map(rows.map((row) => [row.id, row])).values()];
  }

  #chooseCanonicalConversation(rows: WhatsAppConversationRow[], rules: WhatsAppRuleRow[]): WhatsAppConversationRow | null {
    if (rows.length === 0) return null;
    return [...rows].sort((left, right) => {
      const leftExplicit = Number(rules.some((rule) => rule.scope !== "ALL" && (rule.opaqueTargetRef === left.id || rule.opaqueTargetRef === left.opaqueChatRef)));
      const rightExplicit = Number(rules.some((rule) => rule.scope !== "ALL" && (rule.opaqueTargetRef === right.id || rule.opaqueTargetRef === right.opaqueChatRef)));
      if (leftExplicit !== rightExplicit) return rightExplicit - leftExplicit;
      const leftCreated = left.createdAt?.getTime() ?? left.lastActivityAt.getTime();
      const rightCreated = right.createdAt?.getTime() ?? right.lastActivityAt.getTime();
      if (leftCreated !== rightCreated) return leftCreated - rightCreated;
      return left.id.localeCompare(right.id);
    })[0] ?? null;
  }

  async #ensureConversationAliases(userId: string, connectionId: string, conversation: WhatsAppConversationRow, refs: string[]): Promise<void> {
    const provider = IntegrationProvider.WHATSAPP;
    for (const providerRef of uniqueProviderRefs(refs)) {
      const existing = await this.options.repositories.whatsAppConversationAlias.findFirst({ where: { userId, connectionId, provider, providerRef } });
      if (existing) continue;
      await this.options.repositories.whatsAppConversationAlias.create({ data: { userId, connectionId, provider, conversationId: conversation.id, providerRef } });
    }
  }

  async #mergeDuplicateWhatsAppConversations(userId: string, connectionId: string, winner: WhatsAppConversationRow, losers: WhatsAppConversationRow[], rules: WhatsAppRuleRow[]): Promise<void> {
    const provider = IntegrationProvider.WHATSAPP;
    for (const loser of losers) {
      await this.options.repositories.whatsAppSendRequest.updateMany({ where: { userId, connectionId, provider, conversationId: loser.id }, data: { conversationId: winner.id } });
      await this.options.repositories.whatsAppDelivery.updateMany({ where: { userId, connectionId, provider, conversationId: loser.id }, data: { conversationId: winner.id } });

      const aliases = await this.options.repositories.whatsAppConversationAlias.findMany({ where: { userId, connectionId, provider, conversationId: loser.id } }) as WhatsAppConversationAliasRow[];
      for (const alias of aliases) {
        const winnerAlias = await this.options.repositories.whatsAppConversationAlias.findFirst({ where: { userId, connectionId, provider, providerRef: alias.providerRef } });
        if (winnerAlias && winnerAlias.conversationId === winner.id) {
          await this.options.repositories.whatsAppConversationAlias.deleteMany({ where: { id: alias.id } });
        } else {
          await this.options.repositories.whatsAppConversationAlias.update({ where: { id: alias.id }, data: { conversationId: winner.id } });
        }
      }

      const loserRules = rules.filter((rule) => rule.scope !== "ALL" && (rule.opaqueTargetRef === loser.id || rule.opaqueTargetRef === loser.opaqueChatRef));
      for (const loserRule of loserRules) {
        const winnerRule = rules.find((rule) => rule !== loserRule && rule.scope === loserRule.scope && (rule.opaqueTargetRef === winner.id || rule.opaqueTargetRef === winner.opaqueChatRef));
        if (winnerRule) {
          if (loserRule.id) await this.options.repositories.whatsAppNotificationRule.deleteMany({ where: { id: loserRule.id } });
        } else if (loserRule.id) {
          await this.options.repositories.whatsAppNotificationRule.update({ where: { id: loserRule.id }, data: { opaqueTargetRef: winner.id } });
        }
      }
      await this.options.repositories.whatsAppConversation.delete({ where: { id: loser.id } });
    }
  }

  #publicWhatsAppConversation(row: WhatsAppConversationRow, rules: WhatsAppRuleRow[]) {
    return {
      id: row.id,
      displayName: row.displayName,
      type: row.type,
      notificationEnabled: shouldNotifyWhatsApp(rules, row),
      lastActivityAt: row.lastActivityAt.toISOString(),
    };
  }

  async #publicWhatsAppRules(rows: WhatsAppRuleRow[], userId: string, connectionId: string): Promise<unknown[]> {
    const result: unknown[] = [];
    for (const row of rows) {
      if (row.scope === "ALL") {
        result.push({ id: (row as any).id, scope: row.scope, conversationId: null, enabled: row.enabled, speakOnDevice: row.speakOnDevice });
        continue;
      }
      if (!row.opaqueTargetRef) continue;
      const conversation = await this.options.repositories.whatsAppConversation.findFirst({ where: { userId, connectionId, provider: IntegrationProvider.WHATSAPP, ...(isUuid(row.opaqueTargetRef) ? { id: row.opaqueTargetRef } : { opaqueChatRef: row.opaqueTargetRef }) } });
      if (!conversation) continue;
      result.push({ id: (row as any).id, scope: row.scope, conversationId: conversation.id, enabled: row.enabled, speakOnDevice: row.speakOnDevice });
    }
    return result;
  }

  #encodeWhatsAppCursor(row: WhatsAppConversationRow): string { return `${row.lastActivityAt.toISOString()}|${row.id}`; }

  #decodeWhatsAppCursor(value: string): { at: Date; id: string } {
    const separator = value.lastIndexOf("|");
    const at = new Date(value.slice(0, separator));
    const id = value.slice(separator + 1);
    if (separator <= 0 || Number.isNaN(at.getTime()) || !isUuid(id)) throw new P9Error("INVALID_INPUT", 400, "Invalid WhatsApp conversation cursor");
    return { at, id };
  }

  async #spotifyProviderCall(userId: string, operation: "devices" | "playback"): Promise<any> {
    if (!this.options.spotify?.[operation] || !this.options.spotifyTokenEncryptionKey) throw new P9Error("BLOCKED_EXTERNAL_SECRET", 503, "Spotify provider is not configured");
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
    if (!this.options.spotifyTokenEncryptionKey) throw new P9Error("BLOCKED_EXTERNAL_SECRET", 503, "Spotify provider is not configured");
    const credential = await this.options.repositories.spotifyCredential.findUnique({ where: { userId } });
    if (!credential) throw new P9Error("CONFLICT", 409, "Spotify is not connected");
    const key = this.#spotifyKey();
    try {
      const accessToken = decryptProviderToken({ ciphertext: credential.accessTokenCiphertext, nonce: credential.accessTokenNonce, tag: credential.accessTokenTag, keyVersion: credential.keyVersion }, key);
      const now = await this.options.repositories.databaseNow();
      if (!forceRefresh && credential.expiresAt.getTime() > now.getTime() + TOKEN_REFRESH_SKEW_MS) return accessToken;
      return this.#refreshAccessToken(userId, forceRefresh);
    } catch (error) {
      if (error instanceof P9Error) throw error;
      if (forceRefresh) await this.options.repositories.integrationConnection.updateMany({ where: { userId, provider: IntegrationProvider.SPOTIFY }, data: { status: IntegrationStatus.ERROR } });
      throw new P9Error("SERVICE_UNAVAILABLE", 503, "Provider credential is unavailable");
    }
  }

  async #refreshAccessToken(userId: string, forceRefresh: boolean): Promise<string> {
    const inFlight = this.#refreshFlights.get(userId);
    if (inFlight) return inFlight;
    const refresh = this.#refreshAccessTokenOnce(userId, forceRefresh);
    this.#refreshFlights.set(userId, refresh);
    try {
      return await refresh;
    } finally {
      if (this.#refreshFlights.get(userId) === refresh) this.#refreshFlights.delete(userId);
    }
  }

  async #refreshAccessTokenOnce(userId: string, forceRefresh: boolean): Promise<string> {
    const decision = await this.#withSpotifyRefreshLock(userId, async (repo) => {
      const credential = await repo.spotifyCredential.findUnique({ where: { userId } });
      if (!credential) throw new P9Error("RECONNECT_REQUIRED", 409, "Spotify requires reconnection");
      const now = await repo.databaseNow();
      const authorizedAt = credential.authorizedAt ?? credential.createdAt ?? now;
      const reauthorizationAt = new Date(authorizedAt);
      reauthorizationAt.setMonth(reauthorizationAt.getMonth() + SPOTIFY_REFRESH_LIFETIME_MONTHS);
      if (reauthorizationAt.getTime() <= now.getTime()) {
        return { kind: "RECONNECT" as const, now };
      }
      const key = this.#spotifyKey();
      const currentAccess = decryptProviderToken({ ciphertext: credential.accessTokenCiphertext, nonce: credential.accessTokenNonce, tag: credential.accessTokenTag, keyVersion: credential.keyVersion }, key);
      if (!forceRefresh && credential.expiresAt.getTime() > now.getTime() + TOKEN_REFRESH_SKEW_MS) return currentAccess;
      if (!this.options.spotify?.refreshToken || !credential.refreshTokenCiphertext || !credential.refreshTokenNonce || !credential.refreshTokenTag) {
        return { kind: "RECONNECT" as const, now };
      }
      const refreshToken = decryptProviderToken({ ciphertext: credential.refreshTokenCiphertext, nonce: credential.refreshTokenNonce, tag: credential.refreshTokenTag, keyVersion: credential.keyVersion }, key);
      let tokens: Awaited<ReturnType<NonNullable<SpotifyProviderBoundary["refreshToken"]>>>;
      try {
        tokens = await this.options.spotify.refreshToken(refreshToken);
      } catch (error) {
        if (error instanceof SpotifyProviderError && error.code === "INVALID_GRANT") {
          return { kind: "RECONNECT" as const, now };
        }
        throw this.#asP9ProviderError(error);
      }
      const scopes = tokens.scopes.length > 0 ? tokens.scopes : credential.scopes;
      const refreshedAccess = encryptProviderToken(tokens.accessToken, key);
      const refreshedToken = tokens.refreshToken ? encryptProviderToken(tokens.refreshToken, key) : null;
      await repo.spotifyCredential.update({ where: { userId }, data: {
        accessTokenCiphertext: refreshedAccess.ciphertext, accessTokenNonce: refreshedAccess.nonce, accessTokenTag: refreshedAccess.tag,
        ...(refreshedToken ? { refreshTokenCiphertext: refreshedToken.ciphertext, refreshTokenNonce: refreshedToken.nonce, refreshTokenTag: refreshedToken.tag } : {}),
        keyVersion: refreshedAccess.keyVersion, expiresAt: new Date(now.getTime() + tokens.expiresIn * 1_000), scopes,
      } });
      await repo.integrationConnection.updateMany({ where: { userId, provider: IntegrationProvider.SPOTIFY }, data: { status: IntegrationStatus.CONNECTED, scopes } });
      return { kind: "TOKEN" as const, accessToken: tokens.accessToken };
    });
    if (typeof decision === "string") return decision;
    if (decision.kind === "RECONNECT") {
      await this.#markSpotifyReconnectRequired(userId, decision.now);
      throw new P9Error("RECONNECT_REQUIRED", 409, "Spotify requires reconnection");
    }
    return decision.accessToken;
  }

  async #withSpotifyRefreshLock<T>(userId: string, work: (repo: P9Repositories) => Promise<T>): Promise<T> {
    const client = this.options.client as PrismaClient & { $transaction?: unknown };
    if (typeof client.$transaction !== "function") return work(this.options.repositories);
    return withP9Transaction(client as PrismaClient, async (tx) => {
      const repo = new P9Repositories(tx);
      await repo.lockUser(userId);
      return work(repo);
    });
  }

  #spotifyKey(): Buffer {
    if (!this.options.spotifyTokenEncryptionKey) throw new P9Error("BLOCKED_EXTERNAL_SECRET", 503, "Spotify provider is not configured");
    const key = Buffer.from(this.options.spotifyTokenEncryptionKey, "base64url");
    if (key.length !== 32) throw new P9Error("SERVICE_UNAVAILABLE", 503, "Provider encryption is unavailable");
    return key;
  }

  async #markSpotifyReconnectRequired(userId: string, now: Date): Promise<void> {
    await this.options.repositories.spotifyCredential.deleteMany({ where: { userId } });
    await this.options.repositories.integrationConnection.updateMany({ where: { userId, provider: IntegrationProvider.SPOTIFY }, data: {
      status: IntegrationStatus.RECONNECT_REQUIRED, scopes: [], externalReference: null, connectedAt: null, disconnectedAt: now,
    } });
  }

  async #executeSpotifyAction(userId: string, action: string, payload: Record<string, unknown>): Promise<{ code: string; metadata?: string }> {
    if (action === "SEARCH") {
      if (!this.options.spotify?.search || typeof payload.query !== "string") throw new P9Error("INVALID_INPUT", 400, "Spotify search query is required");
      const result = await this.spotifySearch(userId, payload.query, ALL_SEARCH_TYPES);
      return { code: "SPOTIFY_SEARCH_COMPLETED", metadata: JSON.stringify({ resultCount: Object.values(result as Record<string, unknown>).reduce<number>((total, value) => total + (Array.isArray(value) ? value.length : 0), 0) }).slice(0, 2000) };
    }
    if (action === "PLAY" && typeof payload.uri !== "string" && typeof payload.query === "string") {
      if (!this.options.spotify?.search) throw new P9Error("BLOCKED_EXTERNAL_SECRET", 503, "Spotify provider is not configured");
      const targetType = typeof payload.targetType === "string" && ["track", "artist", "album", "playlist"].includes(payload.targetType) ? payload.targetType as SpotifySearchType : undefined;
      const results = await this.spotifySearch(userId, payload.query, targetType ? [targetType] : ALL_SEARCH_TYPES);
      const selected = this.#selectSpotifyTarget(results, payload.query as string, targetType);
      if (!selected) throw new P9Error("CONFLICT", 409, "Spotify match not found");
      const resolvedAction = selected.type === "track" ? "PLAY_TRACK" : selected.type === "artist" ? "PLAY_ARTIST" : selected.type === "album" ? "PLAY_ALBUM" : "PLAY_PLAYLIST";
      const device = await this.#resolveSpotifyDevice(userId, payload);
      return this.#withSpotifyToken(userId, (accessToken) => this.options.spotify!.action!(accessToken, resolvedAction, { uri: selected.uri, deviceId: device.id }));
    }
    if (!this.options.spotify?.action) throw new P9Error("BLOCKED_EXTERNAL_SECRET", 503, "Spotify provider is not configured");
    if (action === "TRANSFER") {
      const device = await this.#resolveSpotifyDevice(userId, payload, true);
      const result = await this.#withSpotifyToken(userId, (accessToken) => this.options.spotify!.action!(accessToken, action, { ...payload, deviceId: device.id }));
      if (payload.preferred === true) await this.options.repositories.spotifyCredential.update({ where: { userId }, data: { preferredDeviceId: device.id } });
      return result;
    }
    const needsDevice = ["PLAY", "PLAY_TRACK", "PLAY_ARTIST", "PLAY_ALBUM", "PLAY_PLAYLIST", "PAUSE", "RESUME", "NEXT", "PREVIOUS", "SEEK", "VOLUME", "SHUFFLE", "REPEAT"].includes(action);
    const device = needsDevice ? await this.#resolveSpotifyDevice(userId, payload) : null;
    return this.#withSpotifyToken(userId, (accessToken) => this.options.spotify!.action!(accessToken, action, { ...payload, ...(device ? { deviceId: device.id } : {}) }));
  }

  async #resolveSpotifyDevice(userId: string, payload: Record<string, unknown>, explicitRequired = false): Promise<{ id: string; [key: string]: unknown }> {
    const devices = await this.spotifyDevices(userId) as Array<{ id?: unknown; name?: unknown; isActive?: unknown }>;
    const explicitId = typeof payload.deviceId === "string" ? payload.deviceId : undefined;
    const explicitName = typeof payload.deviceName === "string" ? payload.deviceName.trim().toLocaleLowerCase() : undefined;
    const explicit = explicitId ? devices.find((device) => device.id === explicitId) : explicitName ? devices.find((device) => typeof device.name === "string" && device.name.trim().toLocaleLowerCase() === explicitName) : undefined;
    if (explicit && typeof explicit.id === "string") return explicit as { id: string; [key: string]: unknown };
    if (explicitRequired || explicitId !== undefined || explicitName !== undefined) throw new P9Error("CONFLICT", 409, "Spotify device is unavailable");
    const credential = await this.options.repositories.spotifyCredential.findUnique({ where: { userId } });
    if (credential?.preferredDeviceId) {
      const preferred = devices.find((device) => device.id === credential.preferredDeviceId);
      if (preferred && typeof preferred.id === "string") return preferred as { id: string; [key: string]: unknown };
    }
    const active = devices.find((device) => device.isActive === true);
    if (active && typeof active.id === "string") return active as { id: string; [key: string]: unknown };
    throw new P9Error("NO_ACTIVE_DEVICE", 409, "Open Spotify on a phone, laptop, or other device first");
  }

  #selectSpotifyTarget(results: unknown, query: string, targetType?: SpotifySearchType): { type: SpotifySearchType; uri: string } | null {
    if (!results || typeof results !== "object") return null;
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const types: SpotifySearchType[] = targetType ? [targetType] : ALL_SEARCH_TYPES;
    const candidates = types.flatMap((type, typeIndex) => {
      const values = (results as Record<string, unknown>)[`${type}s`];
      return Array.isArray(values) ? values.filter((value): value is { name?: string; uri?: string } => typeof value === "object" && value !== null).slice(0, 10).map((value, index) => ({ type, typeIndex, index, uri: typeof value.uri === "string" ? value.uri : "", name: typeof value.name === "string" ? value.name : "" })) : [];
    }).filter((value) => value.uri.length > 0);
    const normalizedTokens = normalizedQuery.split(/\s+/u).filter(Boolean);
    const score = (name: string): number => {
      const normalizedName = name.trim().toLocaleLowerCase();
      if (normalizedName === normalizedQuery) return 0;
      if (normalizedName.startsWith(normalizedQuery)) return 1;
      if (normalizedTokens.every((token) => normalizedName.includes(token))) return 2;
      if (normalizedName.includes(normalizedQuery)) return 3;
      return 4;
    };
    return candidates.sort((left, right) => score(left.name) - score(right.name) || left.typeIndex - right.typeIndex || left.index - right.index)[0] ?? null;
  }

  #asP9ProviderError(error: unknown): P9Error {
    if (error instanceof P9Error) return error;
    if (error instanceof SpotifyProviderError && error.code === "INVALID_GRANT") return new P9Error("RECONNECT_REQUIRED", 409, "Spotify requires reconnection");
    if (error instanceof SpotifyProviderError && error.code === "PREMIUM_REQUIRED") return new P9Error("PREMIUM_REQUIRED", 403, "Spotify Premium is required for playback control");
    if (error instanceof SpotifyProviderError && error.code === "RATE_LIMITED") return new P9Error("RATE_LIMITED", 429, "Spotify is temporarily rate limited");
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
    const rows = await this.options.repositories.integrationConnection.findMany({ where: { provider: IntegrationProvider.WHATSAPP }, select: { userId: true, status: true, externalReference: true } });
    if (rows.some((row: any) => row.userId !== userId && (row.status === IntegrationStatus.CONNECTED || row.externalReference !== null))) {
      throw new P9Error("OWNERSHIP_DENIED", 404, "WhatsApp connection is not available");
    }
  }
  async #requireConnectedWhatsAppOwner(userId: string): Promise<any> {
    const connection = await this.#getConnection(userId, IntegrationProvider.WHATSAPP);
    const owners = await this.options.repositories.integrationConnection.findMany({ where: { provider: IntegrationProvider.WHATSAPP, status: IntegrationStatus.CONNECTED }, select: { id: true, userId: true } });
    if (!connection || connection.status !== IntegrationStatus.CONNECTED || owners.length !== 1 || owners[0]?.userId !== userId || owners[0]?.id !== connection.id) throw new P9Error("OWNERSHIP_DENIED", 404, "WhatsApp connection is not available");
    return connection;
  }
  async #ensureConnection(userId: string, provider: IntegrationProvider): Promise<any> { const current = await this.#getConnection(userId, provider); if (current) return current; return this.options.repositories.integrationConnection.create({ data: { userId, provider, scopes: [], status: IntegrationStatus.DISCONNECTED } }); }
  async #upsertConnection(userId: string, provider: IntegrationProvider, requestId?: string): Promise<any> { const row = await this.#ensureConnection(userId, provider); await this.options.repositories.integrationConnection.update({ where: { id: row.id }, data: { status: IntegrationStatus.PENDING, disconnectedAt: null } }); await this.#audit(this.options.repositories, userId, `${provider.toLowerCase()}.connect`, "integration", row.id, requestId); return this.options.repositories.integrationConnection.findUniqueOrThrow({ where: { id: row.id } }); }
  async #setStatus(userId: string, provider: IntegrationProvider, status: IntegrationStatus, requestId?: string, clearExternalReference = false): Promise<any> { const row = await this.#ensureConnection(userId, provider); const updated = await this.options.repositories.integrationConnection.update({ where: { id: row.id }, data: { status, ...(status === IntegrationStatus.CONNECTED ? { connectedAt: new Date(), disconnectedAt: null } : { disconnectedAt: new Date() }), ...(clearExternalReference ? { externalReference: null } : {}) } }); await this.#audit(this.options.repositories, userId, `${provider.toLowerCase()}.status`, "integration", row.id, requestId); return updated; }
  #publicSend(row: any) { return { id: row.id, conversationId: row.conversationId ?? null, preview: row.preview, status: row.status, confirmationExpiresAt: row.confirmationExpiresAt.toISOString(), errorCode: row.errorCode ?? null }; }
  #publicSpotifyAction(row: any) { return { id: row.id, action: row.action, status: row.status, confirmationExpiresAt: row.confirmationExpiresAt?.toISOString() ?? null, resultCode: row.resultCode ?? null, errorCode: row.errorCode ?? null }; }
  #audit(repo: P9Repositories, userId: string, eventType: string, resourceType: string, resourceId: string, requestId?: string) { return repo.auditEvent.create({ data: { eventType, outcome: "success", actorType: "user", resourceType, resourceId, userId, ...(requestId ? { requestId } : {}), metadata: {} } }); }
}
