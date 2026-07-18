import { createReadStream } from "node:fs";
import { Router } from "express";

import type { TempAudioService } from "../services/temp-audio.service.js";
import { isUuidV4 } from "../utils/uuid.js";

export function createAudioRouter(tempAudio: TempAudioService): Router {
  const router = Router();
  router.get("/audio/:fileName", (request, response, next) => {
    const fileName = request.params.fileName;
    if (typeof fileName !== "string" || !fileName.endsWith(".mp3")) {
      response.sendStatus(404);
      return;
    }
    const audioId = fileName.slice(0, -4);
    if (!isUuidV4(audioId)) {
      response.sendStatus(404);
      return;
    }
    const record = tempAudio.get(audioId);
    if (!record) {
      response.sendStatus(404);
      return;
    }

    response.status(200);
    response.setHeader("Content-Type", "audio/mpeg");
    response.setHeader("Content-Length", String(record.size));
    response.setHeader("Cache-Control", "no-store, private, max-age=0");
    const stream = createReadStream(record.path);
    stream.once("error", next);
    stream.pipe(response);
  });
  return router;
}
