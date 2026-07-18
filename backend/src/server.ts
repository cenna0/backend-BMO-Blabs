import { fileURLToPath } from "node:url";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import express, { type Express } from "express";
import { pino, type Logger } from "pino";

import { parseEnv, type BackendConfig } from "./config/env.js";
import { RequestStore } from "./domain/request-store.js";
import { createAudioRouter } from "./http/audio.route.js";
import { createHealthRouter } from "./http/health.route.js";
import { createVoiceErrorHandler, createVoiceRouter } from "./http/voice.route.js";
import { HardwareTestService } from "./services/hardware-test.service.js";
import { TempAudioService } from "./services/temp-audio.service.js";
import { DeviceRegistry } from "./websocket/device-registry.js";
import { DeviceWebSocketServer } from "./websocket/websocket.server.js";

export interface BackendRuntime {
  app: Express;
  httpServer: Server;
  requestStore: RequestStore;
  sockets: DeviceWebSocketServer;
  tempAudio: TempAudioService;
  start(port?: number): Promise<AddressInfo>;
  stop(): Promise<void>;
}

export function createBackendRuntime(config: BackendConfig): BackendRuntime {
  const logger: Logger = pino({ level: config.NODE_ENV === "test" ? "silent" : "info" });
  const app = express();
  app.disable("x-powered-by");
  const httpServer = createServer(app);
  const requestStore = new RequestStore();
  const registry = new DeviceRegistry(requestStore);
  const tempAudio = new TempAudioService(config.TEMP_AUDIO_DIR, config.TEMP_AUDIO_TTL_SECONDS);
  let publicBaseUrl = config.PUBLIC_BASE_URL.replace(/\/$/, "");

  const removeOutput = async (deviceId: string, requestId: string, failed: boolean) => {
    const record = requestStore.get(requestId);
    if (!record || record.deviceId !== deviceId || record.status !== "audio_ready") {
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
  const hardwareTest = new HardwareTestService(
    config.HARDWARE_TEST_MP3_PATH,
    () => publicBaseUrl,
    tempAudio,
    requestStore,
    sockets,
    logger,
  );

  app.use(createHealthRouter(config.HARDWARE_TEST_MODE));
  app.use(createVoiceRouter({ config, requestStore, sockets, tempAudio, hardwareTest, logger }));
  app.use(createAudioRouter(tempAudio));
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
    async start(port = config.BACKEND_PORT) {
      await tempAudio.initialize();
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
      logger.info({ host: config.BACKEND_HOST, port: address.port }, "backend started");
      return address;
    },
    async stop() {
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
