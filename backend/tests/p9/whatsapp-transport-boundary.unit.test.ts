import { readFileSync } from "node:fs";
import { readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const testsDir = dirname(fileURLToPath(import.meta.url));
const backendRoot = join(testsDir, "../..");
const sourceRoot = join(backendRoot, "src");
const launcherPath = join(backendRoot, "../ops/whatsapp/bmo-whatsapp-bridge-launcher");
const managerPath = join(backendRoot, "../ops/whatsapp/bmo-whatsapp-bridge-manager.mjs");
const unitPath = join(backendRoot, "../ops/whatsapp/systemd/bmo-whatsapp-bridge.service");
const pairingUnitPath = join(backendRoot, "../ops/whatsapp/systemd/bmo-whatsapp-pairing-manager.service");
const resolverUnitPath = join(backendRoot, "../ops/whatsapp/systemd/bmo-whatsapp-identity-resolver.service");
const runbookPath = join(backendRoot, "../ops/whatsapp/README.md");

function sourceFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : path.endsWith(".ts") ? [path] : [];
  });
}

describe("WhatsApp transport-only boundary", () => {
  it("has exactly one production GET /messages consumer and it is the BMO client", () => {
    const consumers = sourceFiles(sourceRoot).filter((path) => /["'`]\/messages["'`]/u.test(readFileSync(path, "utf8")));
    expect(consumers.map((path) => relative(sourceRoot, path))).toEqual(["p9/providers/hermes-whatsapp.client.ts"]);
    const server = readFileSync(join(backendRoot, "src/server.ts"), "utf8");
    expect(server.match(/p9\.pollWhatsApp\(\)/gu)).toHaveLength(1);
  });

  it("keeps the dedicated runtime out of the destructive queue and shared Hermes unit", () => {
    const launcher = readFileSync(launcherPath, "utf8");
    const manager = readFileSync(managerPath, "utf8");
    const unit = readFileSync(unitPath, "utf8");
    const pairingUnit = readFileSync(pairingUnitPath, "utf8");
    const runbook = readFileSync(runbookPath, "utf8");
    expect(launcher).not.toMatch(/\/messages/u);
    expect(launcher).toContain("--port 3001");
    expect(launcher).toContain("--session \"$SESSION_DIR\"");
    expect(launcher).toContain("--mode bot");
    expect(launcher).toContain("hermes-agent/scripts/whatsapp-bridge/bridge.js");
    expect(launcher).toContain("scripts/whatsapp-bridge/bridge.js");
    expect(launcher).toContain("[ \"$enabled\" = \"false\" ]");
    expect(launcher).toContain("export WHATSAPP_DM_POLICY=pairing");
    expect(launcher).toContain("export WHATSAPP_FORWARD_OWNER_MESSAGES=true");
    expect(launcher).toContain('export WHATSAPP_ALLOWED_USERS="$allowed"');
    expect(runbook).toContain("personal WhatsApp account");
    expect(runbook).toContain("not a separate bot number");
    expect(launcher).toContain("export WHATSAPP_GROUP_POLICY=disabled");
    expect(unit).not.toMatch(/\/messages/u);
    expect(unit).toContain("bmo-whatsapp-bridge-manager");
    expect(manager).toContain("/connections");
    expect(manager).toContain("--session");
    expect(pairingUnit).toContain("bmo-whatsapp-pairing-manager");
    expect(unit).not.toMatch(/hermes-gateway\.service/u);
    expect(unit).toContain("User=hermes");
    expect(unit).toContain("Restart=on-failure");
    expect(unit).toContain("RestartSec=10s");
    expect(unit).toContain("RestartPreventExitStatus=78");
    expect(unit).toContain("StartLimitIntervalSec=300");
    expect(unit).toContain("StartLimitBurst=5");
    expect(unit).toContain("StandardOutput=null");
    expect(unit).toContain("StandardError=null");
    expect(unit).toContain("[Install]");
    expect(unit).toContain("WantedBy=multi-user.target");
    expect(unit).not.toContain("WatchdogSec=");
    expect(unit).not.toContain("ExecStartPost=");
  });

  it("makes the Backend acceptance runbook fail closed on HTTP or schema errors", () => {
    const runbook = readFileSync(runbookPath, "utf8");
    expect(runbook).not.toContain("set -Eeuo pipefail");
    expect(runbook).toContain("wa_acceptance() {");
    expect(runbook).toContain("return 1");
    expect(runbook).toContain("wa_request()");
    expect(runbook).toContain("backend_request_failed");
    expect(runbook).toContain("case \"$http_code\" in");
    expect(runbook).toContain("jq -e '.connection.status == \"CONNECTED\"");
    expect(runbook).toContain("jq -er '.conversations[0].id'");
    expect(runbook).toContain("backend_api_smoke=pass");
  });

  it("keeps the resolver token argument in the supported separated-value form", () => {
    const unit = readFileSync(resolverUnitPath, "utf8");
    expect(unit).toContain("--token-file %d/resolver-token");
    expect(unit).not.toContain("--token-file=%d/resolver-token");
  });
});
