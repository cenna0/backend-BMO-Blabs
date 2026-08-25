#!/usr/bin/env node
/**
 * Connection-scoped WhatsApp pairing sidecar.
 *
 * Each connection gets an isolated Baileys scratch directory and is handed
 * off to the matching bridge-manager session directory after pairing.
 */
import express from "express";
import { Boom } from "@hapi/boom";
import pino from "pino";
import {
  makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
} from "@whiskeysockets/baileys";
import { mkdirSync, rmSync, readdirSync, cpSync } from "node:fs";
import path from "node:path";

const HERMES_HOME = process.env.HERMES_HOME ?? "/home/hermes/.hermes";
const BRIDGE_SESSION_ROOT = process.env.WHATSAPP_SESSIONS_ROOT ?? path.join(HERMES_HOME, "whatsapp", "sessions");
const SCRATCH_SESSION_ROOT = process.env.WHATSAPP_PAIRING_SESSIONS_ROOT ?? path.join(HERMES_HOME, "whatsapp", "pairing-sessions");
const BRIDGE_MANAGER_URL = process.env.WHATSAPP_BRIDGE_MANAGER_URL ?? "http://127.0.0.1:3001";
const PORT = Number(process.env.PAIRING_PORT ?? 3003);
const HOST = "127.0.0.1";
const PAIRING_TTL_MS = 10 * 60 * 1000;
const REQUEST_COOLDOWN_MS = 30 * 1000;
const MAX_REQUESTS_PER_HOUR = 5;
const logger = pino({ level: process.env.PAIRING_LOG_LEVEL ?? "warn" });

export function normalizeConnectionId(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/u.test(value) ? value : null;
}

function normalizePhone(value) {
  if (typeof value !== "string") return null;
  const compact = value.trim().replace(/[\s().-]/gu, "");
  const normalized = compact.startsWith("00") ? `+${compact.slice(2)}` : compact.startsWith("+") ? compact : `+${compact}`;
  return /^\+[1-9]\d{7,14}$/u.test(normalized) ? normalized : null;
}

function bridgeSessionDir(connectionId) {
  return path.join(BRIDGE_SESSION_ROOT, connectionId);
}

function scratchSessionDir(connectionId) {
  return path.join(SCRATCH_SESSION_ROOT, connectionId);
}

async function bridgeHealth(connectionId) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3_000);
  try {
    const response = await fetch(`${BRIDGE_MANAGER_URL}/connections/${encodeURIComponent(connectionId)}/health`, { signal: controller.signal });
    if (!response.ok) return null;
    const payload = await response.json();
    return typeof payload?.status === "string" ? payload.status : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function restartBridge(connectionId) {
  const response = await fetch(`${BRIDGE_MANAGER_URL}/connections/${encodeURIComponent(connectionId)}/restart`, { method: "POST" });
  if (!response.ok) throw new Error("bridge restart failed");
}

function handoffToBridge(connectionId) {
  const bridgeSession = bridgeSessionDir(connectionId);
  const scratchSession = scratchSessionDir(connectionId);
  mkdirSync(bridgeSession, { recursive: true, mode: 0o700 });
  for (const entry of readdirSync(bridgeSession)) rmSync(path.join(bridgeSession, entry), { recursive: true, force: true });
  cpSync(scratchSession, bridgeSession, { recursive: true });
  rmSync(scratchSession, { recursive: true, force: true });
}

function createState(connectionId) {
  return { connectionId, phase: null, phoneNumber: null, code: null, expiresAt: null, sock: null, lastRequestAt: 0, requestTimestamps: [] };
}

const states = new Map();

function stateFor(connectionId) {
  let state = states.get(connectionId);
  if (!state) {
    state = createState(connectionId);
    states.set(connectionId, state);
  }
  return state;
}

function resetState(state, { closeSocket = true } = {}) {
  if (closeSocket && state.sock) {
    try { state.sock.end(new Error("pairing cancelled")); } catch {}
  }
  state.sock = null;
  rmSync(scratchSessionDir(state.connectionId), { recursive: true, force: true });
  if (state.phase !== "paired") {
    state.phase = null;
    state.code = null;
    state.phoneNumber = null;
    state.expiresAt = null;
  }
}

function expireState(state) {
  if (state.phase === "active" && state.expiresAt && Date.now() >= state.expiresAt) resetState(state);
}

async function startPairing(state, phoneNumber) {
  const scratchSession = scratchSessionDir(state.connectionId);
  rmSync(scratchSession, { recursive: true, force: true });
  const { state: authState, saveCreds } = await useMultiFileAuthState(scratchSession);
  let version;
  try {
    const fetched = await fetchLatestBaileysVersion();
    version = Array.isArray(fetched?.version) ? fetched.version : undefined;
  } catch {
    version = undefined;
  }
  const sock = makeWASocket({
    ...(version ? { version } : {}),
    auth: authState,
    logger,
    printQRInTerminal: false,
    browser: ["Hermes Agent", "Chrome", "120.0"],
    syncFullHistory: false,
    markOnlineOnConnect: false,
    getMessage: async () => ({ conversation: "" }),
  });
  state.sock = sock;
  state.phase = "active";
  state.phoneNumber = phoneNumber;
  state.expiresAt = new Date(Date.now() + PAIRING_TTL_MS).toISOString();
  state.code = null;
  let codeRequested = false;
  let finished = false;
  const timeout = setTimeout(() => {
    if (!finished) {
      finished = true;
      resetState(state);
    }
  }, PAIRING_TTL_MS);
  const requestLoop = async () => {
    for (let attempt = 0; attempt < 4 && !codeRequested && !finished; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, attempt === 0 ? 750 : 2_000));
      if (finished || codeRequested) return;
      try {
        state.code = await sock.requestPairingCode(phoneNumber.replace(/^\+/u, ""));
        codeRequested = true;
        return;
      } catch {
        // Retry without logging provider identity.
      }
    }
    if (!codeRequested && !finished) {
      finished = true;
      clearTimeout(timeout);
      resetState(state);
    }
  };
  sock.ev.on("creds.update", saveCreds);
  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect } = update;
    if (!codeRequested && !finished && (connection === "connecting" || update.qr)) void requestLoop();
    if (connection === "open" && !finished) {
      finished = true;
      clearTimeout(timeout);
      try {
        await new Promise((resolve) => setTimeout(resolve, 1_500));
        await saveCreds();
        handoffToBridge(state.connectionId);
        state.phase = "paired";
        state.code = null;
        try { sock.end(new Error("pairing complete")); } catch {}
        state.sock = null;
        await restartBridge(state.connectionId);
        setTimeout(() => {
          if (state.phase === "paired") {
            state.phase = null;
            state.phoneNumber = null;
            state.expiresAt = null;
            states.delete(state.connectionId);
          }
        }, 60_000);
      } catch {
        resetState(state, { closeSocket: false });
        try { sock.end(new Error("handoff failed")); } catch {}
      }
    }
    if (connection === "close" && !finished) {
      const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
      finished = true;
      clearTimeout(timeout);
      resetState(state, { closeSocket: false });
      if (reason === DisconnectReason.loggedOut) rmSync(scratchSessionDir(state.connectionId), { recursive: true, force: true });
    }
  });
  await Promise.race([requestLoop(), new Promise((resolve) => setTimeout(resolve, 9_000))]);
  return state.code;
}

const app = express();
app.use(express.json({ limit: "4kb" }));

app.get("/health", (_request, response) => {
  const active = [...states.values()].filter((state) => state.phase === "active").length;
  const paired = [...states.values()].filter((state) => state.phase === "paired").length;
  response.json({ status: "ok", active, paired, uptime: process.uptime() });
});

app.get("/pairing-status", (request, response) => {
  const connectionId = normalizeConnectionId(request.query.connectionId);
  if (!connectionId) return response.status(400).json({ error: "INVALID_INPUT" });
  const state = stateFor(connectionId);
  expireState(state);
  response.json({ active: state.phase === "active", paired: state.phase === "paired", expiresAt: state.phase === "active" ? state.expiresAt : null });
});

app.post("/cancel", (request, response) => {
  const connectionId = normalizeConnectionId(request.body?.connectionId);
  if (!connectionId) return response.status(400).json({ error: "INVALID_INPUT" });
  const state = stateFor(connectionId);
  const hadActive = state.phase === "active";
  resetState(state);
  response.json({ cancelled: hadActive });
});

app.post("/pairing-code", async (request, response) => {
  const connectionId = normalizeConnectionId(request.body?.connectionId);
  const phoneNumber = normalizePhone(request.body?.phoneNumber);
  if (!connectionId || !phoneNumber) return response.status(400).json({ error: "INVALID_INPUT" });
  const state = stateFor(connectionId);
  expireState(state);
  if (state.phase === "paired") return response.status(409).json({ error: "ALREADY_PAIRED" });
  if (state.phase === "active") {
    if (state.phoneNumber === phoneNumber && state.code) return response.json({ code: state.code, expiresAt: state.expiresAt });
    return response.status(409).json({ error: "PAIRING_IN_PROGRESS" });
  }
  const bridgeStatus = await bridgeHealth(connectionId);
  if (bridgeStatus === null) return response.status(503).json({ error: "BRIDGE_UNAVAILABLE" });
  if (bridgeStatus === "connected") return response.status(409).json({ error: "ALREADY_CONNECTED" });
  const now = Date.now();
  if (now - state.lastRequestAt < REQUEST_COOLDOWN_MS) return response.status(429).json({ error: "RATE_LIMITED" });
  state.requestTimestamps = state.requestTimestamps.filter((timestamp) => now - timestamp < 3_600_000);
  if (state.requestTimestamps.length >= MAX_REQUESTS_PER_HOUR) return response.status(429).json({ error: "RATE_LIMITED" });
  state.lastRequestAt = now;
  state.requestTimestamps.push(now);
  try {
    const code = await startPairing(state, phoneNumber);
    if (!code) return response.status(503).json({ error: "PAIRING_UNAVAILABLE" });
    return response.json({ code, expiresAt: state.expiresAt });
  } catch {
    resetState(state);
    return response.status(503).json({ error: "PAIRING_UNAVAILABLE" });
  }
});

app.use((_request, response) => response.status(404).json({ error: "NOT_FOUND" }));

if (import.meta.url === `file://${process.argv[1]}`) {
  mkdirSync(BRIDGE_SESSION_ROOT, { recursive: true, mode: 0o700 });
  mkdirSync(SCRATCH_SESSION_ROOT, { recursive: true, mode: 0o700 });
  app.listen(PORT, HOST);
}
