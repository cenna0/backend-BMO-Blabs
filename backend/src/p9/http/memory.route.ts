import { Router } from "express";

import { P9Error } from "../errors.js";
import {
  parseAcceptCandidate, parseCandidateList, parseForgetTopic, parseMemoryAction,
  parseDeleteMemoryAction, parseMemoryList, parseMemoryPatch, parseMemorySettingsPatch, parseSummaryFeedback,
} from "../memory.validation.js";
import type { AccessTokenService, SessionService } from "../services/session.service.js";
import { isUuid } from "../validation.js";
import { asyncP9, currentAuth, requireAuth } from "./middleware.js";

function ownedId(value: unknown, resource: string): string {
  if (typeof value !== "string" || !isUuid(value)) throw new P9Error("OWNERSHIP_DENIED", 404, `${resource} not found`);
  return value;
}

interface MemoryService {
  getSettings(userId: string): Promise<unknown>;
  updateSettings(userId: string, input: unknown, requestId?: string): Promise<unknown>;
  list(userId: string, input: unknown): Promise<unknown>;
  get(userId: string, id: string): Promise<unknown>;
  update(userId: string, id: string, input: unknown, requestId?: string): Promise<unknown>;
  delete(userId: string, id: string, idempotencyKey: string, requestId?: string): Promise<void>;
  listCandidates(userId: string, input: unknown): Promise<unknown>;
  acceptCandidate(userId: string, id: string, input: unknown, requestId?: string): Promise<unknown>;
  rejectCandidate(userId: string, id: string, input: unknown, requestId?: string): Promise<unknown>;
  forgetTopic(userId: string, input: unknown, requestId?: string): Promise<unknown>;
  clearAll(userId: string, input: unknown, requestId?: string): Promise<unknown>;
  export(userId: string, input: unknown, requestId?: string): Promise<unknown>;
  getSummary(userId: string): Promise<unknown>;
  regenerateSummary(userId: string, input: unknown, requestId?: string): Promise<unknown>;
  setSummaryFeedback(userId: string, input: unknown, requestId?: string): Promise<unknown>;
}

export function createMemoryRouter(memory: MemoryService, accessTokens: AccessTokenService, sessions: SessionService): Router {
  const router = Router();
  const authenticated = requireAuth(accessTokens, sessions);

  router.get("/settings/memory", authenticated, asyncP9(async (request, response) => {
    response.json(await memory.getSettings(currentAuth(request).userId));
  }));
  router.patch("/settings/memory", authenticated, asyncP9(async (request, response) => {
    const auth = currentAuth(request);
    response.json(await memory.updateSettings(auth.userId, parseMemorySettingsPatch(request.body), auth.context.requestId));
  }));
  router.get("/memories", authenticated, asyncP9(async (request, response) => {
    response.json(await memory.list(currentAuth(request).userId, parseMemoryList(request.query)));
  }));
  router.get("/memories/:id", authenticated, asyncP9(async (request, response) => {
    response.json(await memory.get(currentAuth(request).userId, ownedId(request.params.id!, "Memory")));
  }));
  router.patch("/memories/:id", authenticated, asyncP9(async (request, response) => {
    const auth = currentAuth(request);
    response.json(await memory.update(auth.userId, ownedId(request.params.id!, "Memory"), parseMemoryPatch(request.body), auth.context.requestId));
  }));
  router.delete("/memories/:id", authenticated, asyncP9(async (request, response) => {
    const auth = currentAuth(request);
    const input = parseDeleteMemoryAction(request.body, request.get("Idempotency-Key"));
    await memory.delete(auth.userId, ownedId(request.params.id!, "Memory"), input.idempotencyKey, auth.context.requestId);
    response.status(204).end();
  }));
  router.get("/memory-candidates", authenticated, asyncP9(async (request, response) => {
    response.json(await memory.listCandidates(currentAuth(request).userId, parseCandidateList(request.query)));
  }));
  router.post("/memory-candidates/:id/accept", authenticated, asyncP9(async (request, response) => {
    const auth = currentAuth(request);
    response.json(await memory.acceptCandidate(auth.userId, ownedId(request.params.id!, "Memory candidate"), parseAcceptCandidate(request.body), auth.context.requestId));
  }));
  router.post("/memory-candidates/:id/reject", authenticated, asyncP9(async (request, response) => {
    const auth = currentAuth(request);
    response.json(await memory.rejectCandidate(auth.userId, ownedId(request.params.id!, "Memory candidate"), parseMemoryAction(request.body), auth.context.requestId));
  }));
  router.post("/memories/forget-topic", authenticated, asyncP9(async (request, response) => {
    const auth = currentAuth(request);
    response.json(await memory.forgetTopic(auth.userId, parseForgetTopic(request.body), auth.context.requestId));
  }));
  router.post("/memories/clear-all", authenticated, asyncP9(async (request, response) => {
    const auth = currentAuth(request);
    response.json(await memory.clearAll(auth.userId, parseMemoryAction(request.body), auth.context.requestId));
  }));
  router.post("/memories/export", authenticated, asyncP9(async (request, response) => {
    const auth = currentAuth(request);
    response.json(await memory.export(auth.userId, parseMemoryAction(request.body), auth.context.requestId));
  }));
  router.get("/memory/summary", authenticated, asyncP9(async (request, response) => {
    response.json(await memory.getSummary(currentAuth(request).userId));
  }));
  router.post("/memory/summary/regenerate", authenticated, asyncP9(async (request, response) => {
    const auth = currentAuth(request);
    response.status(202).json(await memory.regenerateSummary(auth.userId, parseMemoryAction(request.body), auth.context.requestId));
  }));
  router.post("/memory/summary/feedback", authenticated, asyncP9(async (request, response) => {
    const auth = currentAuth(request);
    response.json(await memory.setSummaryFeedback(auth.userId, parseSummaryFeedback(request.body), auth.context.requestId));
  }));
  return router;
}
