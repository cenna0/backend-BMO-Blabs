import express from "express";
import multer from "multer";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { createIntegrationRouter, createSupportRouter } from "../../src/p9/http/integration.route.js";
import { p9ErrorHandler } from "../../src/p9/http/middleware.js";

const id = "00000000-0000-4000-8000-000000000010";

function fixture() {
  const accessTokens = { verify: vi.fn().mockResolvedValue({ sub: "owner", sid: "session" }) };
  const sessions = { isActive: vi.fn().mockResolvedValue(true) };
  const integration = {
    connectWhatsApp: vi.fn().mockResolvedValue({ connection: { provider: "whatsapp", status: "PENDING" }, blocked: true }),
    connection: vi.fn().mockResolvedValue({ provider: "whatsapp", status: "DISCONNECTED", scopes: [] }),
    whatsappConnection: vi.fn().mockResolvedValue({ provider: "whatsapp", status: "DISCONNECTED", scopes: [] }),
    whatsappQr: vi.fn().mockResolvedValue({ qr: null, expiresAt: null, status: "DISCONNECTED" }),
    confirmWhatsApp: vi.fn().mockResolvedValue({ provider: "whatsapp", status: "CONNECTED" }),
    disconnectWhatsApp: vi.fn().mockResolvedValue(undefined),
    whatsappRules: vi.fn().mockResolvedValue([]),
    updateWhatsAppRules: vi.fn().mockResolvedValue([]),
    whatsappConversations: vi.fn().mockResolvedValue({ conversations: [], nextCursor: null }),
    whatsappConversation: vi.fn().mockResolvedValue({ id, displayName: "Rangga", type: "DM", notificationEnabled: true, lastActivityAt: null }),
    resolveWhatsAppConversation: vi.fn().mockResolvedValue({ id, displayName: "Rangga", type: "DM", notificationEnabled: true, lastActivityAt: null }),
    whatsappPreview: vi.fn().mockResolvedValue({ id, status: "PENDING_CONFIRMATION" }),
    whatsappConfirm: vi.fn().mockResolvedValue({ id, status: "FAILED" }),
    spotifyConnect: vi.fn().mockResolvedValue({ authorizationUrl: "https://accounts.spotify.com/authorize?state=x", state: "x".repeat(64) }),
    spotifySearch: vi.fn().mockResolvedValue({ tracks: [], artists: [], albums: [], playlists: [] }),
    spotifyDisconnect: vi.fn().mockResolvedValue(undefined),
    spotifyDevices: vi.fn().mockResolvedValue([]),
    spotifyActiveDevice: vi.fn().mockResolvedValue(null),
    spotifyPlayback: vi.fn().mockResolvedValue({ code: "NO_ACTIVE_SPOTIFY_DEVICE" }),
    spotifyPreferredDevice: vi.fn().mockResolvedValue({ device: null }),
    spotifyAction: vi.fn().mockResolvedValue({ id, status: "PENDING_CONFIRMATION" }),
    spotifyCallback: vi.fn().mockResolvedValue({ ok: true }),
    pluginCatalog: vi.fn().mockResolvedValue([]),
  };
  const bugs = { create: vi.fn().mockResolvedValue({ id, status: "received" }) };
  const upload = multer({ storage: multer.memoryStorage() }).array("screenshots", 5);
  const app = express();
  app.use(express.json());
  app.use(createIntegrationRouter(integration as any, accessTokens as any, sessions as any));
  app.use(createSupportRouter(bugs as any, accessTokens as any, sessions as any, upload));
  app.use(p9ErrorHandler);
  return { app, integration, bugs };
}

const auth = (operation: request.Test) => operation.set("Authorization", "Bearer access");

describe("integration HTTP contract", () => {
  it("registers all owner-scoped WhatsApp, Spotify, and plugin routes", async () => {
    const f = fixture();
    expect((await auth(request(f.app).post("/integrations/whatsapp/connect"))).status).toBe(202);
    expect((await auth(request(f.app).get("/integrations/whatsapp/status"))).status).toBe(200);
    expect((await auth(request(f.app).get("/integrations/whatsapp/qr"))).status).toBe(200);
    expect((await auth(request(f.app).post("/integrations/whatsapp/confirm-scanned")).send({})).status).toBe(200);
    expect((await auth(request(f.app).post("/integrations/whatsapp/disconnect")).send({})).status).toBe(204);
    expect((await auth(request(f.app).get("/integrations/whatsapp/notification-rules"))).status).toBe(200);
    expect((await auth(request(f.app).patch("/integrations/whatsapp/notification-rules")).send({ rules: [{ scope: "ALL" }] })).status).toBe(200);
    expect((await auth(request(f.app).get("/integrations/whatsapp/conversations?limit=10"))).status).toBe(200);
    expect((await auth(request(f.app).get(`/integrations/whatsapp/conversations/${id}`))).status).toBe(200);
    expect((await auth(request(f.app).post("/integrations/whatsapp/conversations/resolve")).send({ phoneNumber: "+6281234567890" })).status).toBe(200);
    expect((await auth(request(f.app).post("/integrations/whatsapp/send-preview")).send({ conversationId: id, message: "hi", idempotencyKey: "wa-1" }))).toHaveProperty("status", 201);
    expect((await auth(request(f.app).post("/integrations/whatsapp/send-confirm")).send({ requestId: id, confirmed: true })).status).toBe(200);
    expect((await auth(request(f.app).post("/integrations/spotify/connect"))).status).toBe(200);
    expect((await auth(request(f.app).get("/integrations/spotify/status"))).status).toBe(200);
    expect((await auth(request(f.app).get("/integrations/spotify/search?q=NIKI&type=artist"))).status).toBe(200);
    expect((await auth(request(f.app).get("/integrations/spotify/search?q=NIKI&type=unknown"))).status).toBe(400);
    expect((await auth(request(f.app).post("/integrations/spotify/disconnect")).send({})).status).toBe(204);
    expect((await auth(request(f.app).get("/integrations/spotify/devices"))).status).toBe(200);
    expect((await auth(request(f.app).get("/integrations/spotify/active-device"))).status).toBe(200);
    expect((await auth(request(f.app).get("/integrations/spotify/playback"))).status).toBe(200);
    expect((await auth(request(f.app).put("/integrations/spotify/preferred-device")).send({ deviceId: null })).status).toBe(200);
    expect((await auth(request(f.app).post("/integrations/spotify/actions")).send({ action: "PAUSE", idempotencyKey: "sp-1" })).status).toBe(202);
    expect((await request(f.app).get(`/integrations/spotify/callback?state=${"x".repeat(64)}&code=code`)).status).toBe(200);
    expect((await auth(request(f.app).get("/plugins"))).status).toBe(200);
  });

  it("requires auth and rejects owner-injected or invalid integration input", async () => {
    const f = fixture();
    expect((await request(f.app).get("/plugins")).status).toBe(401);
    expect((await auth(request(f.app).post("/integrations/spotify/actions")).send({ action: "DELETE_ALL", idempotencyKey: "x", userId: "attacker" })).status).toBe(400);
    expect((await auth(request(f.app).patch("/integrations/whatsapp/notification-rules")).send({ rules: [{ scope: "ALL", targetRef: "secret" }] })).status).toBe(400);
  });

  it("does not require a mobile bearer token on the Spotify callback", async () => {
    const f = fixture();
    expect((await request(f.app).get(`/integrations/spotify/callback?state=${"x".repeat(64)}&code=code`)).status).not.toBe(401);
  });

  it("accepts a bounded multipart bug report and returns only its receipt", async () => {
    const f = fixture();
    const response = await auth(request(f.app).post("/support/bug-reports"))
      .field("description", "A bounded report")
      .field("includeScreenshot", "false")
      .attach("screenshots", Buffer.from("not used"), "ignored.txt");
    expect(response.status).toBe(201);
    expect(response.body).toEqual({ id, status: "received" });
    expect(f.bugs.create).toHaveBeenCalledWith("owner", expect.objectContaining({ description: "A bounded report", includeScreenshot: false }), expect.any(Array), expect.any(String));
  });
});
