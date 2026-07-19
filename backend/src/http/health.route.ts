import { Router } from "express";

export function createHealthRouter(hardwareTestMode: boolean): Router {
  const router = Router();
  router.get("/health", (_request, response) => {
    if (hardwareTestMode) {
      response.json({
        status: "ok",
        backend: "ok",
        hermes: "bypassed",
        audio_service: "bypassed",
        rvc: "bypassed",
      });
      return;
    }
    response.json({
      status: "degraded",
      backend: "ok",
      hermes: "configured",
      audio_service: "configured",
      rvc: "delegated_to_audio_service",
    });
  });
  return router;
}
