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
if (!process.env.P9_WIFI_ENCRYPTION_KEY && process.env.P9_WIFI_ENCRYPTION_KEY_FILE) {
  const key = readFileSync(process.env.P9_WIFI_ENCRYPTION_KEY_FILE, "utf8").trim();
  if (!key) throw new Error("P9 Wi-Fi encryption secret is empty");
  process.env.P9_WIFI_ENCRYPTION_KEY = key;
}
if (!process.env.P9_PROVIDER_ENCRYPTION_KEY && process.env.P9_PROVIDER_ENCRYPTION_KEY_FILE) {
  const key = readFileSync(process.env.P9_PROVIDER_ENCRYPTION_KEY_FILE, "utf8").trim();
  if (!key) throw new Error("P9 provider encryption secret is empty");
  process.env.P9_PROVIDER_ENCRYPTION_KEY = key;
}
if (!process.env.SPOTIFY_TOKEN_ENCRYPTION_KEY && process.env.SPOTIFY_TOKEN_ENCRYPTION_KEY_FILE) {
  const key = readFileSync(process.env.SPOTIFY_TOKEN_ENCRYPTION_KEY_FILE, "utf8").trim();
  if (!key) throw new Error("Spotify token encryption secret is empty");
  process.env.SPOTIFY_TOKEN_ENCRYPTION_KEY = key;
}
if (!process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_ID_FILE) {
  const clientId = readFileSync(process.env.SPOTIFY_CLIENT_ID_FILE, "utf8").trim();
  if (!clientId) throw new Error("Spotify client ID secret is empty");
  process.env.SPOTIFY_CLIENT_ID = clientId;
}
if (!process.env.SPOTIFY_CLIENT_SECRET && process.env.SPOTIFY_CLIENT_SECRET_FILE) {
  const clientSecret = readFileSync(process.env.SPOTIFY_CLIENT_SECRET_FILE, "utf8").trim();
  if (!clientSecret) throw new Error("Spotify client secret is empty");
  process.env.SPOTIFY_CLIENT_SECRET = clientSecret;
}
if (!process.env.WHATSAPP_IDENTITY_RESOLVER_TOKEN && process.env.WHATSAPP_IDENTITY_RESOLVER_TOKEN_FILE) {
  const resolverToken = readFileSync(process.env.WHATSAPP_IDENTITY_RESOLVER_TOKEN_FILE, "utf8").trim();
  if (!resolverToken) throw new Error("WhatsApp identity resolver secret is empty");
  process.env.WHATSAPP_IDENTITY_RESOLVER_TOKEN = resolverToken;
}
const config = parseP9Config(process.env);
if (!config.enabled) throw new Error("P9 candidate requires P9_ENABLED=true");

const runtime = createP9Runtime(config, { includeOps: true });
await runtime.initialize();
const app = express();
app.disable("x-powered-by");
app.set("trust proxy", Number(process.env.TRUST_PROXY_HOPS ?? "0"));
app.use("/api/v1", runtime.router);
app.use(runtime.mediaRouter);

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
