import { Router } from "express";
import { z } from "zod";

import { P9Error } from "../errors.js";
import { parseCreateSchedule, parseSchedulePatch, scheduleVersionSchema, type CreateScheduleInput, type SchedulePatchInput } from "../schedule.validation.js";
import type { AccessTokenService, SessionService } from "../services/session.service.js";
import { asyncP9, currentAuth, requireAuth } from "./middleware.js";

const uuid = z.string().uuid();
const cursor = z.string().max(128).regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\|[0-9a-f-]{36}$/u);
const listQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50), cursor: cursor.optional() }).strict();
const runQuery = listQuery.extend({ scheduleId: uuid.optional() }).strict();

function ownedId(value: unknown): string {
  const parsed = uuid.safeParse(value);
  if (!parsed.success) throw new P9Error("OWNERSHIP_DENIED", 404, "Schedule not found");
  return parsed.data;
}

export interface ScheduleHttpService {
  list(userId: string, query: { limit: number; cursor?: string }): Promise<unknown>;
  create(userId: string, input: CreateScheduleInput, requestId?: string): Promise<unknown>;
  get(userId: string, id: string): Promise<unknown>;
  update(userId: string, id: string, input: SchedulePatchInput, requestId?: string): Promise<unknown>;
  pause(userId: string, id: string, version: number, requestId?: string): Promise<unknown>;
  resume(userId: string, id: string, version: number, requestId?: string): Promise<unknown>;
  cancel(userId: string, id: string, version: number, requestId?: string): Promise<void>;
  listRuns(userId: string, query: { limit: number; cursor?: string; scheduleId?: string }): Promise<unknown>;
}

export function createScheduleRouter(schedule: ScheduleHttpService, accessTokens: AccessTokenService, sessions: SessionService): Router {
  const router = Router();
  const authenticated = requireAuth(accessTokens, sessions);
  router.get("/schedules", authenticated, asyncP9(async (request, response) => {
    const auth = currentAuth(request); const query = listQuery.parse(request.query); response.json(await schedule.list(auth.userId, { limit: query.limit, ...(query.cursor ? { cursor: query.cursor } : {}) }));
  }));
  router.post("/schedules", authenticated, asyncP9(async (request, response) => {
    const auth = currentAuth(request); response.status(201).json({ schedule: await schedule.create(auth.userId, parseCreateSchedule(request.body), auth.context.requestId) });
  }));
  router.get("/schedules/:id", authenticated, asyncP9(async (request, response) => {
    const auth = currentAuth(request); response.json({ schedule: await schedule.get(auth.userId, ownedId(request.params.id)) });
  }));
  router.patch("/schedules/:id", authenticated, asyncP9(async (request, response) => {
    const auth = currentAuth(request); response.json({ schedule: await schedule.update(auth.userId, ownedId(request.params.id), parseSchedulePatch(request.body), auth.context.requestId) });
  }));
  router.post("/schedules/:id/pause", authenticated, asyncP9(async (request, response) => {
    const auth = currentAuth(request); const input = scheduleVersionSchema.parse(request.body); response.json({ schedule: await schedule.pause(auth.userId, ownedId(request.params.id), input.version, auth.context.requestId) });
  }));
  router.post("/schedules/:id/resume", authenticated, asyncP9(async (request, response) => {
    const auth = currentAuth(request); const input = scheduleVersionSchema.parse(request.body); response.json({ schedule: await schedule.resume(auth.userId, ownedId(request.params.id), input.version, auth.context.requestId) });
  }));
  router.delete("/schedules/:id", authenticated, asyncP9(async (request, response) => {
    const auth = currentAuth(request); const input = scheduleVersionSchema.parse(request.body); await schedule.cancel(auth.userId, ownedId(request.params.id), input.version, auth.context.requestId); response.status(204).send();
  }));
  router.get("/schedule-runs", authenticated, asyncP9(async (request, response) => {
    const auth = currentAuth(request); const query = runQuery.parse(request.query); response.json(await schedule.listRuns(auth.userId, { limit: query.limit, ...(query.cursor ? { cursor: query.cursor } : {}), ...(query.scheduleId ? { scheduleId: query.scheduleId } : {}) }));
  }));
  return router;
}
