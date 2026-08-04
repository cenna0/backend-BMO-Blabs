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
import { createP9Router } from "./http/router.js";
import type { Router } from "express";

export interface P9Runtime {
  router: Router;
  close(): Promise<void>;
}

export interface P9RuntimeOptions {
  includeOps?: boolean;
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
  const auth = new AuthService({ client, repositories, invitations, sessions });
  const users = new UserService(repositories);
  const devices = new DeviceService(client, repositories);
  const pairing = new PairingService({ client, repositories, pepper: config.pairingPepper, ttlSeconds: config.pairingTtlSeconds });
  const settings = new SettingsService(client, repositories);
  return {
    router: createP9Router({ auth, sessions, users, devices, pairing, settings, accessTokens, repositories, config, includeOps: options.includeOps ?? false }),
    close: () => disconnectP9Client(client),
  };
}
