import { readFileSync } from "node:fs";

export function loadP9DatabaseUrlFromSecret(env: NodeJS.ProcessEnv): void {
  if (env.DATABASE_URL || !env.P9_DATABASE_PASSWORD_FILE) return;
  const password = readFileSync(env.P9_DATABASE_PASSWORD_FILE, "utf8").trim();
  if (!password) throw new Error("P9 database password secret is empty");
  const user = env.P9_POSTGRES_USER ?? "bmo";
  const database = env.P9_POSTGRES_DB ?? "bmo";
  env.DATABASE_URL = `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@postgres:5432/${encodeURIComponent(database)}`;
}
