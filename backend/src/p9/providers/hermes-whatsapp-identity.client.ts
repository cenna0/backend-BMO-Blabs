import { URL } from "node:url";

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

const PROVIDER_IDENTITY = /^\d{1,32}@(s\.whatsapp\.net|lid)$/u;

function loopbackBaseUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return "";
  }
  if (parsed.protocol !== "http:" || parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) return "";
  if (!["127.0.0.1", "localhost", "::1"].includes(parsed.hostname.toLowerCase())) return "";
  return parsed.origin;
}

function providerIdentity(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/:.*@/u, "@");
  return PROVIDER_IDENTITY.test(normalized) ? normalized : null;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

export function preferredWhatsAppDestination(values: string[]): string | null {
  const identities = unique(values.map(providerIdentity).filter((value): value is string => value !== null));
  return identities.find((value) => value.endsWith("@lid")) ?? identities[0] ?? null;
}

export interface WhatsAppIdentityResolverBoundary {
  expand(connectionId: string, providerRefs: string[]): Promise<string[]>;
}

interface HermesWhatsAppIdentityResolverOptions {
  baseUrl?: string | undefined;
  token?: string | undefined;
  fetcher?: Fetcher | undefined;
  timeoutMs?: number | undefined;
}

export class HermesWhatsAppIdentityResolverClient implements WhatsAppIdentityResolverBoundary {
  readonly #baseUrl: string;
  readonly #token: string | undefined;
  readonly #fetcher: Fetcher;
  readonly #timeoutMs: number;

  constructor(options: HermesWhatsAppIdentityResolverOptions = {}) {
    this.#baseUrl = options.baseUrl ? loopbackBaseUrl(options.baseUrl).replace(/\/$/u, "") : "";
    this.#token = options.token && options.token.length >= 32 ? options.token : undefined;
    this.#fetcher = options.fetcher ?? fetch;
    this.#timeoutMs = options.timeoutMs ?? 3_000;
  }

  async expand(connectionId: string, providerRefs: string[]): Promise<string[]> {
    const requested = unique(providerRefs.map(providerIdentity).filter((value): value is string => value !== null));
    if (requested.length === 0 || !this.#baseUrl || !this.#token) return requested;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);
    try {
      const response = await this.#fetcher(`${this.#baseUrl}/resolve`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "x-bmo-identity-resolver-token": this.#token,
        },
        body: JSON.stringify({ connectionId, identifiers: requested }),
      });
      if (!response.ok) return requested;
      const payload: unknown = await response.json();
      if (!isObject(payload) || !Array.isArray(payload.groups)) return requested;
      const expanded = [...requested];
      for (const group of payload.groups) {
        if (!Array.isArray(group)) return requested;
        for (const value of group) {
          const identity = providerIdentity(value);
          if (!identity) return requested;
          expanded.push(identity);
        }
      }
      return unique(expanded);
    } catch {
      return requested;
    } finally {
      clearTimeout(timer);
    }
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
