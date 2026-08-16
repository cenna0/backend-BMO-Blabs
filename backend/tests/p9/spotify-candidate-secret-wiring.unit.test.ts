import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { describe, expect, it } from "vitest";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const overridePath = new URL("../../../ops/spotify/p9.1-secrets.override.yml", import.meta.url);
const guardPath = new URL("../../../ops/spotify/verify-secret-files.sh", import.meta.url);
const candidateEnvPath = new URL("../../../.env.p9.1.example", import.meta.url);
const execFileAsync = promisify(execFile);

describe("Spotify candidate secret wiring", () => {
  it("uses protected read-only secret mounts, clears plaintext fallbacks, and fixes the callback", async () => {
    const compose = await readFile(overridePath, "utf8");
    const candidateEnv = await readFile(candidateEnvPath, "utf8");
    const callback = "http://127.0.0.1:4310/api/v1/integrations/spotify/callback";

    expect(compose).toContain("SPOTIFY_CLIENT_ID_FILE: /run/secrets/spotify_client_id");
    expect(compose).toContain("SPOTIFY_CLIENT_SECRET_FILE: /run/secrets/spotify_client_secret");
    expect(compose).toContain("SPOTIFY_TOKEN_ENCRYPTION_KEY_FILE: /run/secrets/spotify_token_encryption_key");
    expect(compose).toContain(`SPOTIFY_CALLBACK_URL: ${callback}`);
    expect(compose.match(/mode: 0400/gu)).toHaveLength(3);
    expect(compose).toMatch(/SPOTIFY_CLIENT_ID:\s*""/u);
    expect(compose).toMatch(/SPOTIFY_CLIENT_SECRET:\s*""/u);
    expect(compose).toMatch(/SPOTIFY_TOKEN_ENCRYPTION_KEY:\s*""/u);
    expect(compose).toContain("file: ${SPOTIFY_CLIENT_ID_FILE:?");
    expect(compose).toContain("file: ${SPOTIFY_CLIENT_SECRET_FILE:?");
    expect(compose).toContain("file: ${SPOTIFY_TOKEN_ENCRYPTION_KEY_FILE:?");
    expect(candidateEnv).toContain("SPOTIFY_TOKEN_ENCRYPTION_KEY_FILE=/opt/bmo/config/p9.1/spotify-token-encryption-key");
    expect(candidateEnv).toContain(`SPOTIFY_CALLBACK_URL=${callback}`);
    expect(candidateEnv).not.toContain("https://api.personalbmo.web.id");
    expect(compose).not.toMatch(/SPOTIFY_(?:CLIENT_ID|CLIENT_SECRET|TOKEN_ENCRYPTION_KEY):\s*\$\{/u);
    expect(compose.toLowerCase()).not.toContain("caddy");
  });

  it("guards host-file permissions and exact callback without reading secret contents into output", async () => {
    const guard = await readFile(guardPath, "utf8");

    expect(guard).toContain("SPOTIFY_CLIENT_ID_FILE");
    expect(guard).toContain("SPOTIFY_CLIENT_SECRET_FILE");
    expect(guard).toContain("SPOTIFY_TOKEN_ENCRYPTION_KEY_FILE");
    expect(guard).toContain("http://127.0.0.1:4310/api/v1/integrations/spotify/callback");
    expect(guard).toContain("0177");
    expect(guard).toContain("07000");
    expect(guard).not.toMatch(/\b(?:cat|xxd|base64)\b/u);
    expect(guard).not.toMatch(/printf[^\n]*(?:CLIENT_SECRET|ENCRYPTION_KEY|CLIENT_ID)/u);
  });

  it("accepts 0600 files and rejects broader permissions or a different callback", async () => {
    const directory = await mkdtemp("/tmp/bmo-spotify-secret-wiring-");
    const files = {
      SPOTIFY_CLIENT_ID_FILE: `${directory}/client-id`,
      SPOTIFY_CLIENT_SECRET_FILE: `${directory}/client-secret`,
      SPOTIFY_TOKEN_ENCRYPTION_KEY_FILE: `${directory}/token-key`,
    };
    try {
      await Promise.all(Object.values(files).map((path) => writeFile(path, "protected-test-value\n", { mode: 0o600 })));
      const baseEnv = { ...process.env, ...files, SPOTIFY_CALLBACK_URL: "http://127.0.0.1:4310/api/v1/integrations/spotify/callback" };
      await expect(execFileAsync("bash", [fileURLToPath(guardPath)], { env: baseEnv })).resolves.toBeTruthy();

      await chmod(files.SPOTIFY_CLIENT_SECRET_FILE, 0o640);
      await expect(execFileAsync("bash", [fileURLToPath(guardPath)], { env: baseEnv })).rejects.toBeTruthy();

      await chmod(files.SPOTIFY_CLIENT_SECRET_FILE, 0o600);
      await expect(execFileAsync("bash", [fileURLToPath(guardPath)], { env: { ...baseEnv, SPOTIFY_CALLBACK_URL: "http://127.0.0.1:3010/api/v1/integrations/spotify/callback" } })).rejects.toBeTruthy();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
