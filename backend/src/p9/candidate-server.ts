import { readFileSync } from "node:fs";
import express from "express";

import { parseP9Config } from "./config.js";
import { createP9Runtime } from "./index.js";

function loadDatabaseUrlFromSecret(): void {
  if (process.env.DATABASE_URL || !process.env.P9_DATABASE_PASSWORD_FILE) return;
  const password = readFileSync(process.env.P9_DATABASE_PASSWORD_FILE, "utf8").trim();
  if (!password) throw new Error("P9 database password secret is empty");
  const user = process.env.P9_POSTGRES_USER ?? "bmo";
  const database = process.env.P9_POSTGRES_DB ?? "bmo";
  process.env.DATABASE_URL = `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@postgres:5432/${encodeURIComponent(database)}`;
}

loadDatabaseUrlFromSecret();
const config = parseP9Config(process.env);
if (!config.enabled) throw new Error("P9 candidate requires P9_ENABLED=true");

const runtime = createP9Runtime(config, { includeOps: true });
const app = express();
app.disable("x-powered-by");
app.use("/api/v1", runtime.router);

const host = process.env.P9_BIND_HOST ?? "127.0.0.1";
const port = Number(process.env.P9_BIND_PORT ?? "3010");
const server = app.listen(port, host, () => {
  process.stdout.write(`p9 candidate listening on ${host}:${port}\n`);
});

async function shutdown(): Promise<void> {
  await runtime.close();
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

process.once("SIGINT", () => void shutdown().then(() => process.exit(0)));
process.once("SIGTERM", () => void shutdown().then(() => process.exit(0)));
