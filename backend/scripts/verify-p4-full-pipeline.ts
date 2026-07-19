import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { AddressInfo } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { runFakeEsp32 } from "./fake-esp32.js";
import { createHermesFixtureServer, type HermesFixtureRequestLog } from "./hermes-fixture.js";

const backendDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const rootDir = resolve(backendDir, "..");
const audioDir = join(rootDir, "audio-service");
const outputDir = join(audioDir, "temp", "p4-full-pipeline");
const outputMp3 = join(outputDir, "pipeline-output.mp3");
const token = "p4-full-pipeline-token";
const deviceToken = "test-device-secret";
const useRealHermes = process.env.P4_USE_REAL_HERMES === "1";
const hermesKey = process.env.HERMES_API_KEY ?? (useRealHermes ? "p4-local-hermes-key" : "fixture-hermes-key");
const hermesUrl = process.env.HERMES_API_URL ?? "http://127.0.0.1:8642";

interface ManagedProcess {
  name: string;
  process: ChildProcessWithoutNullStreams;
  stdout: string[];
  stderr: string[];
}

function spawnManaged(
  name: string,
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
): ManagedProcess {
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env,
    windowsHide: true,
  });
  const managed: ManagedProcess = { name, process: child, stdout: [], stderr: [] };
  child.stdout.on("data", (chunk: Buffer) => managed.stdout.push(chunk.toString("utf8")));
  child.stderr.on("data", (chunk: Buffer) => managed.stderr.push(chunk.toString("utf8")));
  return managed;
}

async function waitUrl(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await fetch(url, { signal: AbortSignal.timeout(2_000) });
      return;
    } catch (error) {
      if (error instanceof TypeError || error instanceof DOMException) {
        await new Promise((resolveWait) => setTimeout(resolveWait, 250));
        continue;
      }
      return;
    }
  }
  throw new Error(`timed out waiting for ${url}`);
}

async function listen(server: Server, host: string, port: number): Promise<number> {
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(port, host, () => {
      server.off("error", rejectListen);
      resolveListen();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("server did not bind");
  return (address as AddressInfo).port;
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolveClose, rejectClose) => {
    server.close((error) => (error ? rejectClose(error) : resolveClose()));
  });
}

async function stopManaged(managed: ManagedProcess): Promise<void> {
  if (managed.process.exitCode !== null) return;
  managed.process.kill();
  await new Promise<void>((resolveStop) => {
    const timer = setTimeout(resolveStop, 2_000);
    managed.process.once("exit", () => {
      clearTimeout(timer);
      resolveStop();
    });
  });
}

async function readIncomingBody(request: IncomingMessage): Promise<Buffer> {
  return await new Promise<Buffer>((resolveRead, rejectRead) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("error", rejectRead);
    request.on("end", () => resolveRead(Buffer.concat(chunks)));
  });
}

function forwardedHeaders(request: IncomingMessage): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(request.headers)) {
    if (key === "host" || key === "connection" || key === "content-length") continue;
    if (typeof value === "string") headers[key] = value;
  }
  return headers;
}

interface AudioProxyEvidence {
  stt_response: unknown;
  tts_request: unknown;
}

function createAudioRecorderProxy(targetBaseUrl: string, evidence: AudioProxyEvidence): Server {
  return createServer(async (request, response) => {
    try {
      const body = await readIncomingBody(request);
      const path = new URL(request.url ?? "/", targetBaseUrl).pathname;
      if (path === "/tts/synthesize") {
        try {
          evidence.tts_request = JSON.parse(body.toString("utf8"));
        } catch {
          evidence.tts_request = { parse_error: true };
        }
      }
      const init: RequestInit = {
        method: request.method ?? "GET",
        headers: forwardedHeaders(request),
      };
      if (body.length > 0) init.body = body;
      const upstream = await fetch(`${targetBaseUrl.replace(/\/$/, "")}${request.url ?? "/"}`, {
        ...init,
      });
      const upstreamBody = Buffer.from(await upstream.arrayBuffer());
      if (path === "/stt/transcribe") {
        try {
          evidence.stt_response = JSON.parse(upstreamBody.toString("utf8"));
        } catch {
          evidence.stt_response = { parse_error: true };
        }
      }
      response.writeHead(upstream.status, Object.fromEntries(upstream.headers.entries()));
      response.end(upstreamBody);
    } catch (error) {
      response.writeHead(502, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "audio_proxy_failed" }));
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    }
  });
}

function lines(chunks: string[]): string[] {
  return chunks
    .join("")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function parsePipelineLog(stdout: string[]): unknown {
  return lines(stdout)
    .map((line) => {
      try {
        return JSON.parse(line) as Record<string, unknown>;
      } catch {
        return null;
      }
    })
    .find((line) => line?.msg === "voice pipeline completed");
}

async function main(): Promise<void> {
  await mkdir(outputDir, { recursive: true });
  const hermesRequests: HermesFixtureRequestLog[] = [];
  const hermes = useRealHermes
    ? null
    : createHermesFixtureServer({
        host: "127.0.0.1",
        port: 8642,
        expectedKey: hermesKey,
        onRequest: (log) => hermesRequests.push(log),
      });
  const managed: ManagedProcess[] = [];
  let audioProxy: Server | null = null;
  const audioProxyEvidence: AudioProxyEvidence = {
    stt_response: null,
    tts_request: null,
  };
  try {
    if (hermes) {
      await listen(hermes, "127.0.0.1", 8642);
    } else {
      await waitUrl(`${hermesUrl.replace(/\/$/, "")}/v1/models`, 30_000);
    }
    const audioPython = join(audioDir, ".venv", "Scripts", "python.exe");
    const audio = spawnManaged(
      "audio-service",
      audioPython,
      ["-m", "uvicorn", "app.main:create_app", "--factory", "--host", "127.0.0.1", "--port", "8001", "--log-level", "info"],
      {
        cwd: audioDir,
        env: {
          ...process.env,
          INTERNAL_SERVICE_TOKEN: token,
          HF_HOME: join(audioDir, "models", "hf-cache"),
          TORCH_HOME: join(audioDir, "models", "torch-cache"),
          XDG_CACHE_HOME: join(audioDir, "temp", "cache"),
          HF_HUB_OFFLINE: "1",
          TTS_TEMP_DIR: join(audioDir, "temp", "p4-full-tts-work"),
          RVC_MODEL_PATH: join(audioDir, "models", "rvc-bmo", "assets", "CGO_e420_s2520.pth"),
          RVC_INDEX_PATH: join(audioDir, "models", "rvc-bmo", "assets", "added_IVF69_Flat_nprobe_1_CGO_v2.index"),
        },
      },
    );
    managed.push(audio);
    await waitUrl("http://127.0.0.1:8001/health", 30_000);
    audioProxy = createAudioRecorderProxy("http://127.0.0.1:8001", audioProxyEvidence);
    const audioProxyPort = await listen(audioProxy, "127.0.0.1", 8002);

    const backend = spawnManaged("backend", process.execPath, ["dist/src/server.js"], {
      cwd: backendDir,
      env: {
        ...process.env,
        NODE_ENV: "development",
        BACKEND_HOST: "127.0.0.1",
        BACKEND_PORT: "3000",
        PUBLIC_BASE_URL: "http://127.0.0.1:3000",
        DEVICE_ID: "bmo-001",
        DEVICE_TOKEN: deviceToken,
        TEMP_AUDIO_DIR: join(backendDir, "temp-audio", "p4-full-pipeline"),
        HARDWARE_TEST_MODE: "false",
        HARDWARE_TEST_MP3_PATH: join(backendDir, "tests", "fixtures", "test-response.mp3"),
        AUDIO_SERVICE_URL: `http://127.0.0.1:${audioProxyPort}`,
        INTERNAL_SERVICE_TOKEN: token,
        HERMES_API_URL: hermesUrl,
        HERMES_API_KEY: hermesKey,
        HERMES_MODEL: "hermes-agent",
        HERMES_CONVERSATION: "bmo-001",
        HERMES_SOFT_TIMEOUT_MS: "30000",
        HERMES_HARD_TIMEOUT_MS: "180000",
        TOTAL_PIPELINE_TIMEOUT_MS: "300000",
      },
    });
    managed.push(backend);
    await waitUrl("http://127.0.0.1:3000/health", 30_000);

    const wav = await readFile(join(audioDir, "temp", "real-inference-fixtures", "english.wav"));
    const fakeStarted = performance.now();
    const fake = await runFakeEsp32({
      baseUrl: "http://127.0.0.1:3000",
      deviceId: "bmo-001",
      deviceToken,
      requestId: "550e8400-e29b-41d4-a716-446655440000",
      wav,
      timeoutMs: 240_000,
      outputMp3Path: outputMp3,
    });
    const fakeElapsedSeconds = Math.round(performance.now() - fakeStarted) / 1_000;
    const ffprobe = await new Promise<string>((resolveProbe, rejectProbe) => {
      const child = spawn(
        "ffprobe",
        [
          "-v",
          "error",
          "-show_entries",
          "stream=codec_name,sample_rate,channels,bit_rate",
          "-show_entries",
          "format=duration,bit_rate",
          "-of",
          "json",
          outputMp3,
        ],
        { windowsHide: true },
      );
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
      child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
      child.on("exit", (code) => {
        if (code === 0) resolveProbe(Buffer.concat(stdout).toString("utf8"));
        else rejectProbe(new Error(Buffer.concat(stderr).toString("utf8") || `ffprobe exited ${code}`));
      });
    });
    const audioHealth = await (await fetch("http://127.0.0.1:8001/health")).json();
    const backendHealth = await (await fetch("http://127.0.0.1:3000/health")).json();
    const hermesModels = useRealHermes
      ? await (
          await fetch(`${hermesUrl.replace(/\/$/, "")}/v1/models`, {
            headers: { authorization: `Bearer ${hermesKey}` },
          })
        ).json()
      : null;
    const result = {
      pass: true,
      hermes_mode: useRealHermes ? "real-local" : "fixture",
      fake_elapsed_seconds: fakeElapsedSeconds,
      fake,
      ffprobe: JSON.parse(ffprobe) as unknown,
      output_mp3: outputMp3,
      audio_health_after: audioHealth,
      backend_health: backendHealth,
      hermes_requests: hermesRequests,
      hermes_models: hermesModels,
      audio_proxy: audioProxyEvidence,
      pipeline_log: parsePipelineLog(backend.stdout),
      audio_service_log_tail: lines(audio.stderr).slice(-20),
      backend_log_tail: lines(backend.stdout).slice(-20),
    };
    await writeFile(join(outputDir, "result.json"), JSON.stringify(result, null, 2) + "\n", "utf8");
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally {
    await Promise.all(managed.reverse().map(stopManaged));
    if (audioProxy) {
      await closeServer(audioProxy);
    }
    if (hermes) {
      await closeServer(hermes);
    }
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
