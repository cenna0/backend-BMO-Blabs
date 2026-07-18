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
      hermes: "not_integrated",
      audio_service: "not_integrated",
      rvc: "not_integrated",
    });
  });
  return router;
}
