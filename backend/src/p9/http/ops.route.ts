import { Router } from "express";

import { P9Repositories } from "../db/repositories.js";
import { asyncP9 } from "./middleware.js";

export function createOpsRouter(repositories: P9Repositories): Router {
  const router = Router();
  router.get("/ops/db/livez", asyncP9(async (_request, response) => {
    try {
      await repositories.healthCheck();
      response.json({ status: "ok", database: "ok" });
    } catch {
      response.status(503).json({ status: "error", database: "unavailable" });
    }
  }));
  router.get("/ops/db/readyz", asyncP9(async (_request, response) => {
    try {
      await repositories.healthCheck();
      const migrations = await repositories.migrationStatus();
      const ready = migrations.length > 0 && migrations.every((migration) => migration.finishedAt !== null);
      response.status(ready ? 200 : 503).json({ status: ready ? "ok" : "error", database: ready ? "ready" : "migrations_pending", migration_count: migrations.length });
    } catch {
      response.status(503).json({ status: "error", database: "unavailable" });
    }
  }));
  router.get("/ops/db/migrations", asyncP9(async (_request, response) => {
    try {
      const migrations = await repositories.migrationStatus();
      response.json({ migrations: migrations.map((migration) => ({ name: migration.name, finished: migration.finishedAt !== null })) });
    } catch {
      response.status(503).json({ error: "DATABASE_UNAVAILABLE" });
    }
  }));
  return router;
}
