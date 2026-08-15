import { fileURLToPath } from "node:url";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import express, { type Express } from "express";
import { pino, type Logger } from "pino";

import { parseEnv, type BackendConfig } from "./config/env.js";
import { createP9Runtime, type P9Runtime } from "./p9/index.js";
import { MobileWebSocketServer } from "./p9/websocket/mobile-websocket.server.js";
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
import { readFileSync } from "node:fs";

export interface BackendRuntime {
  app: Express;
  httpServer: Server;
  requestStore: RequestStore;
  sockets: DeviceWebSocketServer;
  mobileSockets?: MobileWebSocketServer;
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
  app.set("trust proxy", config.TRUST_PROXY_HOPS);
  const httpServer = createServer(app);
  const requestStore = new RequestStore({
    tombstoneTtlMs: config.REQUEST_TOMBSTONE_TTL_SECONDS * 1_000,
    maxEntries: config.MAX_REQUEST_STORE_ENTRIES,
  });
  const registry = new DeviceRegistry(requestStore);
  const tempAudio = new TempAudioService(config.TEMP_AUDIO_DIR, config.TEMP_AUDIO_TTL_SECONDS);
  let publicBaseUrl = config.PUBLIC_BASE_URL.replace(/\/$/, "");
  let cleanupInterval: NodeJS.Timeout | undefined;
  const hermes = new HermesResponsesClient({
    baseUrl: config.HERMES_API_URL,
    apiKey: config.HERMES_API_KEY,
    model: config.HERMES_MODEL,
    conversation: config.HERMES_CONVERSATION,
    softTimeoutMs: config.HERMES_SOFT_TIMEOUT_MS,
    hardTimeoutMs: config.HERMES_HARD_TIMEOUT_MS,
    logger,
  });
  let mobileSockets: MobileWebSocketServer | undefined;
  const p9: P9Runtime | undefined = config.p9.enabled ? createP9Runtime(config.p9, {
    hermes,
    mobileEvents: { sendToUser: (userId, event) => mobileSockets?.sendToUser(userId, event) ?? 0 },
    chatHardTimeoutMs: config.HERMES_HARD_TIMEOUT_MS,
  }) : undefined;

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
    ...(p9 === undefined ? {} : {
      resolveApplicationDevice: (deviceId: string, deviceToken: string) =>
        p9.resolveDeviceBinding(deviceId, deviceToken),
      authorizeApplicationDevice: (binding) => p9.authorizeDeviceBinding(binding),
      onDeviceNotBound: (deviceId: string) => {
        logger.warn({ device_id: deviceId, diagnostic: "DEVICE_NOT_BOUND" }, "device has no application binding");
      },
    }),
    onPlaybackDone: (deviceId, requestId) => removeOutput(deviceId, requestId, false),
    onPlaybackFailed: (deviceId, requestId) => removeOutput(deviceId, requestId, true),
  });
  if (p9) {
    p9.settings.setDeviceSettingsChanged((userId, deviceId) => p9.deviceAdditions.syncSettings(userId, deviceId));
    p9.deviceAdditions.setDeviceEventSender({
      sendToDevice: (deviceId, event) => sockets.sendAdditiveEvent(deviceId, event),
    });
    sockets.setAdditiveHandlers({
      onEvent: (binding, event) => p9.deviceAdditions.handleDeviceEvent(binding, event),
      onAuthenticated: (binding) => p9.deviceAdditions.sendCurrentState(binding),
    });
  }
  mobileSockets = p9 === undefined ? undefined : new MobileWebSocketServer({
    httpServer,
    authenticate: (accessToken) => p9.authenticateMobileSocket(accessToken),
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
  const readiness = new BackendReadinessService({
    hermesBaseUrl: config.HERMES_API_URL,
    audioServiceBaseUrl: config.AUDIO_SERVICE_URL,
    timeoutMs: config.READINESS_PROBE_TIMEOUT_MS,
    ...(p9 === undefined ? {} : { databaseReadiness: () => p9.checkReadiness() }),
  });
  const conversationQueue = new ConversationQueue();
  const pipeline = new VoicePipelineService({
    publicBaseUrl: () => publicBaseUrl,
    tempAudio,
    requestStore,
    sockets,
    ...(mobileSockets === undefined ? {} : { mobileSockets }),
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
    if (p9) {
      try {
        await p9.pollWhatsApp();
      } catch (error) {
        logger.warn({ err: error }, "WhatsApp polling deferred to next maintenance interval");
      }
      try {
        await p9.runScheduler();
      } catch (error) {
        logger.warn({ err: error }, "scheduler/proactive delivery deferred to next maintenance interval");
      }
      try {
        const resumed = await p9.resumePendingChat();
        if (resumed > 0) logger.info({ resumed_operations: resumed }, "resumed pending chat operations");
      } catch (error) {
        logger.warn({ err: error }, "pending chat recovery deferred to next maintenance interval");
      }
      try {
        const cleanup = await p9.reconcileAvatars();
        if (cleanup.removed > 0) {
          logger.info({ removed_files: cleanup.removed }, "removed orphan avatar files");
        }
      } catch (error) {
        logger.warn({ err: error }, "periodic orphan avatar cleanup failed");
      }
    }
  };

  app.use(createHealthRouter({
    hardwareTestMode: config.HARDWARE_TEST_MODE,
    databaseEnabled: p9 !== undefined,
    readiness,
  }));
  if (p9) {
    app.use("/api/v1", p9.router);
    app.use(p9.mediaRouter);
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
      if (p9) await p9.initialize();
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
      p9?.launchPendingChatRecovery((error) => {
        logger.warn({ err: error }, "startup chat recovery deferred to maintenance");
      });
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
      if (mobileSockets) await mobileSockets.close();
      await sockets.close();
      if (p9) await p9.close();
      if (httpServer.listening) {
        await new Promise<void>((resolve, reject) => {
          httpServer.close((error) => (error ? reject(error) : resolve()));
        });
      }
    },
  };
}

function loadP9WifiEncryptionSecret(): void {
  if (process.env.P9_WIFI_ENCRYPTION_KEY || !process.env.P9_WIFI_ENCRYPTION_KEY_FILE) return;
  const key = readFileSync(process.env.P9_WIFI_ENCRYPTION_KEY_FILE, "utf8").trim();
  if (!key) throw new Error("P9 Wi-Fi encryption secret is empty");
  process.env.P9_WIFI_ENCRYPTION_KEY = key;
}

function loadP9ProviderEncryptionSecret(): void {
  if (process.env.P9_PROVIDER_ENCRYPTION_KEY || !process.env.P9_PROVIDER_ENCRYPTION_KEY_FILE) return;
  const key = readFileSync(process.env.P9_PROVIDER_ENCRYPTION_KEY_FILE, "utf8").trim();
  if (!key) throw new Error("P9 provider encryption secret is empty");
  process.env.P9_PROVIDER_ENCRYPTION_KEY = key;
}

function loadSpotifyTokenEncryptionSecret(): void {
  if (process.env.SPOTIFY_TOKEN_ENCRYPTION_KEY || !process.env.SPOTIFY_TOKEN_ENCRYPTION_KEY_FILE) return;
  const key = readFileSync(process.env.SPOTIFY_TOKEN_ENCRYPTION_KEY_FILE, "utf8").trim();
  if (!key) throw new Error("Spotify token encryption secret is empty");
  process.env.SPOTIFY_TOKEN_ENCRYPTION_KEY = key;
}

function loadWhatsAppIdentityResolverSecret(): void {
  if (process.env.WHATSAPP_IDENTITY_RESOLVER_TOKEN || !process.env.WHATSAPP_IDENTITY_RESOLVER_TOKEN_FILE) return;
  const token = readFileSync(process.env.WHATSAPP_IDENTITY_RESOLVER_TOKEN_FILE, "utf8").trim();
  if (!token) throw new Error("WhatsApp identity resolver secret is empty");
  process.env.WHATSAPP_IDENTITY_RESOLVER_TOKEN = token;
}

async function run(): Promise<void> {
  loadP9WifiEncryptionSecret();
  loadP9ProviderEncryptionSecret();
  loadSpotifyTokenEncryptionSecret();
  loadWhatsAppIdentityResolverSecret();
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
