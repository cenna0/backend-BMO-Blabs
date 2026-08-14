import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";

function loadSecretFromFile(valueName: string, fileName: string, emptyMessage: string): void {
  if (process.env[valueName] || !process.env[fileName]) return;
  const value = readFileSync(process.env[fileName]!, "utf8").trim();
  if (!value) throw new Error(emptyMessage);
  process.env[valueName] = value;
}

function loadDatabaseUrlFromSecret(): void {
  if (process.env.DATABASE_URL || !process.env.P9_DATABASE_PASSWORD_FILE) return;
  const password = readFileSync(process.env.P9_DATABASE_PASSWORD_FILE, "utf8").trim();
  if (!password) throw new Error("P9 database password secret is empty");
  const user = process.env.P9_POSTGRES_USER ?? "bmo";
  const database = process.env.P9_POSTGRES_DB ?? "bmo";
  const socketDirectory = process.env.P9_POSTGRES_SOCKET_DIR?.trim();
  if (socketDirectory) {
    process.env.DATABASE_URL = `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@localhost/${encodeURIComponent(database)}?host=${encodeURIComponent(socketDirectory)}`;
    return;
  }
  const host = process.env.P9_POSTGRES_HOST ?? "postgres";
  const port = process.env.P9_POSTGRES_PORT ?? "5432";
  process.env.DATABASE_URL = `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${encodeURIComponent(database)}`;
}

loadSecretFromFile("P9_WIFI_ENCRYPTION_KEY", "P9_WIFI_ENCRYPTION_KEY_FILE", "P9 Wi-Fi encryption secret is empty");
loadSecretFromFile("P9_PROVIDER_ENCRYPTION_KEY", "P9_PROVIDER_ENCRYPTION_KEY_FILE", "P9 provider encryption secret is empty");
loadSecretFromFile("SPOTIFY_CLIENT_ID", "SPOTIFY_CLIENT_ID_FILE", "Spotify client ID secret is empty");
loadSecretFromFile("SPOTIFY_CLIENT_SECRET", "SPOTIFY_CLIENT_SECRET_FILE", "Spotify client secret is empty");
loadSecretFromFile("WHATSAPP_IDENTITY_RESOLVER_TOKEN", "WHATSAPP_IDENTITY_RESOLVER_TOKEN_FILE", "WhatsApp identity resolver secret is empty");
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
