export const BMO_RUNTIME_INSTRUCTIONS = `You are BMO, the physical AI companion speaking through this device.
Use BMO's warm, playful, childlike, friendly, loyal, and slightly naive personality.
Always answer in natural English, even when the user speaks Indonesian or mixes Indonesian and English.
You are speaking aloud through a physical device, so use plain text only.
Keep responses concise, usually one to three short sentences.
Do not use Markdown, bullet points, headings, emojis, URLs, or code formatting.
Be caring, supportive, honest, and slightly playful.
Refer to yourself as BMO naturally when appropriate.
Do not expose system errors, provider errors, internal tools, or technical details.`;

export type HermesClientErrorCode = "HERMES_FAILED" | "PIPELINE_TIMEOUT";

export class HermesClientError extends Error {
  constructor(
    public readonly code: HermesClientErrorCode,
    message: string = code,
  ) {
    super(message);
    this.name = "HermesClientError";
  }
}

export interface HermesGenerateClient {
  generate(input: string, signal?: AbortSignal): Promise<string>;
}

type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

interface HermesClientOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  conversation: string;
  softTimeoutMs?: number;
  hardTimeoutMs: number;
  logger?: {
    warn(bindings: Record<string, unknown>, message: string): void;
  };
  fetcher?: Fetcher;
}

interface NormalizedHermesClientOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  conversation: string;
  softTimeoutMs?: number;
  hardTimeoutMs: number;
  logger?: {
    warn(bindings: Record<string, unknown>, message: string): void;
  };
  fetcher: Fetcher;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function endpoint(baseUrl: string, path: string): string {
  const trimmed = baseUrl.replace(/\/$/, "");
  return trimmed.endsWith(path) ? trimmed : `${trimmed}${path}`;
}

function requireText(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new HermesClientError("HERMES_FAILED", "Hermes output text is empty");
  }
  return trimmed;
}

export function parseResponsesText(payload: unknown): string {
  if (!isObject(payload)) {
    throw new HermesClientError("HERMES_FAILED", "Hermes response is not an object");
  }
  if (typeof payload.status === "string" && payload.status !== "completed") {
    throw new HermesClientError("HERMES_FAILED", "Hermes response is not completed");
  }
  if (!Array.isArray(payload.output)) {
    throw new HermesClientError("HERMES_FAILED", "Hermes response output is missing");
  }

  const texts: string[] = [];
  for (const item of payload.output) {
    if (!isObject(item) || item.type !== "message" || !Array.isArray(item.content)) continue;
    for (const content of item.content) {
      if (isObject(content) && content.type === "output_text" && typeof content.text === "string") {
        texts.push(content.text);
      }
    }
  }
  return requireText(texts.join(" ").trim());
}

export function parseChatCompletionsText(payload: unknown): string {
  if (!isObject(payload) || !Array.isArray(payload.choices)) {
    throw new HermesClientError("HERMES_FAILED", "Hermes chat response choices are missing");
  }

  const texts: string[] = [];
  for (const choice of payload.choices) {
    if (!isObject(choice) || !isObject(choice.message)) continue;
    if (typeof choice.message.content === "string") {
      texts.push(choice.message.content);
    }
  }
  return requireText(texts.join(" ").trim());
}

export function sanitizeHermesOutput(raw: string): string {
  const withoutMarkdown = raw
    .replace(/```[a-zA-Z0-9_-]*\s*/g, "")
    .replace(/```/g, "")
    .replace(/\[([^\]]+)\]\((?:https?:\/\/|www\.)[^)]+\)/gi, "$1")
    .replace(/\b(?:https?:\/\/|www\.)\S+/gi, "")
    .replace(/[`*_#>~-]+/g, "")
    .replace(/\s+/g, " ")
    .trim();

  const sentences = withoutMarkdown.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [];
  const concise = sentences
    .map((sentence) => sentence.trim())
    .filter(Boolean)
    .slice(0, 3)
    .join(" ")
    .slice(0, 600)
    .trim();

  return requireText(concise);
}

export function detectProviderError(text: string): boolean {
  return [
    /\bprovider\s+(?:request\s+)?(?:error|failed|failure)\b/i,
    /\brequest\s+failed\b/i,
    /\brate\s+limit(?:ed)?\b/i,
    /\bquota\s+exceeded\b/i,
    /\bunauthorized\b/i,
    /\binvalid\s+api\s+key\b/i,
    /\bconnection\s+refused\b/i,
    /\bservice\s+unavailable\b/i,
    /\binternal\s+(?:server\s+)?error\b/i,
    /\b(?:timed\s+out|timeout\s+(?:after|while|from|calling))\b/i,
  ].some((pattern) => pattern.test(text));
}

async function jsonOrThrow(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new HermesClientError("HERMES_FAILED", "Hermes returned invalid JSON");
  }
}

function normalizeHermesError(error: unknown): HermesClientError {
  if (error instanceof HermesClientError) return error;
  if (error instanceof DOMException && error.name === "AbortError") {
    return new HermesClientError("HERMES_FAILED", "Hermes timed out");
  }
  if (isObject(error) && error.name === "AbortError") {
    return new HermesClientError("HERMES_FAILED", "Hermes timed out");
  }
  return new HermesClientError("HERMES_FAILED", "Hermes request failed");
}

abstract class BaseHermesClient {
  protected readonly fetcher: Fetcher;

  protected constructor(protected readonly options: NormalizedHermesClientOptions) {
    this.fetcher = options.fetcher;
  }

  protected async postJson(url: string, body: unknown, parentSignal?: AbortSignal): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.hardTimeoutMs);
    const abortFromParent = () => controller.abort();
    parentSignal?.addEventListener("abort", abortFromParent, { once: true });
    const softTimer =
      this.options.softTimeoutMs && this.options.softTimeoutMs < this.options.hardTimeoutMs
        ? setTimeout(() => {
            this.options.logger?.warn(
              { timeout_ms: this.options.softTimeoutMs },
              "Hermes soft timeout threshold exceeded",
            );
          }, this.options.softTimeoutMs)
        : undefined;
    try {
      const response = await this.fetcher(url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.options.apiKey}`,
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new HermesClientError("HERMES_FAILED", `Hermes HTTP ${response.status}`);
      }
      return await jsonOrThrow(response);
    } catch (error) {
      throw normalizeHermesError(error);
    } finally {
      clearTimeout(timer);
      if (softTimer) clearTimeout(softTimer);
      parentSignal?.removeEventListener("abort", abortFromParent);
    }
  }

  protected finalize(text: string): string {
    const sanitized = sanitizeHermesOutput(text);
    if (detectProviderError(sanitized)) {
      throw new HermesClientError("HERMES_FAILED", "Hermes output contained provider error");
    }
    return sanitized;
  }
}

export class HermesResponsesClient extends BaseHermesClient implements HermesGenerateClient {
  constructor(options: HermesClientOptions) {
    super({ ...options, fetcher: options.fetcher ?? fetch });
  }

  async generate(input: string, signal?: AbortSignal): Promise<string> {
    const payload = await this.postJson(endpoint(this.options.baseUrl, "/v1/responses"), {
      model: this.options.model,
      instructions: BMO_RUNTIME_INSTRUCTIONS,
      input,
      conversation: this.options.conversation,
      store: true,
      stream: false,
      truncation: "auto",
    }, signal);
    return this.finalize(parseResponsesText(payload));
  }
}

export class HermesChatCompletionsClient extends BaseHermesClient implements HermesGenerateClient {
  constructor(options: HermesClientOptions) {
    super({ ...options, fetcher: options.fetcher ?? fetch });
  }

  async generate(input: string, signal?: AbortSignal): Promise<string> {
    const payload = await this.postJson(endpoint(this.options.baseUrl, "/v1/chat/completions"), {
      model: this.options.model,
      messages: [
        { role: "system", content: BMO_RUNTIME_INSTRUCTIONS },
        { role: "user", content: input },
      ],
      conversation: this.options.conversation,
      stream: false,
    }, signal);
    return this.finalize(parseChatCompletionsText(payload));
  }
}
