import { Router } from "express";
import { z } from "zod";

import { P9Error } from "../errors.js";
import type { ChatService } from "../services/chat.service.js";
import type { AccessTokenService, SessionService } from "../services/session.service.js";
import { asyncP9, currentAuth, requireAuth } from "./middleware.js";

const uuid = z.string().uuid();
const createSessionSchema = z.object({ temporary: z.boolean().default(false) }).strict();
const sendMessageSchema = z.object({
  idempotencyKey: uuid,
  text: z.string().trim().min(1).max(16_384),
  speakOnDevice: z.boolean().default(false),
  deviceId: uuid.optional(),
}).strict();
const feedbackSchema = z.object({
  rating: z.enum(["positive", "negative"]),
  reason: z.string().trim().min(1).max(500).optional(),
}).strict();
const querySchema = z.object({
  cursor: z.string().regex(/^[1-9]\d*$/u)
    .refine((value) => BigInt(value) <= 9_223_372_036_854_775_807n)
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
}).strict();

function ownedUuid(value: unknown, resource: string): string {
  const parsed = uuid.safeParse(value);
  if (!parsed.success) throw new P9Error("OWNERSHIP_DENIED", 404, `${resource} not found`);
  return parsed.data;
}

export function createChatRouter(
  chat: ChatService,
  accessTokens: AccessTokenService,
  sessions: SessionService,
): Router {
  const router = Router();
  const authenticated = requireAuth(accessTokens, sessions);

  router.get("/chat/sessions", authenticated, asyncP9(async (request, response) => {
    const auth = currentAuth(request);
    response.json(await chat.listSessions(auth.userId));
  }));
  router.post("/chat/sessions", authenticated, asyncP9(async (request, response) => {
    const auth = currentAuth(request);
    const input = createSessionSchema.parse(request.body);
    response.status(201).json({ session: await chat.createSession(auth.userId, input, auth.context.requestId) });
  }));
  router.get("/chat/sessions/:sessionId/messages", authenticated, asyncP9(async (request, response) => {
    const auth = currentAuth(request);
    const sessionId = ownedUuid(request.params.sessionId, "Chat session");
    const query = querySchema.parse(request.query);
    response.json(await chat.listMessages(auth.userId, sessionId, {
      limit: query.limit,
      ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
    }));
  }));
  router.post("/chat/sessions/:sessionId/messages", authenticated, asyncP9(async (request, response) => {
    const auth = currentAuth(request);
    const sessionId = ownedUuid(request.params.sessionId, "Chat session");
    const input = sendMessageSchema.parse(request.body);
    response.status(202).json(await chat.submitMessage(auth.userId, sessionId, {
      idempotencyKey: input.idempotencyKey,
      text: input.text,
      speakOnDevice: input.speakOnDevice,
      ...(input.deviceId === undefined ? {} : { deviceId: input.deviceId }),
    }, auth.context.requestId));
  }));
  router.delete("/chat/sessions/:sessionId", authenticated, asyncP9(async (request, response) => {
    const auth = currentAuth(request);
    await chat.deleteSession(auth.userId, ownedUuid(request.params.sessionId, "Chat session"), auth.context.requestId);
    response.status(204).send();
  }));
  router.post("/chat/messages/:messageId/feedback", authenticated, asyncP9(async (request, response) => {
    const auth = currentAuth(request);
    const input = feedbackSchema.parse(request.body);
    response.json({ feedback: await chat.setFeedback(
      auth.userId,
      ownedUuid(request.params.messageId, "Chat message"),
      { rating: input.rating, ...(input.reason === undefined ? {} : { reason: input.reason }) },
      auth.context.requestId,
    ) });
  }));
  return router;
}
