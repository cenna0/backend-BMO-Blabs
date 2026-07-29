import { Router, type Response } from "express";

import type {
  BackendReadinessPort,
  BackendReadinessState,
} from "../services/readiness.service.js";

interface HealthRouterOptions {
  hardwareTestMode: boolean;
  readiness: BackendReadinessPort;
}

const unavailable: BackendReadinessState = {
  hermesReady: false,
  audioReady: false,
  rvcAvailable: false,
};

function sendReadiness(response: Response, state: BackendReadinessState): void {
  const ready = state.hermesReady && state.audioReady;
  response.status(ready ? 200 : 503).json({
    status: ready ? (state.rvcAvailable ? "ok" : "degraded") : "error",
    backend: "ok",
    hermes: state.hermesReady ? "ok" : "error",
    audio_service: state.audioReady ? "ok" : "error",
    rvc: state.rvcAvailable ? "available" : "unavailable",
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
        rvc: "bypassed",
      });
      return;
    }

    try {
      sendReadiness(response, await options.readiness.check());
    } catch {
      sendReadiness(response, unavailable);
    }
  };

  router.get("/readyz", readinessHandler);
  router.get("/health", readinessHandler);
  return router;
}
