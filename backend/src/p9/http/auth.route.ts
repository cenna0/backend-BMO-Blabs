import { Router } from "express";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";

import { sha256Hex } from "../crypto.js";
import type { P9Config } from "../config.js";
import { AuthService } from "../services/auth.service.js";
import { AccessTokenService, SessionService } from "../services/session.service.js";
import { UserService } from "../services/user.service.js";
import { normalizeEmail } from "../validation.js";
import { asyncP9, currentAuth, requireAuth, requestContext } from "./middleware.js";

interface AuthRouteOptions {
  config: P9Config;
  auth: AuthService;
  sessions: SessionService;
  users: UserService;
  accessTokens: AccessTokenService;
}

function sessionResponse(session: Awaited<ReturnType<SessionService["issueSession"]>>) {
  return {
    sessionId: session.sessionId,
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
    accessTokenExpiresAt: session.accessTokenExpiresAt.toISOString(),
    refreshTokenExpiresAt: session.refreshTokenExpiresAt.toISOString(),
  };
}

export function createAuthRouter(options: AuthRouteOptions): Router {
  const router = Router();
  const authLimiter = rateLimit({
    windowMs: options.config.loginWindowMs,
    limit: options.config.loginLimit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    keyGenerator: (request) => {
      const rawEmail = typeof request.body?.email === "string" ? request.body.email : "";
      let email = rawEmail;
      try {
        email = normalizeEmail(rawEmail);
      } catch {
        email = rawEmail.trim().normalize("NFKC").toLowerCase();
      }
      return sha256Hex(`${ipKeyGenerator(request.ip ?? "0.0.0.0")}:${request.path}:${email}`);
    },
    handler: (_request, response) => response.status(429).json({ error: "RATE_LIMITED" }),
  });
  const refreshLimiter = rateLimit({ windowMs: options.config.loginWindowMs, limit: 20, standardHeaders: "draft-8", legacyHeaders: false });

  router.post("/auth/register", authLimiter, asyncP9(async (request, response) => {
    const context = requestContext(request, response);
    const result = await options.auth.register(request.body, context.requestId);
    response.status(201).json({ user: result.user, session: sessionResponse(result.session) });
  }));

  router.post("/auth/login", authLimiter, asyncP9(async (request, response) => {
    const context = requestContext(request, response);
    const result = await options.auth.login(request.body, context.requestId);
    response.status(200).json({ user: result.user, session: sessionResponse(result.session) });
  }));

  router.post("/auth/refresh", refreshLimiter, asyncP9(async (request, response) => {
    const context = requestContext(request, response);
    const result = await options.sessions.refresh(String(request.body?.refreshToken ?? ""), context.requestId);
    response.status(200).json({ session: sessionResponse(result) });
  }));

  const authenticated = requireAuth(options.accessTokens, options.sessions);
  router.post("/auth/logout", authenticated, asyncP9(async (request, response) => {
    const auth = currentAuth(request);
    await options.sessions.revokeCurrent(auth.userId, auth.sessionId, "logout", auth.context.requestId);
    response.status(204).send();
  }));

  router.post("/auth/logout-all", authenticated, asyncP9(async (request, response) => {
    const auth = currentAuth(request);
    await options.sessions.revokeAll(auth.userId, "logout_all", auth.context.requestId);
    response.status(204).send();
  }));

  router.get("/me", authenticated, asyncP9(async (request, response) => {
    const auth = currentAuth(request);
    const user = await options.users.getById(auth.userId);
    if (!user) {
      response.status(404).json({ error: "AUTHENTICATION_FAILED" });
      return;
    }
    response.json({ user });
  }));
  return router;
}
