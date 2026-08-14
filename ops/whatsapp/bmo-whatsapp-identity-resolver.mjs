#!/usr/bin/env node

import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { join } from "node:path";
import { readFileSync, readdirSync, statSync } from "node:fs";

const MAX_FILES = 20_000;
const MAX_FILE_BYTES = 256;
const MAX_IDENTIFIERS = 8;
const MAX_BODY_BYTES = 16 * 1024;

function argument(name, fallback = "") {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function normalizeBare(value) {
  const raw = String(value ?? "").trim().replace(/:.*@/u, "@");
  const [bare] = raw.split("@", 1);
  const normalized = bare.replace(/^\+/u, "");
  return /^\d{1,32}$/u.test(normalized) ? normalized : null;
}

export function normalizeProviderIdentity(value, domain) {
  const bare = normalizeBare(value);
  return bare ? `${bare}@${domain}` : null;
}

function addEdge(edges, left, right) {
  if (!left || !right || left === right) return;
  if (!edges.has(left)) edges.set(left, new Set());
  if (!edges.has(right)) edges.set(right, new Set());
  edges.get(left).add(right);
  edges.get(right).add(left);
}

function mappingFiles(sessionDir) {
  let entries;
  try {
    entries = readdirSync(sessionDir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isFile() && /^lid-mapping-\d+(?:_reverse)?\.json$/u.test(entry.name))
    .slice(0, MAX_FILES)
    .map((entry) => entry.name);
}

export function buildIdentityIndex(sessionDir) {
  const edges = new Map();
  let fileCount = 0;
  let reverseFileCount = 0;

  for (const file of mappingFiles(sessionDir)) {
    const reverse = file.endsWith("_reverse.json");
    const match = file.match(/^lid-mapping-(\d+)(?:_reverse)?\.json$/u);
    if (!match) continue;
    let value;
    try {
      const path = join(sessionDir, file);
      const metadata = statSync(path);
      if (metadata.size > MAX_FILE_BYTES || metadata.uid !== process.getuid?.() || (metadata.mode & 0o077) !== 0) continue;
      value = JSON.parse(readFileSync(path, "utf8"));
    } catch {
      continue;
    }
    const fileIdentity = match[1];
    const mappedIdentity = normalizeBare(value);
    if (!mappedIdentity) continue;
    if (reverse) {
      addEdge(edges, normalizeProviderIdentity(fileIdentity, "lid"), normalizeProviderIdentity(mappedIdentity, "s.whatsapp.net"));
      reverseFileCount += 1;
    } else {
      addEdge(edges, normalizeProviderIdentity(fileIdentity, "s.whatsapp.net"), normalizeProviderIdentity(mappedIdentity, "lid"));
    }
    fileCount += 1;
  }

  return { edges, fileCount, reverseFileCount };
}

function normalizeInput(value) {
  const raw = String(value ?? "").trim().replace(/:.*@/u, "@");
  const [bare, domain] = raw.split("@", 2);
  if (!bare || !["s.whatsapp.net", "lid"].includes(domain)) return null;
  return normalizeProviderIdentity(bare, domain);
}

export function expandProviderIdentities(index, values) {
  const result = [];
  const seenGroups = new Set();
  for (const value of values.slice(0, MAX_IDENTIFIERS)) {
    const normalized = normalizeInput(value);
    if (!normalized) continue;
    const group = new Set([normalized]);
    const queue = [normalized];
    while (queue.length > 0) {
      const current = queue.shift();
      for (const next of index.edges.get(current) ?? []) {
        if (!group.has(next)) {
          group.add(next);
          queue.push(next);
        }
      }
    }
    const members = [...group].sort();
    const key = members.join("|");
    if (!seenGroups.has(key)) {
      seenGroups.add(key);
      result.push(members);
    }
  }
  return result;
}

function json(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(body) });
  res.end(body);
}

function authorized(request, token) {
  const supplied = String(request.headers["x-bmo-identity-resolver-token"] ?? "");
  const left = Buffer.from(supplied);
  const right = Buffer.from(token);
  return left.length === right.length && timingSafeEqual(left, right);
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body) > MAX_BODY_BYTES) reject(new Error("body too large"));
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

export function createIdentityResolverServer({ sessionDir, token, port = 3002, host = "127.0.0.1" }) {
  const server = createServer(async (request, response) => {
    if (!request.socket.remoteAddress || !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(request.socket.remoteAddress)) {
      json(response, 403, { error: "LOOPBACK_ONLY" });
      return;
    }
    if (request.method === "GET" && request.url === "/health") {
      const index = buildIdentityIndex(sessionDir);
      json(response, 200, { status: "ok", mappingFiles: index.fileCount, reverseMappingFiles: index.reverseFileCount });
      return;
    }
    if (request.method !== "POST" || request.url !== "/resolve") {
      json(response, 404, { error: "NOT_FOUND" });
      return;
    }
    if (!authorized(request, token)) {
      json(response, 401, { error: "UNAUTHORIZED" });
      return;
    }
    try {
      const payload = JSON.parse(await readBody(request));
      if (!payload || !Array.isArray(payload.identifiers) || payload.identifiers.length > MAX_IDENTIFIERS) {
        json(response, 400, { error: "INVALID_INPUT" });
        return;
      }
      const identifiers = payload.identifiers.map(normalizeInput);
      if (identifiers.some((value) => value === null)) {
        json(response, 400, { error: "INVALID_INPUT" });
        return;
      }
      const index = buildIdentityIndex(sessionDir);
      json(response, 200, { groups: expandProviderIdentities(index, identifiers) });
    } catch {
      json(response, 400, { error: "INVALID_INPUT" });
    }
  });
  server.listen(port, host);
  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const sessionDir = argument("session");
  const tokenFile = argument("token-file");
  if (!sessionDir || !tokenFile) process.exit(78);
  let token;
  try { token = readFileSync(tokenFile, "utf8").trim(); } catch { process.exit(78); }
  if (Buffer.byteLength(token) < 32) process.exit(78);
  const server = createIdentityResolverServer({ sessionDir, token, port: Number(argument("port", "3002")) });
  const stop = () => server.close(() => process.exit(0));
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}
