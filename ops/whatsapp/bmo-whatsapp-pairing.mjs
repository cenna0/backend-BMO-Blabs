#!/usr/bin/env node
/**
 * BMO WhatsApp pairing-code sidecar.
 *
 * Generates WhatsApp 8-digit pairing codes ("Link with phone number instead")
 * on an isolated Baileys socket. The official Hermes bridge.js is launched
 * unchanged; this service never touches the bridge process state except to
 * request one restart after a completed handoff so the bridge adopts the
 * freshly paired credentials.
 *
 * Endpoints (loopback only, consumed by BMO Backend):
 *   GET  /health          - { status, active, paired, uptime }
 *   POST /pairing-code    - { phoneNumber } -> { code, expiresAt }
 *   GET  /pairing-status  - { active, paired, expiresAt }
 *   POST /cancel          - cancel an active pairing attempt
 *
 * No identity-bearing logs: phone numbers and JIDs are never logged.
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
import { existsSync, rmSync, readdirSync, cpSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { readdir } from "node:fs/promises";

const HERMES_HOME = process.env.HERMES_HOME ?? "/home/hermes/.hermes";
const BRIDGE_SESSION_DIR = path.join(HERMES_HOME, "whatsapp", "session");
const SCRATCH_SESSION_DIR = path.join(HERMES_HOME, "whatsapp", "pairing-session");
const BRIDGE_HEALTH_URL = process.env.WHATSAPP_BRIDGE_HEALTH_URL ?? "http://127.0.0.1:3001/health";
const PORT = Number(process.env.PAIRING_PORT ?? 3003);
const HOST = "127.0.0.1";
const PAIRING_TTL_MS = 10 * 60 * 1000;
const REQUEST_COOLDOWN_MS = 30 * 1000;
const MAX_REQUESTS_PER_HOUR = 5;
const BRIDGE_PID_PATTERN = "whatsapp-bridge/bridge.js --port 3001";

const logger = pino({ level: process.env.PAIRING_LOG_LEVEL ?? "warn" });

function normalizePhone(value) {
  if (typeof value !== "string") return null;
  const compact = value.trim().replace(/[\s().-]/gu, "");
  const normalized = compact.startsWith("00")
    ? `+${compact.slice(2)}`
    : compact.startsWith("+")
      ? compact
      : `+${compact}`;
  if (!/^\+[1-9]\d{7,14}$/u.test(normalized)) return null;
  return normalized;
}

async function bridgeHealth() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    const response = await fetch(BRIDGE_HEALTH_URL, { signal: controller.signal });
    if (!response.ok) return null;
    const payload = await response.json();
    return typeof payload?.status === "string" ? payload.status : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const state = {
  // active | paired | null
  phase: null,
  phoneNumber: null,
  code: null,
  expiresAt: null,
  sock: null,
  lastRequestAt: 0,
  requestTimestamps: [],
};

function resetState({ closeSocket = true } = {}) {
  if (closeSocket && state.sock) {
    try { state.sock.end(new Error("pairing cancelled")); } catch {}
  }
  state.sock = null;
  if (state.phase !== "paired") {
    state.phase = null;
    state.code = null;
    state.phoneNumber = null;
    state.expiresAt = null;
  }
  rmSync(SCRATCH_SESSION_DIR, { recursive: true, force: true });
}

function expireIfStale() {
  if (state.phase && state.expiresAt && Date.now() >= state.expiresAt) {
    resetState();
  }
}

function handoffToBridge() {
  if (!existsSync(BRIDGE_SESSION_DIR)) return;
  for (const entry of readdirSync(BRIDGE_SESSION_DIR)) {
    rmSync(path.join(BRIDGE_SESSION_DIR, entry), { recursive: true, force: true });
  }
  cpSync(SCRATCH_SESSION_DIR, BRIDGE_SESSION_DIR, { recursive: true });
  rmSync(SCRATCH_SESSION_DIR, { recursive: true, force: true });
}

async function restartBridge() {
  // Same-UID signal to the bridge process; systemd Restart=on-failure brings
  // it back within RestartSec so it adopts the freshly paired credentials.
  const pids = (await new Promise((resolve) => {
    execFile("pgrep", ["-f", BRIDGE_PID_PATTERN], (error, stdout) => {
      resolve(error ? "" : stdout);
    });
  })).split("\n").map((value) => Number(value.trim())).filter((value) => Number.isInteger(value) && value > 0);
  if (pids.length === 0) {
    logger.warn({ event: "handoff_bridge_not_running" });
    return;
  }
  for (const pid of pids) {
    try { process.kill(pid, "SIGTERM"); } catch {}
  }
  await new Promise((resolve) => setTimeout(resolve, 3000));
  for (const pid of pids) {
    try { process.kill(pid, "SIGKILL"); } catch {}
  }
  logger.info({ event: "handoff_bridge_restart_requested" });
}

async function startPairing(phoneNumber) {
  rmSync(SCRATCH_SESSION_DIR, { recursive: true, force: true });
  const { state: authState, saveCreds } = await useMultiFileAuthState(SCRATCH_SESSION_DIR);
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
      logger.warn({ event: "pairing_timeout" });
      state.phase = null;
      resetState();
    }
  }, PAIRING_TTL_MS);

  const requestLoop = async () => {
    for (let attempt = 0; attempt < 4 && !codeRequested && !finished; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, attempt === 0 ? 750 : 2000));
      if (finished || codeRequested) return;
      try {
        const code = await sock.requestPairingCode(phoneNumber.replace(/^\+/u, ""));
        codeRequested = true;
        state.code = code;
        logger.info({ event: "pairing_code_issued" });
        return;
      } catch {
        logger.warn({ event: "pairing_code_retry" });
      }
    }
    if (!codeRequested && !finished) {
      finished = true;
      clearTimeout(timeout);
      state.phase = null;
      resetState();
    }
  };

  sock.ev.on("creds.update", saveCreds);
  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect } = update;
    if (!codeRequested && !finished && (connection === "connecting" || update.qr)) {
      void requestLoop();
    }
    if (connection === "open" && !finished) {
      finished = true;
      clearTimeout(timeout);
      try {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        await saveCreds();
        handoffToBridge();
        state.phase = "paired";
        state.code = null;
        logger.info({ event: "pairing_succeeded" });
        try { sock.end(new Error("pairing complete")); } catch {}
        state.sock = null;
        await restartBridge();
        setTimeout(() => {
          if (state.phase === "paired") {
            state.phase = null;
            state.phoneNumber = null;
            state.expiresAt = null;
          }
        }, 60_000);
      } catch {
        logger.error({ event: "handoff_failed" });
        state.phase = null;
        resetState({ closeSocket: false });
        try { sock.end(new Error("handoff failed")); } catch {}
      }
    }
    if (connection === "close" && !finished) {
      const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
      finished = true;
      clearTimeout(timeout);
      logger.warn({ event: "pairing_closed" });
      state.phase = null;
      resetState({ closeSocket: false });
      if (reason === DisconnectReason.loggedOut) {
        rmSync(SCRATCH_SESSION_DIR, { recursive: true, force: true });
      }
    }
  });
  await Promise.race([requestLoop(), new Promise((resolve) => setTimeout(resolve, 9000))]);
  return state.code;
}

const app = express();
app.use(express.json({ limit: "4kb" }));

app.get("/health", (_req, res) => {
  expireIfStale();
  res.json({ status: "ok", active: state.phase === "active", paired: state.phase === "paired", uptime: process.uptime() });
});

app.get("/pairing-status", (_req, res) => {
  expireIfStale();
  res.json({
    active: state.phase === "active",
    paired: state.phase === "paired",
    expiresAt: state.phase === "active" ? state.expiresAt : null,
  });
});

app.post("/cancel", (_req, res) => {
  const hadActive = state.phase === "active";
  state.phase = null;
  resetState();
  res.json({ cancelled: hadActive });
});

app.post("/pairing-code", async (req, res) => {
  expireIfStale();
  const phoneNumber = normalizePhone(req.body?.phoneNumber);
  if (!phoneNumber) {
    return res.status(400).json({ error: "INVALID_INPUT" });
  }
  if (state.phase === "paired") {
    return res.status(409).json({ error: "ALREADY_PAIRED" });
  }
  if (state.phase === "active") {
    if (state.phoneNumber === phoneNumber && state.code) {
      return res.json({ code: state.code, expiresAt: state.expiresAt });
    }
    return res.status(409).json({ error: "PAIRING_IN_PROGRESS" });
  }
  const bridgeStatus = await bridgeHealth();
  if (bridgeStatus === null) {
    return res.status(503).json({ error: "BRIDGE_UNAVAILABLE" });
  }
  if (bridgeStatus === "connected") {
    return res.status(409).json({ error: "ALREADY_CONNECTED" });
  }
  const now = Date.now();
  if (now - state.lastRequestAt < REQUEST_COOLDOWN_MS) {
    return res.status(429).json({ error: "RATE_LIMITED" });
  }
  state.requestTimestamps = state.requestTimestamps.filter((ts) => now - ts < 3_600_000);
  if (state.requestTimestamps.length >= MAX_REQUESTS_PER_HOUR) {
    return res.status(429).json({ error: "RATE_LIMITED" });
  }
  state.lastRequestAt = now;
  state.requestTimestamps.push(now);
  try {
    const code = await startPairing(phoneNumber);
    if (!code) {
      return res.status(503).json({ error: "PAIRING_UNAVAILABLE" });
    }
    return res.json({ code, expiresAt: state.expiresAt });
  } catch {
    logger.error({ event: "pairing_error" });
    state.phase = null;
    resetState();
    return res.status(503).json({ error: "PAIRING_UNAVAILABLE" });
  }
});

app.use((_req, res) => res.status(404).json({ error: "NOT_FOUND" }));

app.listen(PORT, HOST, () => {
  logger.info({ event: "pairing_service_listening", port: PORT });
});
