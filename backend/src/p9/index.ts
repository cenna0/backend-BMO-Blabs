import { createP9Client, disconnectP9Client } from "./db/client.js";
import { P9Repositories } from "./db/repositories.js";
import type { P9Config } from "./config.js";
import { AuthService } from "./services/auth.service.js";
import { DeviceService } from "./services/device.service.js";
import { InvitationService } from "./services/invitation.service.js";
import { HardwareEnrollmentService, type HardwareEnrollmentEventSender } from "./services/hardware-enrollment.service.js";
import { AccessTokenService, SessionService } from "./services/session.service.js";
import { SettingsService } from "./services/settings.service.js";
import { UserService } from "./services/user.service.js";
import { DeviceBindingService, type ApplicationDeviceBinding } from "./services/device-binding.service.js";
import { createP9Router } from "./http/router.js";
import type { Router } from "express";
import type { Logger } from "pino";
import { areRequiredP9MigrationsFinished } from "./migration-manifest.js";
import { RecoveryService } from "./services/recovery.service.js";
import { ProfileService } from "./services/profile.service.js";
import { PersonalizationService } from "./services/personalization.service.js";
import { AvatarStorage } from "./services/avatar-storage.service.js";
import { AvatarService } from "./services/avatar.service.js";
import type { AvatarReconciliationResult } from "./services/avatar.service.js";
import { createAvatarMediaRouter } from "./http/profile.route.js";
import { authenticateMobileAccessToken } from "./websocket/mobile-auth.js";
import { ChatService, type MobileEventPublisher } from "./services/chat.service.js";
import { PostgresMemoryGateway } from "./services/memory-gateway.service.js";
import { MemoryService } from "./services/memory.service.js";
import { ScheduleService } from "./services/schedule.service.js";
import { ProactiveDeliveryService } from "./services/proactive-delivery.service.js";
import { DeviceAdditionsService } from "./services/device-additions.service.js";
import { decodeWifiEncryptionKey } from "./device-additions.crypto.js";
import { IntegrationService } from "./services/integration.service.js";
import { BugReportService } from "./services/bug-report.service.js";
import type { HermesGenerateClient } from "../services/hermes.client.js";
import { SpotifyApiClient } from "./providers/spotify.client.js";
import { HermesWhatsAppBridgeClient, HermesWhatsAppPairingClient } from "./providers/hermes-whatsapp.client.js";
import { HermesWhatsAppIdentityResolverClient } from "./providers/hermes-whatsapp-identity.client.js";

export interface P9Runtime {
  router: Router;
  mediaRouter: Router;
  initialize(): Promise<void>;
  reconcileAvatars(): Promise<AvatarReconciliationResult>;
  resolveDeviceBinding(hardwareId: string, deviceToken: string): Promise<ApplicationDeviceBinding | null>;
  authorizeDeviceBinding(binding: ApplicationDeviceBinding): Promise<boolean>;
  issueHardwareEnrollment(hardwareId: string, tokenHash: string): ReturnType<HardwareEnrollmentService["issueForHardware"]>;
  setHardwareEventSender(sender: HardwareEnrollmentEventSender): void;
  authenticateMobileSocket(accessToken: string): Promise<{
    userId: string;
    sessionId: string;
    expiresAt: Date;
  } | { kind: "expired" } | null>;
  checkReadiness(): Promise<boolean>;
  resumePendingChat(): Promise<number>;
  launchPendingChatRecovery(onError?: (error: unknown) => void): void;
  waitForChatIdle(): Promise<void>;
  runScheduler(): Promise<{ materialized: number; claimed: number; pendingPhysical: number }>;
  pollWhatsApp(): Promise<{ processed: number; queued: number }>;
  deviceAdditions: DeviceAdditionsService;
  settings: SettingsService;
  close(): Promise<void>;
}

export interface P9RuntimeOptions {
  includeOps?: boolean;
  hermes?: HermesGenerateClient;
  mobileEvents?: MobileEventPublisher;
  chatHardTimeoutMs?: number;
  logger?: Logger;
}

const unavailableHermes: HermesGenerateClient = {
  async generate(): Promise<string> {
    throw new Error("Hermes client is unavailable");
  },
};

const noMobileEvents: MobileEventPublisher = { sendToUser: () => 0 };

export async function checkP9Readiness(
  repositories: Pick<P9Repositories, "healthCheck" | "migrationStatus">,
): Promise<boolean> {
  try {
    await repositories.healthCheck();
    const migrations = await repositories.migrationStatus();
    return areRequiredP9MigrationsFinished(migrations);
  } catch {
    return false;
  }
}

export function createP9Runtime(config: P9Config, options: P9RuntimeOptions = {}): P9Runtime {
  if (!config.enabled || !config.databaseUrl || !config.jwtSecret || !config.pairingPepper) {
    throw new Error("P9 runtime requires enabled database and security configuration");
  }
  const client = createP9Client(config);
  const repositories = new P9Repositories(client);
  const accessTokens = new AccessTokenService({
    secret: new TextEncoder().encode(config.jwtSecret),
    issuer: "bmo-p9",
    audience: "bmo-mobile",
    lifetimeSeconds: config.accessTokenTtlSeconds,
  });
  const sessions = new SessionService({ client, repositories, accessTokens, refreshTokenTtlSeconds: config.refreshTokenTtlSeconds });
  const invitations = new InvitationService(repositories);
  const auth = new AuthService({ client, repositories, invitations, sessions, publicBaseUrl: config.publicBaseUrl });
  const users = new UserService(repositories, config.publicBaseUrl);
  const devices = new DeviceService(client, repositories);
  const pairing = new HardwareEnrollmentService({ client, pepper: config.pairingPepper, ttlSeconds: config.pairingTtlSeconds });
  const settings = new SettingsService(client, repositories);
  const recovery = new RecoveryService(client, repositories, {
    ttlSeconds: config.recoveryTokenTtlSeconds,
    maxAttempts: config.recoveryMaxAttempts,
  });
  const profile = new ProfileService(repositories, config.publicBaseUrl);
  const personalization = new PersonalizationService(repositories);
  const avatarStorage = new AvatarStorage(config.avatarStorageDir, config.avatarMaxBytes);
  const avatars = new AvatarService(client, avatarStorage, config.publicBaseUrl, {
    intervalMs: config.avatarGcIntervalMs,
    graceMs: config.avatarGcGraceMs,
    scanLimit: config.avatarGcScanLimit,
    batchSize: config.avatarGcBatchSize,
  });
  const deviceBinding = new DeviceBindingService(repositories);
  const memoryGateway = new PostgresMemoryGateway(repositories);
  const memory = new MemoryService({ client, repositories, hermes: options.hermes });
  const proactive = new ProactiveDeliveryService({ client, repositories, mobileEvents: options.mobileEvents ?? noMobileEvents });
  if (!config.wifiEncryptionKey) throw new Error("P9 runtime requires P9_WIFI_ENCRYPTION_KEY");
  const deviceAdditions = new DeviceAdditionsService({ client, repositories, encryptionKey: decodeWifiEncryptionKey(config.wifiEncryptionKey), deviceEvents: { sendToDevice: () => false } });
  const schedule = new ScheduleService({ client, repositories, mobileEvents: options.mobileEvents ?? noMobileEvents });
  const spotify = config.spotifyClientId && config.spotifyClientSecret
    ? new SpotifyApiClient({ clientId: config.spotifyClientId, clientSecret: config.spotifyClientSecret })
    : undefined;
  // The dedicated bridge is a personal-account transport. The bridge's
  // destructive queue is ingested here, while notification authorization is
  // owned by WhatsAppNotificationRule in the Backend.
  const whatsApp = new HermesWhatsAppBridgeClient({ baseUrl: config.whatsappBridgeUrl });
  const whatsAppPairing = new HermesWhatsAppPairingClient({ baseUrl: config.whatsappPairingUrl });
  const whatsAppIdentity = new HermesWhatsAppIdentityResolverClient({ baseUrl: config.whatsappIdentityResolverUrl, token: config.whatsappIdentityResolverToken });
  const integrations = new IntegrationService({
    client,
    repositories,
    publicBaseUrl: config.publicBaseUrl,
    ...(config.spotifyTokenEncryptionKey === undefined ? {} : { spotifyTokenEncryptionKey: config.spotifyTokenEncryptionKey }),
    ...(config.spotifyClientId === undefined ? {} : { spotifyClientId: config.spotifyClientId }),
    ...(config.spotifyClientSecret === undefined ? {} : { spotifyClientSecret: config.spotifyClientSecret }),
    ...(config.spotifyCallbackUrl === undefined ? {} : { spotifyCallbackUrl: config.spotifyCallbackUrl }),
    ...(spotify === undefined ? {} : { spotify }),
    whatsApp,
    whatsAppPairing,
    whatsAppIdentity,
    mobileEvents: options.mobileEvents ?? noMobileEvents,
    whatsAppProactiveDelivery: async (input) => {
      await proactive.enqueue({
        userId: input.userId,
        deviceId: input.deviceId,
        source: "WHATSAPP",
        sourceResourceType: "whatsapp_delivery",
        sourceResourceId: input.deliveryId,
        idempotencyKey: `whatsapp:${input.deliveryId}`,
      });
    },
  });
  const bugReports = new BugReportService({
    client,
    repositories,
    storageDir: config.bugReportStorageDir,
    resendApiKey: config.resendApiKey,
    supportNotificationEmail: config.supportNotificationEmail,
    supportNotificationEmails: config.supportNotificationEmails,
    supportFromEmail: config.supportFromEmail,
    logger: options.logger,
  });
  const chat = new ChatService({
    client,
    repositories,
    hermes: options.hermes ?? unavailableHermes,
    mobileEvents: options.mobileEvents ?? noMobileEvents,
    hardTimeoutMs: options.chatHardTimeoutMs ?? 180_000,
    memoryContext: memoryGateway,
  });
  return {
    router: createP9Router({ auth, sessions, users, devices, pairing, settings, recovery, profile, avatars, personalization, chat, memory, schedule, integrations, bugReports, deviceAdditions, accessTokens, repositories, config, includeOps: options.includeOps ?? false }),
    mediaRouter: createAvatarMediaRouter(avatarStorage),
    initialize: async () => {
      await avatarStorage.initialize();
    },
    reconcileAvatars: () => avatars.reconcile(),
    resolveDeviceBinding: (hardwareId, deviceToken) => deviceBinding.resolve(hardwareId, deviceToken),
    authorizeDeviceBinding: (binding) => deviceBinding.isActive(binding),
    issueHardwareEnrollment: (hardwareId, tokenHash) => pairing.issueForHardware({ hardwareId, tokenHash }),
    setHardwareEventSender: (sender) => pairing.setHardwareEventSender(sender),
    authenticateMobileSocket: (accessToken) =>
      authenticateMobileAccessToken(accessTokens, sessions, accessToken),
    checkReadiness: () => checkP9Readiness(repositories),
    pollWhatsApp: () => integrations.pollWhatsApp(),
    resumePendingChat: () => chat.resumePending(),
    launchPendingChatRecovery: (onError) => {
      void chat.resumePending().catch((error) => onError?.(error));
    },
    waitForChatIdle: () => chat.waitForIdle(),
    runScheduler: async () => {
      const workerId = `scheduler:${process.pid}`;
      const missed = await repositories.materializeMissedScheduleRuns({ limit: 100, missedAfterMs: 300_000 });
      for (const occurrence of missed) await schedule.advanceOccurrence(occurrence.scheduleId, occurrence.dueAt, occurrence.recurrence as any);
      const occurrences = await repositories.materializeDueScheduleRuns({ limit: 100, missedAfterMs: 300_000 });
      const claimed = await repositories.claimScheduleRuns({ workerId, limit: 100, leaseMs: 30_000 });
      for (const run of claimed as any[]) {
        const targets = Array.isArray(run.payload?.deliveryTargets) ? run.payload.deliveryTargets : [];
        try {
          if (targets.includes("DEVICE") && run.targetDeviceId) await proactive.enqueue({ userId: run.userId, deviceId: run.targetDeviceId, source: "SCHEDULE", sourceResourceType: "schedule_run", sourceResourceId: run.id, idempotencyKey: `schedule:${run.scheduleId}:${run.dueAt.toISOString()}:DEVICE`, expiresAt: new Date(run.dueAt.getTime() + 300_000) });
          if (targets.includes("MOBILE")) await proactive.enqueue({ userId: run.userId, source: "SCHEDULE", sourceResourceType: "schedule_run", sourceResourceId: run.id, idempotencyKey: `schedule:${run.scheduleId}:${run.dueAt.toISOString()}:MOBILE`, expiresAt: new Date(run.dueAt.getTime() + 300_000) });
          await schedule.advanceOccurrence(run.scheduleId, run.dueAt, run.recurrence);
          await repositories.finishScheduleRun({ runId: run.id, workerId, status: "SUCCEEDED" });
        } catch {
          const databaseNow = await repositories.databaseNow();
          await repositories.finishScheduleRun({ runId: run.id, workerId, status: "FAILED", errorCode: "DELIVERY_ENQUEUE_FAILED", retryAt: new Date(databaseNow.getTime() + 30_000) });
        }
      }
      const worker = await proactive.processOnce();
      return { materialized: occurrences.length + missed.length, claimed: claimed.length, pendingPhysical: worker.pendingPhysical };
    },
    deviceAdditions,
    settings,
    close: async () => {
      await chat.close();
      await avatarStorage.close();
      await disconnectP9Client(client);
    },
  };
}
