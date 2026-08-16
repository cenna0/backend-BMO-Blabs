import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { afterEach, expect, it } from "vitest";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

it("loads protected provider secrets before starting the dropped-privilege child", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bmo-p9-entrypoint-secrets-"));
  temporaryDirectories.push(directory);
  const databasePasswordFile = join(directory, "postgres-password");
  const wifiKeyFile = join(directory, "wifi-key");
  const providerKeyFile = join(directory, "provider-key");
  const spotifyKeyFile = join(directory, "spotify-key");
  const spotifyClientIdFile = join(directory, "spotify-client-id");
  const spotifyClientSecretFile = join(directory, "spotify-client-secret");
  const resolverTokenFile = join(directory, "identity-resolver-token");
  await writeFile(databasePasswordFile, "database-password-for-test\n", { mode: 0o600 });
  await writeFile(wifiKeyFile, "wifi-secret-for-test\n", { mode: 0o600 });
  await writeFile(providerKeyFile, "provider-secret-for-test\n", { mode: 0o600 });
  await writeFile(spotifyKeyFile, "spotify-secret-for-test\n", { mode: 0o600 });
  await writeFile(spotifyClientIdFile, "spotify-client-id-for-test\n", { mode: 0o600 });
  await writeFile(spotifyClientSecretFile, "spotify-client-secret-for-test\n", { mode: 0o600 });
  await writeFile(resolverTokenFile, "resolver-token-for-test-01234567890123456789\n", { mode: 0o600 });

  const entrypoint = fileURLToPath(new URL("../../src/p9/entrypoint.ts", import.meta.url));
  const assertion = [
    "if (process.env.P9_WIFI_ENCRYPTION_KEY !== 'wifi-secret-for-test') process.exit(1);",
    "if (process.env.P9_PROVIDER_ENCRYPTION_KEY !== 'provider-secret-for-test') process.exit(1);",
    "if (process.env.SPOTIFY_TOKEN_ENCRYPTION_KEY !== 'spotify-secret-for-test') process.exit(1);",
    "if (process.env.SPOTIFY_CLIENT_ID !== 'spotify-client-id-for-test') process.exit(1);",
    "if (process.env.SPOTIFY_CLIENT_SECRET !== 'spotify-client-secret-for-test') process.exit(1);",
    "if (process.env.WHATSAPP_IDENTITY_RESOLVER_TOKEN !== 'resolver-token-for-test-01234567890123456789') process.exit(1);",
    "if (!process.env.DATABASE_URL) process.exit(1);",
  ].join(" ");
  const child = spawn(process.execPath, ["--import", "tsx", entrypoint, process.execPath, "-e", assertion], {
    env: {
      ...process.env,
      DATABASE_URL: "",
      P9_DATABASE_PASSWORD_FILE: databasePasswordFile,
      P9_WIFI_ENCRYPTION_KEY_FILE: wifiKeyFile,
      P9_PROVIDER_ENCRYPTION_KEY_FILE: providerKeyFile,
      SPOTIFY_TOKEN_ENCRYPTION_KEY_FILE: spotifyKeyFile,
      SPOTIFY_CLIENT_ID_FILE: spotifyClientIdFile,
      SPOTIFY_CLIENT_SECRET_FILE: spotifyClientSecretFile,
      SPOTIFY_TOKEN_ENCRYPTION_KEY: "",
      SPOTIFY_CLIENT_ID: "",
      SPOTIFY_CLIENT_SECRET: "",
      WHATSAPP_IDENTITY_RESOLVER_TOKEN_FILE: resolverTokenFile,
      P9_POSTGRES_USER: "bmo",
      P9_POSTGRES_DB: "bmo",
    },
    stdio: "ignore",
  });

  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code));
  });
  expect(exitCode).toBe(0);
});
