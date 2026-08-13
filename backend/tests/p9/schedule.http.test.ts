import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { createScheduleRouter } from "../../src/p9/http/schedule.route.js";
import { p9ErrorHandler } from "../../src/p9/http/middleware.js";

const id = "00000000-0000-4000-8000-000000000010";

function fixture() {
  const accessTokens = { verify: vi.fn().mockResolvedValue({ sub: "owner", sid: "session" }) };
  const sessions = { isActive: vi.fn().mockResolvedValue(true) };
  const schedule = {
    list: vi.fn().mockResolvedValue({ schedules: [], nextCursor: null }), create: vi.fn().mockResolvedValue({ id }),
    get: vi.fn().mockResolvedValue({ id }), update: vi.fn().mockResolvedValue({ id }), pause: vi.fn().mockResolvedValue({ id }),
    resume: vi.fn().mockResolvedValue({ id }), cancel: vi.fn().mockResolvedValue(undefined),
    listRuns: vi.fn().mockResolvedValue({ runs: [], nextCursor: null }),
  };
  const app = express(); app.use(express.json());
  app.use(createScheduleRouter(schedule as any, accessTokens as any, sessions as any)); app.use(p9ErrorHandler);
  return { app, schedule };
}

const auth = (operation: request.Test) => operation.set("Authorization", "Bearer access");

describe("schedule HTTP contract", () => {
  it("registers all owner-scoped routes with deterministic pagination", async () => {
    const f = fixture();
    expect((await auth(request(f.app).get("/schedules?limit=25&cursor=2026-08-13T00%3A00%3A00.000Z%7C00000000-0000-4000-8000-000000000010"))).status).toBe(200);
    expect(f.schedule.list).toHaveBeenCalledWith("owner", { limit: 25, cursor: "2026-08-13T00:00:00.000Z|00000000-0000-4000-8000-000000000010" });
    const created = await auth(request(f.app).post("/schedules")).set("X-Request-Id", "schedule-request").send({
      prompt: "Stand up", frequency: "Daily", every: 1, timeOfDay: "Morning", deliveryTargets: ["MOBILE"],
    });
    expect(created.status).toBe(201);
    expect(f.schedule.create).toHaveBeenCalledWith("owner", expect.objectContaining({ frequency: "Daily" }), "schedule-request");
    expect((await auth(request(f.app).get(`/schedules/${id}`))).status).toBe(200);
    expect((await auth(request(f.app).patch(`/schedules/${id}`)).send({ version: 1, prompt: "Move" })).status).toBe(200);
    expect((await auth(request(f.app).post(`/schedules/${id}/pause`)).send({ version: 2 })).status).toBe(200);
    expect((await auth(request(f.app).post(`/schedules/${id}/resume`)).send({ version: 3 })).status).toBe(200);
    expect((await auth(request(f.app).delete(`/schedules/${id}`)).send({ version: 4 })).status).toBe(204);
    expect((await auth(request(f.app).get(`/schedule-runs?scheduleId=${id}&limit=10`))).status).toBe(200);
    expect(f.schedule.listRuns).toHaveBeenCalledWith("owner", { limit: 10, scheduleId: id });
  });

  it("rejects unauthenticated, malformed, unbounded, and owner-injected input", async () => {
    const f = fixture();
    expect((await request(f.app).get("/schedules")).status).toBe(401);
    expect((await auth(request(f.app).get("/schedules?limit=101"))).status).toBe(400);
    expect((await auth(request(f.app).get("/schedules/not-a-uuid"))).status).toBe(404);
    expect((await auth(request(f.app).post("/schedules")).send({ prompt: "x", frequency: "Daily", every: 1, timeOfDay: "Morning", deliveryTargets: ["MOBILE"], userId: "attacker" })).status).toBe(400);
    expect((await auth(request(f.app).post(`/schedules/${id}/pause`)).send({ version: 1, extra: true })).status).toBe(400);
  });
});
