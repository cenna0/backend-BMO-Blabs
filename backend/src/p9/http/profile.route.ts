import { Router, type RequestHandler } from "express";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import multer from "multer";

import { sha256Hex } from "../crypto.js";
import { parseAvatarFileName } from "../avatar-key.js";
import { P9Error } from "../errors.js";
import type { AvatarStorage } from "../services/avatar-storage.service.js";
import type { AvatarService } from "../services/avatar.service.js";
import type { ProfileService } from "../services/profile.service.js";
import type { AccessTokenService, SessionService } from "../services/session.service.js";
import { asyncP9, currentAuth, ensureRequestContext, p9ErrorHandler, requireAuth } from "./middleware.js";

const acceptedMimeTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

export function createProfileRouter(
  profile: ProfileService,
  avatars: AvatarService,
  accessTokens: AccessTokenService,
  sessions: SessionService,
  maxBytes: number,
  uploadRate: { windowMs: number; limit: number } = { windowMs: 900_000, limit: 10 },
): Router {
  const router = Router();
  const authenticated = requireAuth(accessTokens, sessions);
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxBytes, files: 1, fields: 0 },
    fileFilter: (_request, file, callback) => {
      if (acceptedMimeTypes.has(file.mimetype)) callback(null, true);
      else callback(new Error("invalid avatar MIME"));
    },
  });
  const avatarUploadLimiter = rateLimit({
    windowMs: uploadRate.windowMs,
    limit: uploadRate.limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    keyGenerator: (request) => sha256Hex(
      `${request.p9Auth?.userId ?? "unauthenticated"}:${ipKeyGenerator(request.ip ?? "0.0.0.0")}`,
    ),
    handler: (_request, response) => response.status(429).json({ error: "RATE_LIMITED" }),
  });
  const parseAvatar: RequestHandler = (request, response, next) => {
    upload.single("file")(request, response, (error) => {
      if (error) {
        response.status(400).json({ error: "INVALID_INPUT" });
        return;
      }
      next();
    });
  };

  router.patch("/me/profile", authenticated, asyncP9(async (request, response) => {
    const auth = currentAuth(request);
    response.json({ user: await profile.update(auth.userId, request.body, auth.context.requestId) });
  }));

  router.post("/me/avatar", authenticated, avatarUploadLimiter, parseAvatar, asyncP9(async (request, response) => {
    const auth = currentAuth(request);
    if (!request.file) throw new P9Error("INVALID_INPUT", 400, "Avatar file is required");
    response.json(await avatars.upload(
      auth.userId,
      request.file.buffer,
      request.file.mimetype,
      auth.context.requestId,
    ));
  }));
  return router;
}

export function createAvatarMediaRouter(storage: AvatarStorage): Router {
  const router = Router();
  router.use(ensureRequestContext);
  router.get("/media/avatars/:fileName", asyncP9(async (request, response) => {
    const fileName = String(request.params.fileName ?? "");
    const key = parseAvatarFileName(fileName);
    if (!key) {
      response.status(404).json({ error: "NOT_FOUND" });
      return;
    }
    const image = await storage.read(key);
    if (!image) {
      response.status(404).json({ error: "NOT_FOUND" });
      return;
    }
    response.setHeader("Content-Type", "image/webp");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    response.status(200).send(image);
  }));
  router.use(p9ErrorHandler);
  return router;
}
