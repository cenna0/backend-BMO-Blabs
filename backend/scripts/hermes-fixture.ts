import { createServer, type IncomingMessage, type Server } from "node:http";
import { fileURLToPath } from "node:url";

export interface HermesFixtureRequestLog {
  event: "hermes_fixture_request";
  model: unknown;
  conversation: unknown;
  store: unknown;
  stream: unknown;
  truncation: unknown;
  input_length: number | null;
  instructions_present: boolean;
}

export interface HermesFixtureOptions {
  host?: string;
  port?: number;
  expectedKey?: string;
  outputText?: string;
  onRequest?: (log: HermesFixtureRequestLog) => void;
}

function readBody(request: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("error", reject);
    request.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

export function createHermesFixtureServer(options: HermesFixtureOptions = {}): Server {
  const host = options.host ?? "127.0.0.1";
  const expectedKey = options.expectedKey ?? "fixture-hermes-key";
  const outputText =
    options.outputText ??
    "Hi! **BMO** heard you clearly. BMO is ready to help with tomorrow's meeting.";

  return createServer(async (request, response) => {
    const path = new URL(request.url ?? "/", `http://${host}`).pathname;
    if (request.method !== "POST" || path !== "/v1/responses") {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "not_found" }));
      return;
    }
    if (request.headers.authorization !== `Bearer ${expectedKey}`) {
      response.writeHead(401, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "unauthorized" }));
      return;
    }

    try {
      const payload = JSON.parse((await readBody(request)).toString("utf8")) as Record<string, unknown>;
      const log: HermesFixtureRequestLog = {
        event: "hermes_fixture_request",
        model: payload.model,
        conversation: payload.conversation,
        store: payload.store,
        stream: payload.stream,
        truncation: payload.truncation,
        input_length: typeof payload.input === "string" ? payload.input.length : null,
        instructions_present: typeof payload.instructions === "string" && payload.instructions.length > 0,
      };
      options.onRequest?.(log);
      process.stdout.write(`${JSON.stringify(log)}\n`);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          id: "resp_fixture_p4",
          status: "completed",
          output: [
            { type: "function_call", name: "ignored_tool", arguments: "{}" },
            {
              type: "message",
              content: [{ type: "output_text", text: outputText }],
            },
          ],
        }),
      );
    } catch {
      response.writeHead(400, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "invalid_json" }));
    }
  });
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isDirectRun) {
  const host = process.env.HERMES_FIXTURE_HOST ?? "127.0.0.1";
  const port = Number(process.env.HERMES_FIXTURE_PORT ?? "8642");
  const options: HermesFixtureOptions = {
    host,
    port,
  };
  if (process.env.HERMES_FIXTURE_API_KEY) options.expectedKey = process.env.HERMES_FIXTURE_API_KEY;
  if (process.env.HERMES_FIXTURE_OUTPUT) options.outputText = process.env.HERMES_FIXTURE_OUTPUT;
  const server = createHermesFixtureServer(options);

  server.listen(port, host, () => {
    process.stdout.write(`${JSON.stringify({ event: "hermes_fixture_ready", base_url: `http://${host}:${port}` })}\n`);
  });

  const shutdown = async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  };

  process.once("SIGINT", () => {
    void shutdown().finally(() => process.exit(0));
  });
  process.once("SIGTERM", () => {
    void shutdown().finally(() => process.exit(0));
  });
}
