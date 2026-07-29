import { createHash } from "node:crypto";
import { setImmediate } from "node:timers";
import express, { Router, type ErrorRequestHandler, type RequestHandler } from "express";
import type { Logger } from "pino";

import type { BackendConfig } from "../config/env.js";
import { RequestStoreError, toPublicRequestStatus, type RequestStore } from "../domain/request-store.js";
import type { HardwareTestService } from "../services/hardware-test.service.js";
import type { TempAudioService } from "../services/temp-audio.service.js";
import type { VoicePipelineService } from "../services/voice-pipeline.service.js";
import { deviceTokenMatches } from "../utils/device-auth.js";
import { isUuidV4 } from "../utils/uuid.js";
import { validateCanonicalWav } from "../utils/wav-validator.js";
import type { DeviceWebSocketServer } from "../websocket/websocket.server.js";

interface VoiceContext {
  deviceId: string;
  requestId: string;
  contentLength: number;
}

export interface VoiceRouteDependencies {
  config: BackendConfig;
  requestStore: RequestStore;
  sockets: DeviceWebSocketServer;
  tempAudio: TempAudioService;
  hardwareTest: HardwareTestService | undefined;
  pipeline?: VoicePipelineService;
  logger: Logger;
}

function websocketRequired(response: Parameters<RequestHandler>[1]): void {
  response.status(409).json({
    error: "WEBSOCKET_NOT_CONNECTED",
    message: "Device must reconnect before uploading audio.",
  });
}

export function createVoiceRouter(dependencies: VoiceRouteDependencies): Router {
  const { config, requestStore, sockets, tempAudio, hardwareTest, pipeline, logger } = dependencies;
  const router = Router();

  const preflight: RequestHandler = (request, response, next) => {
    const deviceId = request.get("X-Device-Id");
    const deviceToken = request.get("X-Device-Token");
    const requestId = request.get("X-Request-Id");
    const contentType = request.get("Content-Type")?.split(";", 1)[0]?.trim().toLowerCase();
    const contentLengthRaw = request.get("Content-Length");

    if (!deviceId || !deviceToken || !requestId || !contentType || !contentLengthRaw) {
      response.status(400).json({ error: "MISSING_REQUIRED_HEADER" });
      return;
    }
    if (deviceId !== config.DEVICE_ID || !deviceTokenMatches(deviceToken, config.DEVICE_TOKEN)) {
      response.status(401).json({ error: "INVALID_DEVICE_CREDENTIALS" });
      return;
    }
    if (!isUuidV4(requestId)) {
      response.status(400).json({ error: "INVALID_REQUEST_ID" });
      return;
    }
    if (contentType !== "audio/wav") {
      response.status(415).json({ error: "UNSUPPORTED_AUDIO_TYPE", expected: "audio/wav" });
      return;
    }
    if (!/^\d+$/.test(contentLengthRaw)) {
      response.status(400).json({ error: "MISSING_REQUIRED_HEADER" });
      return;
    }
    const contentLength = Number(contentLengthRaw);
    if (contentLength > config.MAX_AUDIO_BYTES) {
      request.once("end", () => {
        response.status(413).json({ error: "AUDIO_TOO_LARGE", max_bytes: config.MAX_AUDIO_BYTES });
      });
      request.resume();
      return;
    }
    if (!sockets.isAuthenticated(deviceId)) {
      websocketRequired(response);
      return;
    }
    response.locals.voice = { deviceId, requestId, contentLength } satisfies VoiceContext;
    next();
  };

  const accept: RequestHandler = async (request, response) => {
    const context = response.locals.voice as VoiceContext;
    const body = request.body;
    if (!Buffer.isBuffer(body) || body.length !== context.contentLength) {
      response.status(422).json({
        error: "INVALID_AUDIO_FORMAT",
        expected: "WAV PCM 16-bit, 16 kHz, mono",
      });
      return;
    }
    if (body.length > config.MAX_AUDIO_BYTES) {
      response.status(413).json({ error: "AUDIO_TOO_LARGE", max_bytes: config.MAX_AUDIO_BYTES });
      return;
    }
    try {
      validateCanonicalWav(body, config.MAX_AUDIO_DURATION_SECONDS);
    } catch {
      response.status(422).json({
        error: "INVALID_AUDIO_FORMAT",
        expected: "WAV PCM 16-bit, 16 kHz, mono",
      });
      return;
    }

    const inputSha256 = createHash("sha256").update(body).digest("hex");
    const existing = requestStore.get(context.requestId);
    if (existing) {
      if (existing.deviceId !== context.deviceId) {
        response.status(409).json({ error: "REQUEST_ID_CONFLICT" });
        return;
      }
      if (existing.inputSha256 !== inputSha256 || existing.inputContentLength !== body.length) {
        response.status(409).json({ error: "REQUEST_ID_CONFLICT" });
        return;
      }
      if (existing.status === "audio_ready" && existing.expiresAt !== null && existing.expiresAt <= Date.now()) {
        if (existing.audioId) await tempAudio.expireAudio(existing.audioId);
        requestStore.expire(existing.requestId);
      }
      response.status(200).json({
        request_id: context.requestId,
        status: toPublicRequestStatus(existing),
        duplicate: true,
        error_code: existing.errorCode,
      });
      if (existing.status === "audio_ready") {
        sockets.sendAudioReady(existing);
      }
      return;
    }
    if (requestStore.getActiveForDevice(context.deviceId)) {
      response.status(409).json({
        error: "DEVICE_BUSY",
        message: "Previous voice request is still processing.",
      });
      return;
    }

    let inputPath: string | undefined;
    try {
      inputPath = await tempAudio.writeInput(context.requestId, body);
      if (!sockets.isAuthenticated(context.deviceId)) {
        await tempAudio.deleteInput(inputPath);
        websocketRequired(response);
        return;
      }
      const record = requestStore.create({
        requestId: context.requestId,
        deviceId: context.deviceId,
        inputPath,
        inputSha256,
        inputContentLength: body.length,
      });
      response.status(202).json({ request_id: context.requestId, status: "processing" });
      setImmediate(() => {
        if (config.HARDWARE_TEST_MODE) {
          if (hardwareTest) {
            void hardwareTest.process(record);
            return;
          }
          logger.error({ request_id: record.requestId }, "hardware test service unavailable");
          requestStore.fail(record.requestId, "INTERNAL_ERROR");
          sockets.sendRequestFailed(record.deviceId, record.requestId, "INTERNAL_ERROR");
          return;
        }
        if (pipeline) {
          void pipeline.process(record);
          return;
        }
        logger.error({ request_id: record.requestId }, "voice pipeline unavailable");
        requestStore.fail(record.requestId, "INTERNAL_ERROR");
        sockets.sendRequestFailed(record.deviceId, record.requestId, "INTERNAL_ERROR");
      });
    } catch (error) {
      if (inputPath) await tempAudio.deleteInput(inputPath);
      if (error instanceof RequestStoreError && error.code === "DEVICE_BUSY") {
        response.status(409).json({
          error: "DEVICE_BUSY",
          message: "Previous voice request is still processing.",
        });
        return;
      }
      logger.error({ request_id: context.requestId, err: error }, "voice upload failed before accept");
      response.status(500).json({ error: "INTERNAL_ERROR" });
    }
  };

  router.post(
    "/api/v1/voice",
    preflight,
    express.raw({ type: "audio/wav", limit: config.MAX_AUDIO_BYTES }),
    accept,
  );
  return router;
}

export function createVoiceErrorHandler(maxAudioBytes: number): ErrorRequestHandler {
  return (error: unknown, _request, response, next) => {
    if (typeof error === "object" && error !== null && "type" in error && error.type === "entity.too.large") {
      response.status(413).json({ error: "AUDIO_TOO_LARGE", max_bytes: maxAudioBytes });
      return;
    }
    next(error);
  };
}
