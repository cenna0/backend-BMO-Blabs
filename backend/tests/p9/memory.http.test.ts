import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { createMemoryRouter } from "../../src/p9/http/memory.route.js";
import { p9ErrorHandler } from "../../src/p9/http/middleware.js";

const id = "00000000-0000-4000-8000-000000000001";
const key = "00000000-0000-4000-8000-000000000002";

function fixture() {
  const accessTokens = { verify: vi.fn().mockResolvedValue({ sub: "bearer-owner", sid: "active-session" }) };
  const sessions = { isActive: vi.fn().mockResolvedValue(true) };
  const memory: any = {};
  for (const method of ["getSettings", "updateSettings", "list", "get", "update", "delete", "listCandidates", "acceptCandidate", "rejectCandidate", "forgetTopic", "clearAll", "export", "getSummary", "regenerateSummary", "setSummaryFeedback"]) {
    memory[method] = vi.fn().mockResolvedValue(method === "delete" ? undefined : {});
  }
  memory.list.mockResolvedValue({ memories: [], nextCursor: null });
  memory.listCandidates.mockResolvedValue({ candidates: [], nextCursor: null });
  const app = express();
  app.use(express.json());
  app.use(createMemoryRouter(memory, accessTokens as any, sessions as any));
  app.use(p9ErrorHandler);
  return { app, memory };
}

const auth = (value: request.Test) => value.set("Authorization", "Bearer access").set("X-Request-Id", "memory-request");

describe("memory HTTP contract", () => {
  it("registers all frozen owner-scoped reads", async () => {
    const f = fixture();
    expect((await auth(request(f.app).get("/settings/memory"))).status).toBe(200);
    expect((await auth(request(f.app).get("/memories?limit=25"))).status).toBe(200);
    expect((await auth(request(f.app).get(`/memories/${id}`))).status).toBe(200);
    expect((await auth(request(f.app).get("/memory-candidates?limit=10"))).status).toBe(200);
    expect((await auth(request(f.app).get("/memory/summary"))).status).toBe(200);
    expect(f.memory.list).toHaveBeenCalledWith("bearer-owner", { limit: 25 });
    expect(f.memory.get).toHaveBeenCalledWith("bearer-owner", id);
    expect(f.memory.listCandidates).toHaveBeenCalledWith("bearer-owner", { limit: 10 });
  });

  it("registers all frozen mutations with strict bodies and request IDs", async () => {
    const f = fixture();
    expect((await auth(request(f.app).patch("/settings/memory")).send({ automaticMemoryCandidates: false })).status).toBe(200);
    expect((await auth(request(f.app).patch(`/memories/${id}`)).send({ idempotencyKey: key, topic: "travel" })).status).toBe(200);
    expect((await auth(request(f.app).delete(`/memories/${id}`)).set("Idempotency-Key", key)).status).toBe(204);
    expect((await auth(request(f.app).post(`/memory-candidates/${id}/accept`)).send({ idempotencyKey: key })).status).toBe(200);
    expect((await auth(request(f.app).post(`/memory-candidates/${id}/reject`)).send({ idempotencyKey: key })).status).toBe(200);
    expect((await auth(request(f.app).post("/memories/forget-topic")).send({ idempotencyKey: key, topic: "travel" })).status).toBe(200);
    expect((await auth(request(f.app).post("/memories/clear-all")).send({ idempotencyKey: key })).status).toBe(200);
    expect((await auth(request(f.app).post("/memories/export")).send({ idempotencyKey: key })).status).toBe(200);
    expect((await auth(request(f.app).post("/memory/summary/regenerate")).send({ idempotencyKey: key })).status).toBe(202);
    expect((await auth(request(f.app).post("/memory/summary/feedback")).send({ idempotencyKey: key, feedback: "Accurate" })).status).toBe(200);
    expect(f.memory.updateSettings).toHaveBeenCalledWith("bearer-owner", { automaticMemoryCandidates: false }, "memory-request");
    expect(f.memory.delete).toHaveBeenCalledWith("bearer-owner", id, key, "memory-request");
    expect(f.memory.acceptCandidate).toHaveBeenCalledWith("bearer-owner", id, { idempotencyKey: key }, "memory-request");
  });

  it("rejects client ownership, malformed resources, and unauthenticated calls", async () => {
    const f = fixture();
    expect((await request(f.app).get("/memories")).status).toBe(401);
    expect((await auth(request(f.app).get("/memories/not-a-uuid"))).status).toBe(404);
    expect((await auth(request(f.app).patch("/settings/memory")).send({ automaticMemoryCandidates: true, userId: "attacker" })).status).toBe(400);
    expect((await auth(request(f.app).post("/memories/clear-all")).send({ idempotencyKey: key, userId: "attacker" })).status).toBe(400);
    expect((await auth(request(f.app).delete(`/memories/${id}`)).set("Idempotency-Key", key).send({ userId: "attacker" })).status).toBe(400);
    expect(f.memory.clearAll).not.toHaveBeenCalled();
  });
});
