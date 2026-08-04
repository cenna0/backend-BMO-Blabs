import express, { Router } from "express";

import type { P9Config } from "../config.js";
import type { P9Repositories } from "../db/repositories.js";
import { AuthService } from "../services/auth.service.js";
import { DeviceService } from "../services/device.service.js";
import { PairingService } from "../services/pairing.service.js";
import { SessionService, AccessTokenService } from "../services/session.service.js";
import { SettingsService } from "../services/settings.service.js";
import { UserService } from "../services/user.service.js";
import { createAuthRouter } from "./auth.route.js";
import { createDeviceRouter } from "./device.route.js";
import { p9ErrorHandler } from "./middleware.js";
import { createOpsRouter } from "./ops.route.js";
import { createPairingRouter } from "./pairing.route.js";
import { createSettingsRouter } from "./settings.route.js";

export interface P9RouterServices {
  auth: AuthService;
  sessions: SessionService;
  users: UserService;
  devices: DeviceService;
  pairing: PairingService;
  settings: SettingsService;
  accessTokens: AccessTokenService;
  repositories: P9Repositories;
  config: P9Config;
  includeOps?: boolean;
}

export function createP9Router(services: P9RouterServices): Router {
  const router = Router();
  router.use(express.json({ limit: "32kb", strict: true }));
  router.use(createAuthRouter({ config: services.config, auth: services.auth, sessions: services.sessions, users: services.users, accessTokens: services.accessTokens }));
  router.use(createPairingRouter(services.pairing, services.accessTokens, services.sessions, services.config));
  router.use(createDeviceRouter(services.devices, services.settings, services.accessTokens, services.sessions));
  router.use(createSettingsRouter(services.settings, services.accessTokens, services.sessions));
  if (services.includeOps === true) router.use(createOpsRouter(services.repositories));
  router.use(p9ErrorHandler);
  return router;
}
