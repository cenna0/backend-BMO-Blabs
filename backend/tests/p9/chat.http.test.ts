import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { createChatRouter } from "../../src/p9/http/chat.route.js";
import { p9ErrorHandler } from "../../src/p9/http/middleware.js";

const sessionId = "00000000-0000-4000-8000-000000000010";
const messageId = "00000000-0000-4000-8000-000000000020";
const operationId = "00000000-0000-4000-8000-000000000030";
const idempotencyKey = "00000000-0000-4000-8000-000000000040";

function fixture() {
  const accessTokens = { verify: vi.fn().mockResolvedValue({ sub: "user-from-token", sid: "session-from-token" }) };
  const sessions = { isActive: vi.fn().mockResolvedValue(true) };
  const chat = {
    listSessions: vi.fn().mockResolvedValue({ sessions: [] }),
    createSession: vi.fn().mockResolvedValue({ id: sessionId, temporary: false, title: null, createdAt: "2026-08-12T08:00:00.000Z", updatedAt: "2026-08-12T08:00:00.000Z" }),
    listMessages: vi.fn().mockResolvedValue({ messages: [], nextCursor: null }),
    submitMessage: vi.fn().mockResolvedValue({
      userMessage: { id: messageId, sender: "user", text: "Hello", createdAt: "2026-08-12T08:00:00.000Z" },
      assistant: { status: "processing", operationId },
    }),
    deleteSession: vi.fn().mockResolvedValue(undefined),
    setFeedback: vi.fn().mockResolvedValue({ messageId, rating: "positive", reason: null, updatedAt: "2026-08-12T08:00:00.000Z" }),
  };
  const app = express();
  app.use(express.json());
  app.use(createChatRouter(chat as any, accessTokens as any, sessions as any));
  app.use(p9ErrorHandler);
  return { app, chat };
}

describe("chat HTTP contract", () => {
  it("registers the frozen route shapes and derives ownership only from auth", async () => {
    const f = fixture();
    expect((await request(f.app).get("/chat/sessions").set("Authorization", "Bearer access")).status).toBe(200);
    expect((await request(f.app).post("/chat/sessions").set("Authorization", "Bearer access").send({ temporary: false, userId: "attacker" })).status).toBe(400);
    expect((await request(f.app).post("/chat/sessions").set("Authorization", "Bearer access").send({ temporary: false })).status).toBe(201);
    expect(f.chat.createSession).toHaveBeenCalledWith("user-from-token", { temporary: false }, expect.any(String));

    const history = await request(f.app).get(`/chat/sessions/${sessionId}/messages?cursor=12&limit=25`).set("Authorization", "Bearer access");
    expect(history.status).toBe(200);
    expect(f.chat.listMessages).toHaveBeenCalledWith("user-from-token", sessionId, { cursor: "12", limit: 25 });

    const accepted = await request(f.app).post(`/chat/sessions/${sessionId}/messages`)
      .set("Authorization", "Bearer access").set("X-Request-Id", "chat-request-1")
      .send({ idempotencyKey, text: "Hello", speakOnDevice: false, userId: "attacker" });
    expect(accepted.status).toBe(400);

    const valid = await request(f.app).post(`/chat/sessions/${sessionId}/messages`)
      .set("Authorization", "Bearer access").set("X-Request-Id", "chat-request-2")
      .send({ idempotencyKey, text: "Hello", speakOnDevice: false });
    expect(valid.status).toBe(202);
    expect(valid.body.assistant).toEqual({ status: "processing", operationId });
    expect(f.chat.submitMessage).toHaveBeenCalledWith(
      "user-from-token", sessionId,
      { idempotencyKey, text: "Hello", speakOnDevice: false }, "chat-request-2",
    );

    expect((await request(f.app).delete(`/chat/sessions/${sessionId}`).set("Authorization", "Bearer access")).status).toBe(204);
    expect((await request(f.app).post(`/chat/messages/${messageId}/feedback`).set("Authorization", "Bearer access")
      .send({ rating: "positive" })).status).toBe(200);
  });

  it("rejects malformed cursors, UUIDs, bodies, and unauthenticated access", async () => {
    const f = fixture();
    expect((await request(f.app).get("/chat/sessions")).status).toBe(401);
    expect((await request(f.app).get(`/chat/sessions/${sessionId}/messages?cursor=-1`).set("Authorization", "Bearer access")).status).toBe(400);
    expect((await request(f.app).get(`/chat/sessions/${sessionId}/messages?cursor=9223372036854775808`).set("Authorization", "Bearer access")).status).toBe(400);
    expect((await request(f.app).get("/chat/sessions/not-a-uuid/messages").set("Authorization", "Bearer access")).status).toBe(404);
    expect((await request(f.app).post(`/chat/sessions/${sessionId}/messages`).set("Authorization", "Bearer access")
      .send({ idempotencyKey: "not-a-uuid", text: "Hello" })).status).toBe(400);
    expect((await request(f.app).post(`/chat/messages/${messageId}/feedback`).set("Authorization", "Bearer access")
      .send({ rating: "maybe" })).status).toBe(400);
  });
});
