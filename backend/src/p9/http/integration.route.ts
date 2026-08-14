import { Router } from "express";

import { P9Error } from "../errors.js";
import { parseBugReportInput, parseSpotifyAction, parseWhatsAppConversationQuery, parseWhatsAppRecipientResolve, parseWhatsAppRulesPatch, whatsappSendConfirmSchema, whatsappSendPreviewSchema } from "../integrations.validation.js";
import type { IntegrationService } from "../services/integration.service.js";
import type { AccessTokenService, SessionService } from "../services/session.service.js";
import { asyncP9, currentAuth, requireAuth } from "./middleware.js";

function queryString(value: unknown): string {
  if (typeof value !== "string") throw new P9Error("INVALID_INPUT", 400, "Invalid input");
  return value;
}

export function createIntegrationRouter(integration: IntegrationService, accessTokens: AccessTokenService, sessions: SessionService): Router {
  const router = Router();
  const authenticated = requireAuth(accessTokens, sessions);

  router.post("/integrations/whatsapp/connect", authenticated, asyncP9(async (request, response) => { const auth = currentAuth(request); response.status(202).json(await integration.connectWhatsApp(auth.userId, auth.context.requestId)); }));
  router.get("/integrations/whatsapp/status", authenticated, asyncP9(async (request, response) => { response.json(await integration.whatsappConnection(currentAuth(request).userId)); }));
  router.get("/integrations/whatsapp/conversations", authenticated, asyncP9(async (request, response) => { const auth = currentAuth(request); response.json(await integration.whatsappConversations(auth.userId, parseWhatsAppConversationQuery(request.query))); }));
  router.get("/integrations/whatsapp/conversations/:id", authenticated, asyncP9(async (request, response) => { response.json(await integration.whatsappConversation(currentAuth(request).userId, queryString(request.params.id))); }));
  router.post("/integrations/whatsapp/conversations/resolve", authenticated, asyncP9(async (request, response) => { response.json(await integration.resolveWhatsAppConversation(currentAuth(request).userId, parseWhatsAppRecipientResolve(request.body))); }));
  router.get("/integrations/whatsapp/qr", authenticated, asyncP9(async (request, response) => { response.json(await integration.whatsappQr(currentAuth(request).userId)); }));
  router.post("/integrations/whatsapp/confirm-scanned", authenticated, asyncP9(async (request, response) => { const auth = currentAuth(request); response.json({ connection: await integration.confirmWhatsApp(auth.userId, auth.context.requestId) }); }));
  router.post("/integrations/whatsapp/disconnect", authenticated, asyncP9(async (request, response) => { const auth = currentAuth(request); await integration.disconnectWhatsApp(auth.userId, auth.context.requestId); response.status(204).end(); }));
  router.get("/integrations/whatsapp/notification-rules", authenticated, asyncP9(async (request, response) => { response.json({ rules: await integration.whatsappRules(currentAuth(request).userId) }); }));
  router.patch("/integrations/whatsapp/notification-rules", authenticated, asyncP9(async (request, response) => { const auth = currentAuth(request); response.json({ rules: await integration.updateWhatsAppRules(auth.userId, parseWhatsAppRulesPatch(request.body), auth.context.requestId) }); }));
  router.post("/integrations/whatsapp/send-preview", authenticated, asyncP9(async (request, response) => { const auth = currentAuth(request); response.status(201).json({ send: await integration.whatsappPreview(auth.userId, whatsappSendPreviewSchema.parse(request.body), auth.context.requestId) }); }));
  router.post("/integrations/whatsapp/send-confirm", authenticated, asyncP9(async (request, response) => { const auth = currentAuth(request); const input = whatsappSendConfirmSchema.parse(request.body); response.json({ send: await integration.whatsappConfirm(auth.userId, input.requestId, auth.context.requestId) }); }));

  router.post("/integrations/spotify/connect", authenticated, asyncP9(async (request, response) => { response.json(await integration.spotifyConnect(currentAuth(request).userId)); }));
  router.get("/integrations/spotify/status", authenticated, asyncP9(async (request, response) => { response.json(await integration.connection(currentAuth(request).userId, "SPOTIFY" as any)); }));
  router.get("/integrations/spotify/search", authenticated, asyncP9(async (request, response) => {
    const query = queryString(request.query.q);
    const rawTypes = typeof request.query.type === "string" ? request.query.type.split(",") : undefined;
    const allowedTypes = new Set(["track", "artist", "album", "playlist"]);
    if (rawTypes?.some((type) => !allowedTypes.has(type))) throw new P9Error("INVALID_INPUT", 400, "Invalid Spotify search type");
    const types = rawTypes?.filter((type): type is "track" | "artist" | "album" | "playlist" => allowedTypes.has(type));
    response.json({ results: await integration.spotifySearch(currentAuth(request).userId, query, types?.length ? types : undefined) });
  }));
  router.post("/integrations/spotify/disconnect", authenticated, asyncP9(async (request, response) => { await integration.spotifyDisconnect(currentAuth(request).userId); response.status(204).end(); }));
  router.get("/integrations/spotify/devices", authenticated, asyncP9(async (request, response) => { response.json({ devices: await integration.spotifyDevices(currentAuth(request).userId) }); }));
  router.get("/integrations/spotify/active-device", authenticated, asyncP9(async (request, response) => { response.json({ device: await integration.spotifyActiveDevice(currentAuth(request).userId) }); }));
  router.get("/integrations/spotify/playback", authenticated, asyncP9(async (request, response) => { response.json({ playback: await integration.spotifyPlayback(currentAuth(request).userId) }); }));
  router.post("/integrations/spotify/actions", authenticated, asyncP9(async (request, response) => { const auth = currentAuth(request); response.status(202).json({ action: await integration.spotifyAction(auth.userId, parseSpotifyAction(request.body), auth.context.requestId) }); }));
  router.get("/integrations/spotify/callback", asyncP9(async (request, response) => { await integration.spotifyCallback(queryString(request.query.state), typeof request.query.code === "string" ? request.query.code : undefined, typeof request.query.error === "string" ? request.query.error : undefined); response.status(200).send("Spotify connection completed. You may return to BMO."); }));
  router.get("/plugins", authenticated, asyncP9(async (request, response) => { response.json({ items: await integration.pluginCatalog(currentAuth(request).userId) }); }));
  return router;
}

export interface BugReportHttpService {
  create(userId: string, input: { category: string; description: string; context?: string; includeScreenshot: boolean }, files: Express.Multer.File[], requestId?: string): Promise<{ id: string; status: "received" }>;
}

export function createSupportRouter(service: BugReportHttpService, accessTokens: AccessTokenService, sessions: SessionService, upload: import("express").RequestHandler): Router {
  const router = Router();
  const authenticated = requireAuth(accessTokens, sessions);
  router.post("/support/bug-reports", authenticated, upload, asyncP9(async (request, response) => {
    const auth = currentAuth(request);
    const files = Array.isArray(request.files) ? request.files : [];
    if (files.length > 5) throw new P9Error("INVALID_INPUT", 400, "Too many screenshots");
    const input = parseBugReportInput({
      category: request.body.category,
      description: request.body.description,
      context: request.body.context,
      includeScreenshot: request.body.includeScreenshot,
    });
    const report = input.context === undefined
      ? { category: input.category, description: input.description, includeScreenshot: input.includeScreenshot }
      : { category: input.category, description: input.description, context: input.context, includeScreenshot: input.includeScreenshot };
    response.status(201).json(await service.create(auth.userId, report, files, auth.context.requestId));
  }));
  return router;
}
