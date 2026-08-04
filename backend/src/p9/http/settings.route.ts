import { Router } from "express";

import { SettingsService } from "../services/settings.service.js";
import { asyncP9, currentAuth, requireAuth } from "./middleware.js";
import type { AccessTokenService, SessionService } from "../services/session.service.js";

export function createSettingsRouter(settings: SettingsService, accessTokens: AccessTokenService, sessions: SessionService): Router {
  const router = Router();
  const authenticated = requireAuth(accessTokens, sessions);
  router.get("/settings/user", authenticated, asyncP9(async (request, response) => {
    const auth = currentAuth(request);
    response.json({ settings: await settings.getUserSettings(auth.userId) });
  }));
  router.patch("/settings/user", authenticated, asyncP9(async (request, response) => {
    const auth = currentAuth(request);
    response.json({ settings: await settings.updateUserSettings(auth.userId, request.body, auth.context.requestId) });
  }));
  router.get("/settings/devices/:deviceId", authenticated, asyncP9(async (request, response) => {
    const auth = currentAuth(request);
    response.json({ settings: await settings.getDeviceSettings(auth.userId, String(request.params.deviceId ?? "")) });
  }));
  router.patch("/settings/devices/:deviceId", authenticated, asyncP9(async (request, response) => {
    const auth = currentAuth(request);
    response.json({ settings: await settings.updateDeviceSettings(auth.userId, String(request.params.deviceId ?? ""), request.body, auth.context.requestId) });
  }));
  return router;
}
