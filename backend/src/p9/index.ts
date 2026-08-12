import { createP9Client, disconnectP9Client } from "./db/client.js";
import { P9Repositories } from "./db/repositories.js";
import type { P9Config } from "./config.js";
import { AuthService } from "./services/auth.service.js";
import { DeviceService } from "./services/device.service.js";
import { InvitationService } from "./services/invitation.service.js";
import { PairingService } from "./services/pairing.service.js";
import { AccessTokenService, SessionService } from "./services/session.service.js";
import { SettingsService } from "./services/settings.service.js";
import { UserService } from "./services/user.service.js";
import { DeviceBindingService, type ApplicationDeviceBinding } from "./services/device-binding.service.js";
import { createP9Router } from "./http/router.js";
import type { Router } from "express";
import { areRequiredP9MigrationsFinished } from "./migration-manifest.js";
import { RecoveryService } from "./services/recovery.service.js";
import { ProfileService } from "./services/profile.service.js";
import { PersonalizationService } from "./services/personalization.service.js";
import { AvatarStorage } from "./services/avatar-storage.service.js";
import { AvatarService } from "./services/avatar.service.js";
import type { AvatarReconciliationResult } from "./services/avatar.service.js";
import { createAvatarMediaRouter } from "./http/profile.route.js";
import { authenticateMobileAccessToken } from "./websocket/mobile-auth.js";

export interface P9Runtime {
  router: Router;
  mediaRouter: Router;
  initialize(): Promise<void>;
  reconcileAvatars(): Promise<AvatarReconciliationResult>;
  resolveDeviceBinding(hardwareId: string, deviceToken: string): Promise<ApplicationDeviceBinding | null>;
  authorizeDeviceBinding(binding: ApplicationDeviceBinding): Promise<boolean>;
  authenticateMobileSocket(accessToken: string): Promise<{
    userId: string;
    sessionId: string;
    expiresAt: Date;
  } | { kind: "expired" } | null>;
  checkReadiness(): Promise<boolean>;
  close(): Promise<void>;
}

export interface P9RuntimeOptions {
  includeOps?: boolean;
}

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
  const pairing = new PairingService({ client, repositories, pepper: config.pairingPepper, ttlSeconds: config.pairingTtlSeconds });
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
  return {
    router: createP9Router({ auth, sessions, users, devices, pairing, settings, recovery, profile, avatars, personalization, accessTokens, repositories, config, includeOps: options.includeOps ?? false }),
    mediaRouter: createAvatarMediaRouter(avatarStorage),
    initialize: () => avatarStorage.initialize(),
    reconcileAvatars: () => avatars.reconcile(),
    resolveDeviceBinding: (hardwareId, deviceToken) => deviceBinding.resolve(hardwareId, deviceToken),
    authorizeDeviceBinding: (binding) => deviceBinding.isActive(binding),
    authenticateMobileSocket: (accessToken) =>
      authenticateMobileAccessToken(accessTokens, sessions, accessToken),
    checkReadiness: () => checkP9Readiness(repositories),
    close: async () => {
      await avatarStorage.close();
      await disconnectP9Client(client);
    },
  };
}
