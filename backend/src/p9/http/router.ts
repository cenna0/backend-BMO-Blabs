import express, { Router } from "express";
import multer from "multer";

import type { P9Config } from "../config.js";
import type { P9Repositories } from "../db/repositories.js";
import { AuthService } from "../services/auth.service.js";
import { DeviceService } from "../services/device.service.js";
import { HardwareEnrollmentService } from "../services/hardware-enrollment.service.js";
import { SessionService, AccessTokenService } from "../services/session.service.js";
import { SettingsService } from "../services/settings.service.js";
import { UserService } from "../services/user.service.js";
import { RecoveryService } from "../services/recovery.service.js";
import { ProfileService } from "../services/profile.service.js";
import { AvatarService } from "../services/avatar.service.js";
import { PersonalizationService } from "../services/personalization.service.js";
import { ChatService } from "../services/chat.service.js";
import { MemoryService } from "../services/memory.service.js";
import { ScheduleService } from "../services/schedule.service.js";
import { createAuthRouter } from "./auth.route.js";
import { createDeviceRouter } from "./device.route.js";
import { ensureRequestContext, p9ErrorHandler } from "./middleware.js";
import { createOpsRouter } from "./ops.route.js";
import { createPairingRouter } from "./pairing.route.js";
import { createSettingsRouter } from "./settings.route.js";
import { createProfileRouter } from "./profile.route.js";
import { createPersonalizationRouter } from "./personalization.route.js";
import { createChatRouter } from "./chat.route.js";
import { createMemoryRouter } from "./memory.route.js";
import { createScheduleRouter } from "./schedule.route.js";
import { createIntegrationRouter, createSupportRouter } from "./integration.route.js";
import type { IntegrationService } from "../services/integration.service.js";
import type { BugReportService } from "../services/bug-report.service.js";
import { createDeviceAdditionsRouter } from "./device-additions.route.js";
import type { DeviceAdditionsService } from "../services/device-additions.service.js";

export interface P9RouterServices {
  auth: AuthService;
  sessions: SessionService;
  users: UserService;
  devices: DeviceService;
  pairing: HardwareEnrollmentService;
  settings: SettingsService;
  accessTokens: AccessTokenService;
  repositories: P9Repositories;
  config: P9Config;
  recovery: RecoveryService;
  profile: ProfileService;
  avatars: AvatarService;
  personalization: PersonalizationService;
  chat: ChatService;
  memory: MemoryService;
  schedule: ScheduleService;
  integrations: IntegrationService;
  bugReports: BugReportService;
  deviceAdditions: DeviceAdditionsService;
  includeOps?: boolean;
}

export function createP9Router(services: P9RouterServices): Router {
  const router = Router();
  router.use(ensureRequestContext);
  router.use(express.json({ limit: "32kb", strict: true }));
  router.use(createAuthRouter({
    config: services.config,
    auth: services.auth,
    recovery: services.recovery,
    sessions: services.sessions,
    users: services.users,
    accessTokens: services.accessTokens,
  }));
  router.use(createPairingRouter(services.pairing, services.accessTokens, services.sessions, services.config));
  router.use(createDeviceRouter(services.devices, services.settings, services.accessTokens, services.sessions));
  router.use(createDeviceAdditionsRouter(services.deviceAdditions, services.accessTokens, services.sessions));
  router.use(createSettingsRouter(services.settings, services.accessTokens, services.sessions));
  router.use(createProfileRouter(
    services.profile,
    services.avatars,
    services.accessTokens,
    services.sessions,
    services.config.avatarMaxBytes,
    {
      windowMs: services.config.avatarUploadWindowMs,
      userLimit: services.config.avatarUploadUserLimit,
      ipLimit: services.config.avatarUploadIpLimit,
      receiveTimeoutMs: services.config.avatarUploadReceiveTimeoutMs,
    },
  ));
  router.use(createPersonalizationRouter(services.personalization, services.accessTokens, services.sessions));
  router.use(createChatRouter(services.chat, services.accessTokens, services.sessions));
  router.use(createMemoryRouter(services.memory, services.accessTokens, services.sessions));
  router.use(createScheduleRouter(services.schedule, services.accessTokens, services.sessions));
  router.use(createIntegrationRouter(services.integrations, services.accessTokens, services.sessions));
  const bugUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 5, fields: 10 } }).array("screenshots", 5);
  router.use(createSupportRouter(services.bugReports, services.accessTokens, services.sessions, bugUpload));
  if (services.includeOps === true) router.use(createOpsRouter(services.repositories));
  router.use(p9ErrorHandler);
  return router;
}
