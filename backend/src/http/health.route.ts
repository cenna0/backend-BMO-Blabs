import { Router, type Response } from "express";

import type {
  BackendReadinessPort,
  BackendReadinessState,
} from "../services/readiness.service.js";

interface HealthRouterOptions {
  hardwareTestMode: boolean;
  databaseEnabled?: boolean;
  readiness: BackendReadinessPort;
}

const unavailable: BackendReadinessState = {
  hermesReady: false,
  audioReady: false,
};

function sendReadiness(
  response: Response,
  state: BackendReadinessState,
  databaseEnabled: boolean,
): void {
  const databaseReady = !databaseEnabled || state.databaseReady === true;
  const ready = state.hermesReady && state.audioReady && databaseReady;
  response.status(ready ? 200 : 503).json({
    status: ready ? "ok" : "error",
    backend: "ok",
    hermes: state.hermesReady ? "ok" : "error",
    audio_service: state.audioReady ? "ok" : "error",
    ...(databaseEnabled ? { database: databaseReady ? "ok" : "error" } : {}),
  });
}

export function createHealthRouter(options: HealthRouterOptions): Router {
  const router = Router();

  router.get("/livez", (_request, response) => {
    response.json({
      status: "ok",
      backend: "ok",
    });
  });

  const readinessHandler = async (_request: unknown, response: Response) => {
    if (options.hardwareTestMode) {
      response.json({
        status: "ok",
        backend: "ok",
        hermes: "bypassed",
        audio_service: "bypassed",
        ...(options.databaseEnabled === true ? { database: "bypassed" } : {}),
      });
      return;
    }

    try {
      sendReadiness(response, await options.readiness.check(), options.databaseEnabled === true);
    } catch {
      sendReadiness(response, unavailable, options.databaseEnabled === true);
    }
  };

  router.get("/readyz", readinessHandler);
  router.get("/health", readinessHandler);
  return router;
}
