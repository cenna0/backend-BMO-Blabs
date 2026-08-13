import { Router } from "express";
import { z } from "zod";

import { P9Error } from "../errors.js";
import { wifiPutSchema } from "../device-additions.validation.js";
import type { DeviceAdditionsService } from "../services/device-additions.service.js";
import type { AccessTokenService, SessionService } from "../services/session.service.js";
import { asyncP9, currentAuth, requireAuth } from "./middleware.js";

const uuid = z.string().uuid();
function deviceId(value: unknown): string {
  const parsed = uuid.safeParse(value);
  if (!parsed.success) throw new P9Error("OWNERSHIP_DENIED", 404, "Device not found");
  return parsed.data;
}

export function createDeviceAdditionsRouter(additions: DeviceAdditionsService, accessTokens: AccessTokenService, sessions: SessionService): Router {
  const router = Router();
  const authenticated = requireAuth(accessTokens, sessions);
  router.get("/devices/:deviceId/wifi", authenticated, asyncP9(async (request, response) => {
    const auth = currentAuth(request); response.json({ wifi: await additions.getWifi(auth.userId, deviceId(request.params.deviceId)) });
  }));
  router.put("/devices/:deviceId/wifi", authenticated, asyncP9(async (request, response) => {
    const auth = currentAuth(request); response.status(202).json({ wifi: await additions.putWifi(auth.userId, deviceId(request.params.deviceId), wifiPutSchema.parse(request.body), auth.context.requestId) });
  }));
  router.delete("/devices/:deviceId/wifi", authenticated, asyncP9(async (request, response) => {
    const auth = currentAuth(request); await additions.deleteWifi(auth.userId, deviceId(request.params.deviceId), auth.context.requestId); response.status(204).send();
  }));
  router.get("/devices/:deviceId/logs", authenticated, asyncP9(async (request, response) => {
    const auth = currentAuth(request); const limit = z.coerce.number().int().min(1).max(100).default(50).parse(request.query.limit); response.json({ logs: await additions.listLogs(auth.userId, deviceId(request.params.deviceId), limit) });
  }));
  router.get("/devices/:deviceId/telemetry", authenticated, asyncP9(async (request, response) => {
    const auth = currentAuth(request); response.json({ telemetry: await additions.getTelemetry(auth.userId, deviceId(request.params.deviceId)) });
  }));
  return router;
}
