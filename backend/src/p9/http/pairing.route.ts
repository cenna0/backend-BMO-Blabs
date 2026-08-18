import { Router } from "express";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";

import { HardwareEnrollmentService } from "../services/hardware-enrollment.service.js";
import { parsePairingClaim } from "../validation.js";
import { asyncP9, currentAuth, requireAuth, requestContext } from "./middleware.js";
import type { AccessTokenService, SessionService } from "../services/session.service.js";
import type { P9Config } from "../config.js";

export function createPairingRouter(pairing: HardwareEnrollmentService, accessTokens: AccessTokenService, sessions: SessionService, config: P9Config): Router {
  const router = Router();
  const authenticated = requireAuth(accessTokens, sessions);
  const userLimiter = rateLimit({
    windowMs: config.pairingWindowMs,
    limit: config.pairingLimit,
    keyGenerator: (request) => request.p9Auth?.userId ?? ipKeyGenerator(request.ip ?? "unknown-user"),
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: (_request, response) => response.status(429).json({ error: "RATE_LIMITED" }),
  });
  const sessionLimiter = rateLimit({
    windowMs: config.pairingWindowMs,
    limit: config.pairingLimit,
    keyGenerator: (request) => request.p9Auth?.sessionId ?? ipKeyGenerator(request.ip ?? "unknown-session"),
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: (_request, response) => response.status(429).json({ error: "RATE_LIMITED" }),
  });
  const ipLimiter = rateLimit({
    windowMs: config.pairingWindowMs,
    limit: config.pairingLimit * 2,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: (_request, response) => response.status(429).json({ error: "RATE_LIMITED" }),
  });

  router.post("/pairing/claim", authenticated, userLimiter, sessionLimiter, ipLimiter, asyncP9(async (request, response) => {
    const auth = currentAuth(request);
    const context = requestContext(request, response);
    const device = await pairing.claim(auth.userId, parsePairingClaim(request.body), context.requestId);
    response.status(201).json({ device });
  }));
  return router;
}
