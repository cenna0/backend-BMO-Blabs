#!/usr/bin/env node

import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";

const HOST = "127.0.0.1";
const MAX_BODY_BYTES = 8 * 1024;
const ALLOWED_PROXY_PATHS = new Set(["/health", "/messages", "/send", "/logout", "/qr"]);

function argument(name, fallback = "") {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

export function normalizeConnectionId(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,128}$/u.test(value)) return null;
  return value;
}

export function connectionSessionPath(sessionRoot, connectionId) {
  const normalized = normalizeConnectionId(connectionId);
  if (!normalized) return null;
  return join(sessionRoot, normalized);
}

function loopback(request) {
  return request.socket.remoteAddress && ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(request.socket.remoteAddress);
}

function json(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(body) });
  response.end(body);
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    let settled = false;
    request.on("data", (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body) > MAX_BODY_BYTES && !settled) {
        settled = true;
        reject(new Error("body too large"));
      }
    });
    request.on("end", () => {
      if (!settled) resolve(body);
    });
    request.on("error", (error) => {
      if (!settled) reject(error);
    });
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readHermesEnvValue(file, key) {
  const lines = readFileSync(file, "utf8").split(/\r?\n/u);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.startsWith(`${key}=`)) continue;
    let value = line.slice(key.length + 1).trim();
    if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) value = value.slice(1, -1);
    return value;
  }
  return "";
}

export function loadHermesTransportEnvironment(hermesHome) {
  const file = join(hermesHome, ".env");
  const enabled = readHermesEnvValue(file, "WHATSAPP_ENABLED");
  const mode = readHermesEnvValue(file, "WHATSAPP_MODE");
  const allowed = readHermesEnvValue(file, "WHATSAPP_ALLOWED_USERS");
  if (enabled !== "false" || mode !== "bot" || /[\s*,*]/u.test(allowed)) throw new Error("invalid Hermes WhatsApp transport configuration");
  const environment = { ...process.env };
  delete environment.WHATSAPP_ALLOWED_USERS;
  return {
    ...environment,
    HOME: join(hermesHome, ".."),
    HERMES_HOME: hermesHome,
    WHATSAPP_ENABLED: "false",
    WHATSAPP_MODE: "bot",
    WHATSAPP_DM_POLICY: "pairing",
    WHATSAPP_FORWARD_OWNER_MESSAGES: "true",
    WHATSAPP_GROUP_POLICY: "disabled",
    WHATSAPP_SEND_READ_RECEIPTS: "false",
    ...(allowed ? { WHATSAPP_ALLOWED_USERS: allowed } : {}),
  };
}

export function createBridgeManager({
  sessionRoot,
  bridgeScript,
  nodeBin,
  portBase = 3101,
  fetcher = fetch,
  spawnImpl = spawn,
  waitForReadyMs = 5_000,
  environment = null,
} = {}) {
  if (!sessionRoot || !bridgeScript || !nodeBin) throw new Error("bridge manager requires sessionRoot, bridgeScript, and nodeBin");
  mkdirSync(sessionRoot, { recursive: true, mode: 0o700 });
  const processes = new Map();
  let nextPort = portBase;
  const childEnvironment = environment ?? { ...process.env, WHATSAPP_MODE: "bot", WHATSAPP_DM_POLICY: "pairing", WHATSAPP_FORWARD_OWNER_MESSAGES: "true", WHATSAPP_GROUP_POLICY: "disabled", WHATSAPP_SEND_READ_RECEIPTS: "false" };

  function start(connectionId) {
    const normalized = normalizeConnectionId(connectionId);
    if (!normalized) throw new Error("invalid connection id");
    const current = processes.get(normalized);
    if (current) return current;
    const port = nextPort;
    nextPort += 1;
    const sessionDir = connectionSessionPath(sessionRoot, normalized);
    mkdirSync(sessionDir, { recursive: true, mode: 0o700 });
    const child = spawnImpl(nodeBin, [bridgeScript, "--port", String(port), "--session", sessionDir, "--mode", "bot"], {
      cwd: childEnvironment.HERMES_HOME ?? process.env.HERMES_HOME ?? "/home/hermes/.hermes",
      env: childEnvironment,
      stdio: "ignore",
    });
    const entry = { connectionId: normalized, port, sessionDir, child };
    processes.set(normalized, entry);
    child.on?.("exit", () => {
      if (processes.get(normalized)?.child === child) processes.delete(normalized);
    });
    child.on?.("error", () => {
      if (processes.get(normalized)?.child === child) processes.delete(normalized);
    });
    return entry;
  }

  function stop(connectionId) {
    const normalized = normalizeConnectionId(connectionId);
    if (!normalized) return;
    const entry = processes.get(normalized);
    if (!entry) return;
    processes.delete(normalized);
    try { entry.child.kill?.("SIGTERM"); } catch {}
  }

  async function request(connectionId, path, init = {}) {
    const normalized = normalizeConnectionId(connectionId);
    if (!normalized || !ALLOWED_PROXY_PATHS.has(path)) throw new Error("invalid bridge request");
    const entry = start(normalized);
    const deadline = Date.now() + waitForReadyMs;
    let lastError;
    while (true) {
      try {
        const response = await fetcher(`http://${HOST}:${entry.port}${path}`, {
          ...init,
          headers: { accept: "application/json", ...(init.body ? { "content-type": "application/json" } : {}), ...(init.headers ?? {}) },
        });
        if (response.status !== 503 || Date.now() >= deadline) return response;
      } catch (error) {
        lastError = error;
        if (Date.now() >= deadline) throw lastError;
      }
      await sleep(100);
    }
  }

  async function restart(connectionId) {
    stop(connectionId);
    await sleep(250);
    return start(connectionId);
  }

  async function handle(requestObject, response) {
    if (!loopback(requestObject)) return json(response, 403, { error: "LOOPBACK_ONLY" });
    if (requestObject.method === "GET" && requestObject.url === "/health") {
      return json(response, 200, { status: "ok", activeConnections: processes.size });
    }
    const match = requestObject.url?.match(/^\/connections\/([^/]+)(\/health|\/messages|\/send|\/logout|\/qr|\/restart)$/u);
    if (!match) return json(response, 404, { error: "NOT_FOUND" });
    const connectionId = decodeURIComponent(match[1]);
    const path = match[2];
    if (!normalizeConnectionId(connectionId)) return json(response, 400, { error: "INVALID_INPUT" });
    if (path === "/restart") {
      await restart(connectionId);
      return json(response, 200, { status: "restarted" });
    }
    try {
      const body = requestObject.method === "POST" ? await readBody(requestObject) : "";
      const upstream = await request(connectionId, path, {
        method: requestObject.method,
        ...(body ? { body } : {}),
      });
      const payload = Buffer.from(await upstream.arrayBuffer());
      response.writeHead(upstream.status, { "content-type": upstream.headers.get("content-type") ?? "application/json", "content-length": payload.length });
      response.end(payload);
      if (path === "/logout" && upstream.ok) stop(connectionId);
    } catch {
      json(response, 503, { error: "BRIDGE_UNAVAILABLE" });
    }
  }

  const server = createServer((requestObject, response) => {
    void handle(requestObject, response).catch(() => json(response, 503, { error: "BRIDGE_UNAVAILABLE" }));
  });

  return {
    server,
    request,
    start,
    stop,
    restart,
    close() {
      for (const connectionId of processes.keys()) stop(connectionId);
      server.close();
    },
  };
}

function discoverBridgeScript(hermesHome) {
  const candidates = [
    join(hermesHome, "hermes-agent/scripts/whatsapp-bridge/bridge.js"),
    join(hermesHome, "scripts/whatsapp-bridge/bridge.js"),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? "";
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const hermesHome = process.env.HERMES_HOME ?? "/home/hermes/.hermes";
  const sessionRoot = argument("sessions-root", process.env.WHATSAPP_SESSIONS_ROOT ?? join(hermesHome, "whatsapp/sessions"));
  const bridgeScript = argument("bridge-script", process.env.WHATSAPP_BRIDGE_SCRIPT ?? discoverBridgeScript(hermesHome));
  const nodeBin = argument("node", process.env.WHATSAPP_NODE_BIN ?? join(hermesHome, "node/bin/node"));
  if (!bridgeScript || !existsSync(nodeBin)) process.exit(78);
  let environment;
  try {
    environment = loadHermesTransportEnvironment(hermesHome);
  } catch {
    process.exit(78);
  }
  const manager = createBridgeManager({ sessionRoot, bridgeScript, nodeBin, environment, portBase: Number(argument("port-base", "3101")) });
  manager.server.listen(Number(argument("port", "3001")), HOST);
  const stop = () => manager.close();
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}
