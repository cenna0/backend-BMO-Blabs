import { URL } from "node:url";

export interface HermesWhatsAppStatus {
  status: string;
  queueLength: number;
  uptime: number | null;
  scriptHash: string | null;
  sendReadReceipts: boolean | null;
}

export interface HermesWhatsAppMessage {
  messageId: string;
  chatId: string;
  senderId: string;
  body: string;
  isGroup: boolean;
  fromOwner: boolean;
}

export type HermesWhatsAppProviderErrorCode =
  | "INVALID_PROVIDER_RESPONSE"
  | "PROVIDER_UNAVAILABLE"
  | "PROVIDER_REQUEST_FAILED"
  | "NOT_CONNECTED";

export class HermesWhatsAppProviderError extends Error {
  constructor(public readonly code: HermesWhatsAppProviderErrorCode) {
    super(code);
    this.name = "HermesWhatsAppProviderError";
  }
}

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

interface HermesWhatsAppClientOptions {
  baseUrl: string;
  fetcher?: Fetcher;
  timeoutMs?: number;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function boundedString(value: unknown, max: number): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= max ? value : null;
}

function loopbackBaseUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new HermesWhatsAppProviderError("PROVIDER_REQUEST_FAILED");
  }
  if (parsed.protocol !== "http:" || parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new HermesWhatsAppProviderError("PROVIDER_REQUEST_FAILED");
  }
  const host = parsed.hostname.toLowerCase();
  if (!["127.0.0.1", "localhost", "::1"].includes(host)) throw new HermesWhatsAppProviderError("PROVIDER_REQUEST_FAILED");
  return parsed.origin;
}

export class HermesWhatsAppBridgeClient {
  readonly #baseUrl: string;
  readonly #fetcher: Fetcher;
  readonly #timeoutMs: number;

  constructor(options: HermesWhatsAppClientOptions) {
    this.#baseUrl = loopbackBaseUrl(options.baseUrl).replace(/\/$/u, "");
    this.#fetcher = options.fetcher ?? fetch;
    this.#timeoutMs = options.timeoutMs ?? 30_000;
  }

  async status(): Promise<HermesWhatsAppStatus> {
    const payload = await this.#json("/health", { method: "GET" }, 3_000);
    if (!isObject(payload) || typeof payload.status !== "string") throw new HermesWhatsAppProviderError("INVALID_PROVIDER_RESPONSE");
    const queueLength = payload.queueLength === undefined ? 0 : payload.queueLength;
    if (!Number.isInteger(queueLength) || Number(queueLength) < 0 || Number(queueLength) > 100_000) throw new HermesWhatsAppProviderError("INVALID_PROVIDER_RESPONSE");
    return {
      status: payload.status.slice(0, 32),
      queueLength: Number(queueLength),
      uptime: typeof payload.uptime === "number" && Number.isFinite(payload.uptime) ? payload.uptime : null,
      scriptHash: boundedString(payload.scriptHash, 128),
      sendReadReceipts: typeof payload.sendReadReceipts === "boolean" ? payload.sendReadReceipts : null,
    };
  }

  async connect(): Promise<{ externalReference?: string; status?: string }> {
    const status = await this.status();
    return {
      status: status.status,
      ...(status.scriptHash === null ? {} : { externalReference: `bridge:${status.scriptHash}` }),
    };
  }

  async confirmScanned(): Promise<void> {
    const status = await this.status();
    if (status.status !== "connected") throw new HermesWhatsAppProviderError("NOT_CONNECTED");
  }

  async poll(): Promise<HermesWhatsAppMessage[]> {
    const payload = await this.#json("/messages", { method: "GET" }, this.#timeoutMs);
    if (!Array.isArray(payload)) throw new HermesWhatsAppProviderError("INVALID_PROVIDER_RESPONSE");
    return payload.map((value) => {
      if (!isObject(value)) return null;
      const messageId = boundedString(value.messageId, 255);
      const chatId = boundedString(value.chatId, 255);
      const senderId = boundedString(value.senderId, 255);
      const body = typeof value.body === "string" && value.body.length <= 65_536 ? value.body : null;
      if (!messageId || !chatId || !senderId || body === null || body.trim().length === 0) return null;
      return { messageId, chatId, senderId, body, isGroup: value.isGroup === true, fromOwner: value.fromOwner === true };
    }).filter((value): value is HermesWhatsAppMessage => value !== null);
  }

  async send(_userId: string, recipientRef: string, message: string): Promise<{ providerMessageRef?: string }> {
    const chatId = this.#chatId(recipientRef);
    const body = message.trim();
    if (!body || body.length > 4_096) throw new HermesWhatsAppProviderError("PROVIDER_REQUEST_FAILED");
    const payload = await this.#json("/send", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chatId, message: body }) }, this.#timeoutMs);
    if (!isObject(payload) || payload.success !== true) throw new HermesWhatsAppProviderError("INVALID_PROVIDER_RESPONSE");
    const providerMessageRef = boundedString(payload.messageId, 255);
    return providerMessageRef === null ? {} : { providerMessageRef };
  }

  async #json(path: string, init: RequestInit, timeoutMs: number): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await this.#fetcher(`${this.#baseUrl}${path}`, { ...init, signal: controller.signal, headers: { accept: "application/json", ...init.headers } });
      if (!response.ok) throw new HermesWhatsAppProviderError(response.status === 503 ? "PROVIDER_UNAVAILABLE" : "PROVIDER_REQUEST_FAILED");
      try {
        return await response.json();
      } catch {
        throw new HermesWhatsAppProviderError("INVALID_PROVIDER_RESPONSE");
      }
    } catch (error) {
      if (error instanceof HermesWhatsAppProviderError) throw error;
      throw new HermesWhatsAppProviderError("PROVIDER_UNAVAILABLE");
    } finally {
      clearTimeout(timer);
    }
  }

  #chatId(value: string): string {
    const normalized = value.trim();
    if (!/^[^@\s]{1,200}@(s\.whatsapp\.net|lid|g\.us)$/u.test(normalized)) throw new HermesWhatsAppProviderError("PROVIDER_REQUEST_FAILED");
    return normalized;
  }
}
