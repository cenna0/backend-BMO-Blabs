import { deepStrictEqual, equal, match, ok } from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createBridgeManager, loadHermesTransportEnvironment, normalizeConnectionId } from "./bmo-whatsapp-bridge-manager.mjs";

function response(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

test("accepts only safe connection identifiers", () => {
  equal(normalizeConnectionId("00000000-0000-4000-8000-000000000001"), "00000000-0000-4000-8000-000000000001");
  equal(normalizeConnectionId("../../escape"), null);
  equal(normalizeConnectionId(""), null);
});

test("fails closed unless Hermes transport configuration is disabled and bot-scoped", () => {
  const root = mkdtempSync(join(tmpdir(), "bmo-whatsapp-env-"));
  writeFileSync(join(root, ".env"), "WHATSAPP_ENABLED=false\nWHATSAPP_MODE=bot\nWHATSAPP_ALLOWED_USERS=123@s.whatsapp.net\n", { mode: 0o600 });
  const environment = loadHermesTransportEnvironment(root);
  equal(environment.WHATSAPP_MODE, "bot");
  equal(environment.WHATSAPP_ALLOWED_USERS, "123@s.whatsapp.net");

  writeFileSync(join(root, ".env"), "WHATSAPP_ENABLED=true\nWHATSAPP_MODE=bot\n", { mode: 0o600 });
  expectThrow(() => loadHermesTransportEnvironment(root));
});

function expectThrow(callback) {
  try {
    callback();
  } catch {
    return;
  }
  throw new Error("expected callback to throw");
}

test("isolates bridge process ports and session directories per connection", async (t) => {
  const sessionRoot = mkdtempSync(join(tmpdir(), "bmo-whatsapp-manager-"));
  const children = [];
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push({ url, init });
    return response({ status: "connected", queueLength: 0, scriptHash: "hash" });
  };
  const manager = createBridgeManager({
    sessionRoot,
    bridgeScript: "/opt/hermes/bridge.js",
    nodeBin: "/opt/hermes/node",
    portBase: 4100,
    fetcher,
    spawnImpl: (_node, args) => {
      const child = { args, kill: () => undefined, once: () => child };
      children.push(child);
      return child;
    },
    waitForReadyMs: 0,
  });
  t.after(() => manager.close());

  await manager.request("connection-a", "/health");
  await manager.request("connection-b", "/health");

  equal(children.length, 2);
  match(children[0].args.join(" "), /--port 4100/);
  match(children[1].args.join(" "), /--port 4101/);
  ok(children[0].args.some((value) => value.endsWith("/connection-a")));
  ok(children[1].args.some((value) => value.endsWith("/connection-b")));
  deepStrictEqual(calls.map((call) => call.url), [
    "http://127.0.0.1:4100/health",
    "http://127.0.0.1:4101/health",
  ]);
});
