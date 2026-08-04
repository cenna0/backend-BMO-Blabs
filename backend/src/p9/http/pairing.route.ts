import { Router } from "express";
import { rateLimit } from "express-rate-limit";

import { PairingService } from "../services/pairing.service.js";
import { asyncP9, currentAuth, requireAuth, requestContext } from "./middleware.js";
import type { AccessTokenService, SessionService } from "../services/session.service.js";
import type { P9Config } from "../config.js";

export function createPairingRouter(pairing: PairingService, accessTokens: AccessTokenService, sessions: SessionService, config: P9Config): Router {
  const router = Router();
  const authenticated = requireAuth(accessTokens, sessions);
  const pairingLimiter = rateLimit({
    windowMs: config.pairingWindowMs,
    limit: config.pairingLimit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: (_request, response) => response.status(429).json({ error: "RATE_LIMITED" }),
  });

  router.post("/pairing/challenges", pairingLimiter, authenticated, asyncP9(async (request, response) => {
    const auth = currentAuth(request);
    const result = await pairing.issue(auth.userId, auth.context.requestId);
    response.status(201).json({ pairingId: result.id, code: result.code, expiresAt: result.expiresAt.toISOString() });
  }));

  router.get("/pairing/:pairingId", authenticated, asyncP9(async (request, response) => {
    const auth = currentAuth(request);
    response.json({ pairing: await pairing.status(auth.userId, String(request.params.pairingId ?? "")) });
  }));

  router.post("/pairing/:pairingId/claim", pairingLimiter, authenticated, asyncP9(async (request, response) => {
    const auth = currentAuth(request);
    const context = requestContext(request, response);
    const device = await pairing.claim(auth.userId, { pairingId: String(request.params.pairingId ?? ""), ...request.body }, context.requestId);
    response.status(201).json({ device });
  }));

  router.post("/pairing/:pairingId/revoke", authenticated, asyncP9(async (request, response) => {
    const auth = currentAuth(request);
    await pairing.revoke(auth.userId, String(request.params.pairingId ?? ""), auth.context.requestId);
    response.status(204).send();
  }));
  return router;
}
