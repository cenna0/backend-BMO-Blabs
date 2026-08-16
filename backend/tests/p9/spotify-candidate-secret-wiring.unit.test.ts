import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { describe, expect, it } from "vitest";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const overridePath = new URL("../../../ops/spotify/p9.1-secrets.override.yml", import.meta.url);
const guardPath = new URL("../../../ops/spotify/verify-secret-files.sh", import.meta.url);
const candidateEnvGuardPath = new URL("../../../ops/spotify/verify-candidate-env.sh", import.meta.url);
const candidateEnvPath = new URL("../../../.env.p9.1.example", import.meta.url);
const whatsappOverridePath = new URL("../../../ops/whatsapp/p9.1-identity-resolver.override.yml", import.meta.url);
const runbookPath = new URL("../../../docs/integration/10-OPERATOR-PROMPT-RUNBOOK.md", import.meta.url);
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
    expect(candidateEnv).toContain("P9_COMPOSE_ENV_FILE=/opt/bmo/config/p9.1/compose.env");
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

  it("defines one persistent env path and preserves both provider overrides for Backend preparation", async () => {
    const runbook = await readFile(runbookPath, "utf8");
    const whatsapp = await readFile(whatsappOverridePath, "utf8");
    const canonicalEnv = "/opt/bmo/config/p9.1/compose.env";
    const sourceEnv = "/tmp/bmo-p9-1-validation-20260804/compose.env";
    const whatsappOverride = "-f /opt/bmo/app/ops/whatsapp/p9.1-identity-resolver.override.yml";
    const spotifyOverride = "-f /opt/bmo/app/ops/spotify/p9.1-secrets.override.yml";
    const fencedCommand = (marker: string) => {
      const markerIndex = runbook.indexOf(marker);
      const commandStart = runbook.indexOf("```bash", markerIndex);
      const commandEnd = runbook.indexOf("```", commandStart + 7);
      return runbook.slice(commandStart, commandEnd);
    };

    expect(runbook).toContain(`export P9_COMPOSE_ENV_FILE=${canonicalEnv}`);
    expect(runbook.replaceAll(/\s+/gu, " ")).toContain(`install -o bmo-admin -g bmo-admin -m 0600 \\ ${sourceEnv} \\ ${canonicalEnv}`);
    expect(runbook).not.toContain("P9_COMPOSE_ENV_FILE=/tmp/");
    expect(runbook).toContain("/opt/bmo/app/ops/spotify/verify-candidate-env.sh");
    expect(runbook).toContain("http://127.0.0.1:4310/api/v1/integrations/spotify/callback");
    expect(runbook).toContain("-L 4310:127.0.0.1:3010");

    const renderCommand = fencedCommand("Set the immutable candidate image reference");
    expect(renderCommand).toContain(whatsappOverride);
    expect(renderCommand).toContain(spotifyOverride);

    const postgresCommand = fencedCommand("start only candidate PostgreSQL");
    expect(postgresCommand).toContain("-f /opt/bmo/app/p9.1-compose.yml");
    expect(postgresCommand).not.toContain("/ops/");

    const migrationCommand = fencedCommand("Apply Prisma migration with the base file only");
    expect(migrationCommand).toContain("-f /opt/bmo/app/p9.1-compose.yml");
    expect(migrationCommand).not.toContain("/ops/");

    const recreateCommand = fencedCommand("Recreate only the candidate Backend with both overrides");
    expect(recreateCommand).toContain(whatsappOverride);
    expect(recreateCommand).toContain(spotifyOverride);

    expect(whatsapp).toContain("WHATSAPP_IDENTITY_RESOLVER_URL: http://127.0.0.1:3002");
    expect(whatsapp).toContain("WHATSAPP_IDENTITY_RESOLVER_TOKEN_FILE: /run/secrets/whatsapp_identity_resolver_token");
    expect(whatsapp).toContain("- whatsapp_identity_resolver_token");
  });

  it("defines a read-only canonical env-file guard without printing contents", async () => {
    const guard = await readFile(candidateEnvGuardPath, "utf8");

    expect(guard).toContain("/opt/bmo/config/p9.1/compose.env");
    expect(guard).toContain("0177");
    expect(guard).toContain("07000");
    expect(guard).not.toMatch(/(?:^|[;&|]\s*)(?:cat|printenv|env)\s/u);
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
