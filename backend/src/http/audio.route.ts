import { createReadStream } from "node:fs";
import { Router } from "express";

import type { RequestStore } from "../domain/request-store.js";
import type { TempAudioService } from "../services/temp-audio.service.js";
import { isUuidV4 } from "../utils/uuid.js";
import type { DeviceWebSocketServer } from "../websocket/websocket.server.js";

export interface AudioRouterDependencies {
  requestStore?: RequestStore;
  sockets?: DeviceWebSocketServer;
}

export function createAudioRouter(tempAudio: TempAudioService, dependencies: AudioRouterDependencies = {}): Router {
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
    const lookup = tempAudio.getForDownload(audioId);
    if (lookup.status === "unknown") {
      response.sendStatus(404);
      return;
    }
    if (lookup.status === "expired") {
      void tempAudio.expireAudio(audioId);
      const record = dependencies.requestStore?.getByAudioId(audioId);
      if (record && record.status === "audio_ready") {
        dependencies.requestStore?.expire(record.requestId);
        dependencies.sockets?.sendRequestFailed(record.deviceId, record.requestId, "AUDIO_EXPIRED");
      }
      response.status(410).json({ error: "AUDIO_EXPIRED" });
      return;
    }
    const { record } = lookup;

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
