import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function setup(): { env: NodeJS.ProcessEnv; statePath: string; cleanup: () => void } {
  const directory = mkdtempSync(join(tmpdir(), "p9-npm-wrapper-test-"));
  const workspace = join(directory, "p9-acceptance");
  mkdirSync(workspace);
  chmodSync(workspace, 0o700);
  const statePath = join(workspace, "fixture-state.json");
  const inputDirectory = join(directory, "inputs");
  mkdirSync(inputDirectory);
  for (const name of ["postgres-password", "acceptance-password", "runtime.env"]) {
    const path = join(inputDirectory, name);
    writeFileSync(path, "synthetic-test-only\n", { mode: 0o600 });
    chmodSync(path, 0o600);
  }
  const dockerDirectory = join(directory, "bin");
  mkdirSync(dockerDirectory);
  const dockerPath = join(dockerDirectory, "docker");
  writeFileSync(dockerPath, `#!/usr/bin/env node
const fs = require("node:fs");
const { spawn } = require("node:child_process");
const serverPidPath = process.env.P9_FAKE_SERVER_PID_FILE;
const args = process.argv.slice(2);
const last = args.at(-1) || "";
function startFakeServer() {
  const child = spawn(process.execPath, ["-e", \
    "const http=require('node:http'); const server=http.createServer((req,res)=>{res.setHeader('content-type','application/json'); if(req.url==='/api/v1/ops/db/readyz') {res.statusCode=200; res.end(JSON.stringify({status:'ok',database:'ready'})); return;} if(req.url==='/api/v1/ops/db/identity') {res.statusCode=200; res.end(JSON.stringify({database:'bmo_restore_acceptance_test'})); return;} res.statusCode=404; res.end();}); server.listen(3025,'127.0.0.1');"], { detached: true, stdio: "ignore" });
  child.unref();
  fs.writeFileSync(serverPidPath, String(child.pid));
}
function stopFakeServer() {
  if (!serverPidPath || !fs.existsSync(serverPidPath)) return;
  try { process.kill(Number(fs.readFileSync(serverPidPath, "utf8"))); } catch {}
  try { fs.unlinkSync(serverPidPath); } catch {}
}
if (args[0] === "network" && args[1] === "inspect") {
  const format = args[2] === "--format" ? args[3] || "" : "";
  if (format.includes("{{json .Name}}") && last === "bmo-p9-1-restore-acceptance-transport") { process.stdout.write("[]\\n"); process.stderr.write("error: no such object: " + last + "\\n"); process.exit(1); }
  if (last === "bmo-p9-1-restore-acceptance-transport" && !format) { process.stderr.write("No such network\\n"); process.exit(1); }
  if (format.includes("{{json .}}")) {
    if (last === "bmo-p9-1_p9_private") process.stdout.write(JSON.stringify({Name:last, Driver:"bridge", Internal:true, Containers:{}}));
    else process.stdout.write(JSON.stringify({Name:last, Driver:"bridge", Internal:false, Containers:{proxy:{Name:"bmo-p9-1-restore-acceptance-proxy"}}}));
  }
  process.exit(0);
}
if (args[0] === "inspect" && args[1] === "--format") {
  const format = args[2] || "";
  if (last === "bmo-p9-1-backend-1") process.stdout.write("bmo-p9.1-candidate:test\\n");
  else if (format.includes("{{json .Name}}")) { process.stdout.write("[]\\n"); process.stderr.write("error: no such object: " + last + "\\n"); process.exit(1); }
  else if (format.includes(".NetworkSettings.Ports")) process.stdout.write("running|" + JSON.stringify({"3010/tcp":[{HostIp:"127.0.0.1",HostPort:"3025"}]}) + "\\n");
  else if (format.includes(".NetworkSettings.Networks")) process.stdout.write(JSON.stringify({"bmo-p9-1_p9_private":{}}));
  else if (format.includes(".Config.Image")) process.stdout.write("running|bmo-p9.1-candidate:test\\n");
  else process.stdout.write("running|0\\n");
  process.exit(0);
}
if (args[0] === "inspect") { process.stderr.write("No such container\\n"); process.exit(1); }
if (args[0] === "exec") {
  if (args.includes("printenv")) process.stdout.write(args.includes("P9_POSTGRES_DB") ? "bmo_restore_acceptance_test\\n" : "true\\n");
  else process.stdout.write("1\\n");
  process.exit(0);
}
if (args[0] === "rm") { stopFakeServer(); process.exit(0); }
if (args[0] === "network" && args[1] === "connect") process.exit(0);
if (args[0] === "network" && args[1] === "create") { process.stdout.write("network-id\\n"); process.exit(0); }
if (args[0] === "network" && args[1] === "rm") { stopFakeServer(); process.exit(0); }
if (args[0] === "run") {
  if (args.includes("-e")) startFakeServer();
  if (args.includes("fixture-create")) {
    const pending = JSON.parse(fs.readFileSync(process.env.P9_ACCEPTANCE_STATE_FILE, "utf8"));
    process.stdout.write(JSON.stringify({ state: { ...pending, userId: "11111111-1111-1111-1111-111111111111" } }) + "\\n");
  } else if (args.includes("fixture-status")) process.stdout.write("fixture-present\\n");
  else if (args.includes("fixture-cleanup")) process.stdout.write("fixture-cleaned\\n");
  else if (args.includes("evidence-snapshot")) process.stdout.write("{\\"User\\":50}\\n");
  else process.stdout.write("container-id\\n");
  process.exit(0);
}
process.exit(0);
`, { mode: 0o700 });
  chmodSync(dockerPath, 0o700);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${dockerDirectory}:${process.env.PATH ?? ""}`,
    P9_ACCEPTANCE_DATABASE: "bmo_restore_acceptance_test",
    P9_ACCEPTANCE_PORT: "3025",
    P9_ACCEPTANCE_BIND_HOST: "127.0.0.1",
    P9_ACCEPTANCE_NETWORK: "bmo-p9-1_p9_private",
    P9_ACCEPTANCE_PROJECT: "bmo-p9-1-restore-acceptance",
    P9_ACCEPTANCE_CONTAINER: "bmo-p9-1-restore-acceptance-runtime",
    P9_ACCEPTANCE_POSTGRES_CONTAINER: "bmo-p9-1-postgres-1",
    P9_ACCEPTANCE_IMAGE: "bmo-p9.1-candidate:test",
    P9_ACCEPTANCE_CODE_DIR: process.cwd(),
    P9_ACCEPTANCE_MIGRATIONS_DISABLED: "true",
    P9_POSTGRES_USER: "bmo",
    P9_POSTGRES_PASSWORD_FILE: join(inputDirectory, "postgres-password"),
    P9_ACCEPTANCE_PASSWORD_FILE: join(inputDirectory, "acceptance-password"),
    P9_ACCEPTANCE_RUNTIME_ENV_FILE: join(inputDirectory, "runtime.env"),
    P9_ACCEPTANCE_STATE_FILE: statePath,
  };
  const serverPidPath = join(directory, "fake-server.pid");
  env.P9_FAKE_SERVER_PID_FILE = serverPidPath;
  return {
    env,
    statePath,
    cleanup: () => {
      if (existsSync(serverPidPath)) {
        try { process.kill(Number(readFileSync(serverPidPath, "utf8"))); } catch {}
      }
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

function runScript(script: string, env: NodeJS.ProcessEnv) {
  return spawnSync("npm", ["run", script], { cwd: process.cwd(), env, encoding: "utf8" });
}

describe("documented P9 acceptance npm wrappers", () => {
  it("executes every harmless lifecycle wrapper exactly through the explicit entrypoint", () => {
    const fixture = setup();
    try {
      expect(runScript("p9:acceptance:runtime:validate-config", fixture.env)).toMatchObject({ status: 0 });
      expect(runScript("p9:acceptance:fixture:validate-config", fixture.env)).toMatchObject({ status: 0 });
      expect(runScript("p9:acceptance:fixture:status", fixture.env)).toMatchObject({ status: 0 });
      const runtimeStart = runScript("p9:acceptance:runtime:start", fixture.env);
      expect(runtimeStart, runtimeStart.stdout + runtimeStart.stderr).toMatchObject({ status: 0 });
      const runtimeStatus = runScript("p9:acceptance:runtime:status", fixture.env);
      expect(runtimeStatus, runtimeStatus.stdout + runtimeStatus.stderr).toMatchObject({ status: 0 });
      expect(runScript("p9:acceptance:fixture:create", fixture.env)).toMatchObject({ status: 0 });
      expect(existsSync(fixture.statePath)).toBe(true);
      expect(runScript("p9:acceptance:fixture:status", fixture.env)).toMatchObject({ status: 0 });
      expect(runScript("p9:acceptance:evidence:snapshot", fixture.env)).toMatchObject({ status: 0 });
      expect(runScript("p9:acceptance:fixture:cleanup", fixture.env)).toMatchObject({ status: 0 });
      expect(existsSync(fixture.statePath)).toBe(false);
      expect(readdirSync(join(fixture.statePath, ".."))).toEqual([]);
      expect(runScript("p9:acceptance:runtime:stop", fixture.env)).toMatchObject({ status: 0 });

      writeFileSync(fixture.statePath, JSON.stringify({ version: 1, database: "bmo_restore_acceptance_test", runId: "run-1234", userId: null, email: "p9-acceptance-run-1234@example.invalid", providerSubject: "p9-acceptance:run-1234", displayName: "P9 restore acceptance fixture run-1234" }) + "\n", { mode: 0o600 });
      const runner = runScript("p9:acceptance:run", fixture.env);
      expect(runner.status).toBe(1);
      expect(runner.stdout + runner.stderr).toContain("pending");
    } finally {
      fixture.cleanup();
    }
  }, 60000);
});
