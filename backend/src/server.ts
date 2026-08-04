import { fileURLToPath } from "node:url";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import express, { type Express } from "express";
import { pino, type Logger } from "pino";

import { parseEnv, type BackendConfig } from "./config/env.js";
import { createP9Runtime, type P9Runtime } from "./p9/index.js";
import { RequestStore } from "./domain/request-store.js";
import { createAudioRouter } from "./http/audio.route.js";
import { createHealthRouter } from "./http/health.route.js";
import { createVoiceErrorHandler, createVoiceRouter } from "./http/voice.route.js";
import { AudioServiceClient } from "./services/audio-service.client.js";
import { ConversationQueue } from "./services/conversation-queue.js";
import { HermesResponsesClient } from "./services/hermes.client.js";
import { HardwareTestService } from "./services/hardware-test.service.js";
import { BackendReadinessService } from "./services/readiness.service.js";
import { TempAudioService } from "./services/temp-audio.service.js";
import { VoicePipelineService } from "./services/voice-pipeline.service.js";
import { DeviceRegistry } from "./websocket/device-registry.js";
import { DeviceWebSocketServer } from "./websocket/websocket.server.js";

export interface BackendRuntime {
  app: Express;
  httpServer: Server;
  requestStore: RequestStore;
  sockets: DeviceWebSocketServer;
  tempAudio: TempAudioService;
  p9?: P9Runtime;
  runMaintenance(): Promise<void>;
  start(port?: number): Promise<AddressInfo>;
  stop(): Promise<void>;
}

export function createBackendRuntime(config: BackendConfig): BackendRuntime {
  const logger: Logger = pino({ level: config.NODE_ENV === "test" ? "silent" : "info" });
  const app = express();
  app.disable("x-powered-by");
  const httpServer = createServer(app);
  const requestStore = new RequestStore({
    tombstoneTtlMs: config.REQUEST_TOMBSTONE_TTL_SECONDS * 1_000,
    maxEntries: config.MAX_REQUEST_STORE_ENTRIES,
  });
  const registry = new DeviceRegistry(requestStore);
  const tempAudio = new TempAudioService(config.TEMP_AUDIO_DIR, config.TEMP_AUDIO_TTL_SECONDS);
  let publicBaseUrl = config.PUBLIC_BASE_URL.replace(/\/$/, "");
  let cleanupInterval: NodeJS.Timeout | undefined;
  let p9: P9Runtime | undefined;

  const removeOutput = async (deviceId: string, requestId: string, failed: boolean) => {
    const record = requestStore.get(requestId);
    if (!record || record.deviceId !== deviceId) {
      logger.warn({ device_id: deviceId, request_id: requestId }, "ignored playback event");
      return;
    }
    if (record.status === "completed" || record.status === "failed" || record.status === "expired") {
      return;
    }
    if (record.status !== "audio_ready") {
      logger.warn({ device_id: deviceId, request_id: requestId }, "ignored playback event");
      return;
    }
    if (record.audioId) await tempAudio.deleteAudio(record.audioId);
    if (failed) requestStore.fail(requestId, "INTERNAL_ERROR");
    else requestStore.complete(requestId);
  };

  const sockets = new DeviceWebSocketServer({
    httpServer,
    registry,
    deviceId: config.DEVICE_ID,
    deviceToken: config.DEVICE_TOKEN,
    authTimeoutMs: config.WS_AUTH_TIMEOUT_MS,
    heartbeatIntervalMs: config.WS_HEARTBEAT_INTERVAL_MS,
    maxMissedPongs: config.WS_MAX_MISSED_PONGS,
    maxMessageBytes: config.WS_MAX_MESSAGE_BYTES,
    onPlaybackDone: (deviceId, requestId) => removeOutput(deviceId, requestId, false),
    onPlaybackFailed: (deviceId, requestId) => removeOutput(deviceId, requestId, true),
  });
  let hardwareTest: HardwareTestService | undefined;
  if (config.HARDWARE_TEST_MODE) {
    const fixturePath = config.HARDWARE_TEST_MP3_PATH;
    if (!fixturePath) throw new Error("hardware test fixture is required");
    hardwareTest = new HardwareTestService(
      fixturePath,
      () => publicBaseUrl,
      tempAudio,
      requestStore,
      sockets,
      logger,
    );
  }
  const audioService = new AudioServiceClient({
    baseUrl: config.AUDIO_SERVICE_URL,
    internalToken: config.INTERNAL_SERVICE_TOKEN,
    sttTimeoutMs: config.AUDIO_SERVICE_STT_TIMEOUT_MS,
    ttsTimeoutMs: config.AUDIO_SERVICE_TTS_TIMEOUT_MS,
  });
  const hermes = new HermesResponsesClient({
    baseUrl: config.HERMES_API_URL,
    apiKey: config.HERMES_API_KEY,
    model: config.HERMES_MODEL,
    conversation: config.HERMES_CONVERSATION,
    softTimeoutMs: config.HERMES_SOFT_TIMEOUT_MS,
    hardTimeoutMs: config.HERMES_HARD_TIMEOUT_MS,
    logger,
  });
  const readiness = new BackendReadinessService({
    hermesBaseUrl: config.HERMES_API_URL,
    audioServiceBaseUrl: config.AUDIO_SERVICE_URL,
    timeoutMs: config.READINESS_PROBE_TIMEOUT_MS,
  });
  const conversationQueue = new ConversationQueue();
  const pipeline = new VoicePipelineService({
    publicBaseUrl: () => publicBaseUrl,
    tempAudio,
    requestStore,
    sockets,
    logger,
    audioService,
    hermes,
    conversationQueue,
    conversationKey: config.HERMES_CONVERSATION,
    totalTimeoutMs: config.TOTAL_PIPELINE_TIMEOUT_MS,
  });

  const runMaintenance = async () => {
    const expired = requestStore.expireReadyBefore(Date.now());
    for (const record of expired) {
      try {
        if (record.audioId) await tempAudio.expireAudio(record.audioId);
      } catch (error) {
        logger.warn(
          { request_id: record.requestId, err: error },
          "failed to delete tracked expired audio",
        );
      }
      sockets.sendRequestFailed(record.deviceId, record.requestId, "AUDIO_EXPIRED");
    }
    requestStore.collectGarbage();
    tempAudio.collectExpiredAudioTombstones(
      config.REQUEST_TOMBSTONE_TTL_SECONDS * 1_000,
      config.MAX_REQUEST_STORE_ENTRIES,
    );
    try {
      const cleanup = await tempAudio.cleanupExpiredOrphans();
      if (cleanup.failed > 0) {
        logger.warn(
          { failed_files: cleanup.failed },
          "one or more orphan temp-audio files could not be cleaned",
        );
      }
    } catch (error) {
      logger.warn({ err: error }, "periodic orphan temp-audio cleanup failed");
    }
  };

  app.use(createHealthRouter({ hardwareTestMode: config.HARDWARE_TEST_MODE, readiness }));
  if (config.p9.enabled) {
    p9 = createP9Runtime(config.p9);
    app.use("/api/v1", p9.router);
  }
  app.use(createVoiceRouter({ config, requestStore, sockets, tempAudio, hardwareTest, pipeline, logger }));
  app.use(createAudioRouter(tempAudio, { requestStore, sockets }));
  app.use(createVoiceErrorHandler(config.MAX_AUDIO_BYTES));
  app.use((_error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    response.status(500).json({ error: "INTERNAL_ERROR" });
  });

  return {
    app,
    httpServer,
    requestStore,
    sockets,
    tempAudio,
    ...(p9 === undefined ? {} : { p9 }),
    runMaintenance,
    async start(port = config.BACKEND_PORT) {
      await tempAudio.initialize();
      try {
        await tempAudio.startupCleanup();
      } catch (error) {
        logger.warn({ err: error }, "startup orphan temp-audio cleanup failed");
      }
      await new Promise<void>((resolve, reject) => {
        const onError = (error: Error) => reject(error);
        httpServer.once("error", onError);
        httpServer.listen(port, config.BACKEND_HOST, () => {
          httpServer.off("error", onError);
          resolve();
        });
      });
      const address = httpServer.address();
      if (!address || typeof address === "string") throw new Error("backend failed to bind TCP port");
      const configured = new URL(config.PUBLIC_BASE_URL);
      if (configured.port === "0") {
        configured.port = String(address.port);
        publicBaseUrl = configured.toString().replace(/\/$/, "");
      }
      cleanupInterval = setInterval(
        () => {
          void runMaintenance().catch((error) => {
            logger.error({ err: error }, "unexpected backend maintenance failure");
          });
        },
        config.TEMP_AUDIO_CLEANUP_INTERVAL_SECONDS * 1_000,
      );
      cleanupInterval.unref();
      logger.info({ host: config.BACKEND_HOST, port: address.port }, "backend started");
      return address;
    },
    async stop() {
      if (cleanupInterval) {
        clearInterval(cleanupInterval);
        cleanupInterval = undefined;
      }
      if (p9) await p9.close();
      await sockets.close();
      if (httpServer.listening) {
        await new Promise<void>((resolve, reject) => {
          httpServer.close((error) => (error ? reject(error) : resolve()));
        });
      }
    },
  };
}

async function run(): Promise<void> {
  const runtime = createBackendRuntime(parseEnv(process.env));
  await runtime.start();
  const shutdown = async () => {
    await runtime.stop();
    process.exit(0);
  };
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  void run();
}
