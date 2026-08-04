import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";

function loadDatabaseUrlFromSecret(): void {
  if (process.env.DATABASE_URL || !process.env.P9_DATABASE_PASSWORD_FILE) return;
  const password = readFileSync(process.env.P9_DATABASE_PASSWORD_FILE, "utf8").trim();
  if (!password) throw new Error("P9 database password secret is empty");
  const user = process.env.P9_POSTGRES_USER ?? "bmo";
  const database = process.env.P9_POSTGRES_DB ?? "bmo";
  process.env.DATABASE_URL = `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@postgres:5432/${encodeURIComponent(database)}`;
}

loadDatabaseUrlFromSecret();
const setgid = process.setgid;
const setuid = process.setuid;
if (typeof process.getuid === "function" && process.getuid() === 0 && setgid && setuid) {
  setgid(Number(process.env.P9_RUNTIME_GID ?? "1000"));
  setuid(Number(process.env.P9_RUNTIME_UID ?? "1000"));
}
const [command, ...args] = process.argv.slice(2);
if (!command) throw new Error("P9 candidate entrypoint requires a command");
const child = spawn(command, args, { stdio: "inherit", env: process.env });
child.once("error", (error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
child.once("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
