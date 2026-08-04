import { Router } from "express";

import { DeviceService } from "../services/device.service.js";
import { SettingsService } from "../services/settings.service.js";
import { asyncP9, currentAuth, requireAuth } from "./middleware.js";
import type { AccessTokenService, SessionService } from "../services/session.service.js";

export function createDeviceRouter(devices: DeviceService, settings: SettingsService, accessTokens: AccessTokenService, sessions: SessionService): Router {
  const router = Router();
  const authenticated = requireAuth(accessTokens, sessions);
  router.get("/devices", authenticated, asyncP9(async (request, response) => {
    const auth = currentAuth(request);
    response.json({ devices: await devices.list(auth.userId) });
  }));
  router.get("/devices/:deviceId", authenticated, asyncP9(async (request, response) => {
    const auth = currentAuth(request);
    response.json({ device: await devices.get(auth.userId, String(request.params.deviceId ?? "")) });
  }));
  router.patch("/devices/:deviceId/settings", authenticated, asyncP9(async (request, response) => {
    const auth = currentAuth(request);
    response.json({ settings: await settings.updateDeviceSettings(auth.userId, String(request.params.deviceId ?? ""), request.body, auth.context.requestId) });
  }));
  router.post("/devices/:deviceId/unpair", authenticated, asyncP9(async (request, response) => {
    const auth = currentAuth(request);
    await devices.unpair(auth.userId, String(request.params.deviceId ?? ""), auth.context.requestId);
    response.status(204).send();
  }));
  return router;
}
