import { Router } from "express";

import type { PersonalizationService } from "../services/personalization.service.js";
import type { AccessTokenService, SessionService } from "../services/session.service.js";
import { asyncP9, currentAuth, requireAuth } from "./middleware.js";

export function createPersonalizationRouter(
  personalization: PersonalizationService,
  accessTokens: AccessTokenService,
  sessions: SessionService,
): Router {
  const router = Router();
  const authenticated = requireAuth(accessTokens, sessions);
  router.get("/settings/personalization", authenticated, asyncP9(async (request, response) => {
    const auth = currentAuth(request);
    response.json({ settings: await personalization.get(auth.userId) });
  }));
  router.patch("/settings/personalization", authenticated, asyncP9(async (request, response) => {
    const auth = currentAuth(request);
    response.json({ settings: await personalization.update(auth.userId, request.body, auth.context.requestId) });
  }));
  return router;
}
