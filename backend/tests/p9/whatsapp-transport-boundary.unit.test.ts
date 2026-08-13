import { readFileSync } from "node:fs";
import { readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const testsDir = dirname(fileURLToPath(import.meta.url));
const backendRoot = join(testsDir, "../..");
const sourceRoot = join(backendRoot, "src");
const launcherPath = join(backendRoot, "../ops/whatsapp/bmo-whatsapp-bridge-launcher");
const unitPath = join(backendRoot, "../ops/whatsapp/systemd/bmo-whatsapp-bridge.service");

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
  });

  it("keeps the dedicated runtime out of the destructive queue and shared Hermes unit", () => {
    const launcher = readFileSync(launcherPath, "utf8");
    const unit = readFileSync(unitPath, "utf8");
    expect(launcher).not.toMatch(/\/messages/u);
    expect(launcher).toContain("--port 3001");
    expect(launcher).toContain("--session \"$SESSION_DIR\"");
    expect(launcher).toContain("--mode bot");
    expect(launcher).toContain("hermes-agent/scripts/whatsapp-bridge/bridge.js");
    expect(launcher).toContain("scripts/whatsapp-bridge/bridge.js");
    expect(launcher).toContain("[ \"$enabled\" = \"false\" ]");
    expect(launcher).toContain("export WHATSAPP_DM_POLICY=allowlist");
    expect(launcher).toContain("export WHATSAPP_GROUP_POLICY=disabled");
    expect(unit).not.toMatch(/\/messages/u);
    expect(unit).not.toMatch(/hermes-gateway\.service/u);
    expect(unit).toContain("User=hermes");
    expect(unit).toContain("Restart=on-failure");
    expect(unit).toContain("RestartSec=10s");
    expect(unit).toContain("RestartPreventExitStatus=78");
    expect(unit).toContain("StartLimitIntervalSec=300");
    expect(unit).toContain("StartLimitBurst=5");
    expect(unit).toContain("StandardOutput=null");
    expect(unit).toContain("StandardError=null");
    expect(unit).not.toContain("WatchdogSec=");
    expect(unit).not.toContain("ExecStartPost=");
  });
});
