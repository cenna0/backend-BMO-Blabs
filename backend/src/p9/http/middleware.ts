import { randomUUID } from "node:crypto";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { ZodError } from "zod";

import { P9Error, isP9Error } from "../errors.js";
import { AccessTokenService, SessionService } from "../services/session.service.js";
import type { RequestContext } from "../types.js";

declare global {
  namespace Express {
    interface Request {
      p9Auth?: { userId: string; sessionId: string };
      p9Context?: RequestContext;
    }
  }
}

export function requestContext(request: Request, response: Response): RequestContext {
  const candidate = request.get("X-Request-Id");
  const requestId = candidate && /^[A-Za-z0-9._:-]{1,128}$/.test(candidate) ? candidate : randomUUID();
  response.setHeader("X-Request-Id", requestId);
  const context = { requestId };
  request.p9Context = context;
  return context;
}

export function requireAuth(accessTokens: AccessTokenService, sessions: SessionService): RequestHandler {
  return async (request, response, next) => {
    try {
      const authorization = request.get("Authorization");
      if (!authorization?.startsWith("Bearer ")) throw new Error("missing bearer");
      const payload = await accessTokens.verify(authorization.slice("Bearer ".length));
      const active = await sessions.isActive(payload.sub, payload.sid);
      if (!active) throw new Error("revoked session");
      request.p9Auth = { userId: payload.sub, sessionId: payload.sid };
      if (!request.p9Context) requestContext(request, response);
      const context = request.p9Context;
      if (!context) throw new Error("request context unavailable");
      request.p9Context = { requestId: context.requestId, userId: payload.sub, sessionId: payload.sid };
      next();
    } catch {
      response.status(401).json({ error: "AUTHENTICATION_FAILED" });
    }
  };
}

export function currentAuth(request: Request): { userId: string; sessionId: string; context: RequestContext } {
  if (!request.p9Auth || !request.p9Context) throw new P9Error("AUTHENTICATION_FAILED", 401, "Authentication failed");
  return { ...request.p9Auth, context: request.p9Context };
}

export function sendP9Error(response: Response, error: unknown): void {
  if (error instanceof ZodError) {
    response.status(400).json({ error: "INVALID_INPUT" });
    return;
  }
  if (isP9Error(error)) {
    response.status(error.status).json({ error: error.code, message: error.publicMessage });
    return;
  }
  response.status(500).json({ error: "INTERNAL_ERROR" });
}

export function asyncP9(handler: (request: Request, response: Response, next: NextFunction) => Promise<void>): RequestHandler {
  return (request, response, next) => {
    void handler(request, response, next).catch(next);
  };
}

export function p9ErrorHandler(error: unknown, _request: Request, response: Response, _next: NextFunction): void {
  sendP9Error(response, error);
}
