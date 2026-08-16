import { Buffer } from "node:buffer";

const SPOTIFY_API = "https://api.spotify.com/v1";
const SPOTIFY_TOKEN = "https://accounts.spotify.com/api/token";

export type SpotifySearchType = "track" | "artist" | "album" | "playlist";

export interface SpotifyTokenSet {
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
  scopes: string[];
}

export interface SpotifyCurrentUser {
  accountId: string;
  profileId: string | null;
  market: string | null;
  product: string | null;
}

export interface SpotifyDevice {
  id: string;
  name: string;
  type: string;
  isActive: boolean;
  isRestricted: boolean;
  volumePercent: number | null;
  supportsVolume: boolean;
}

export interface SpotifySearchResults {
  tracks: Array<{ id: string; name: string; uri: string; artists: string[] }>;
  artists: Array<{ id: string; name: string; uri: string }>;
  albums: Array<{ id: string; name: string; uri: string; artists: string[] }>;
  playlists: Array<{ id: string; name: string; uri: string; owner: string | null }>;
}

export interface SpotifyPlaybackState {
  isPlaying: boolean;
  device: SpotifyDevice | null;
  contextUri: string | null;
  itemUri: string | null;
  itemName: string | null;
  progressMs: number | null;
  durationMs: number | null;
  shuffleState: boolean | null;
  repeatState: "track" | "context" | "off" | null;
}

export class SpotifyProviderError extends Error {
  constructor(public readonly status: number, public readonly code: SpotifyProviderErrorCode) {
    super(code);
    this.name = "SpotifyProviderError";
  }
}

export type SpotifyProviderErrorCode =
  | "AUTHORIZATION_REVOKED"
  | "INVALID_GRANT"
  | "PREMIUM_REQUIRED"
  | "RATE_LIMITED"
  | "PROVIDER_UNAVAILABLE"
  | "INVALID_PROVIDER_RESPONSE"
  | "PROVIDER_REQUEST_FAILED";

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

interface SpotifyClientOptions {
  clientId: string;
  clientSecret: string;
  fetcher?: Fetcher;
  timeoutMs?: number;
}

interface ProviderObject { [key: string]: unknown }

function isObject(value: unknown): value is ProviderObject {
  return typeof value === "object" && value !== null;
}

function stringField(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 2_048) throw new SpotifyProviderError(502, "INVALID_PROVIDER_RESPONSE");
  return value;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= 2_048 ? value : null;
}

function integerField(value: unknown, field: string, minimum = 0): number {
  if (!Number.isInteger(value) || Number(value) < minimum) throw new SpotifyProviderError(502, "INVALID_PROVIDER_RESPONSE");
  return Number(value);
}

function normalizeProviderError(status: number, payload?: unknown, tokenRequest = false): SpotifyProviderError {
  if (tokenRequest && isObject(payload) && payload.error === "invalid_grant") return new SpotifyProviderError(status, "INVALID_GRANT");
  if (status === 401) return new SpotifyProviderError(status, "AUTHORIZATION_REVOKED");
  if (status === 403) return new SpotifyProviderError(status, "PREMIUM_REQUIRED");
  if (status === 429) return new SpotifyProviderError(status, "RATE_LIMITED");
  if (status >= 500) return new SpotifyProviderError(status, "PROVIDER_UNAVAILABLE");
  return new SpotifyProviderError(status, "PROVIDER_REQUEST_FAILED");
}

function endpoint(path: string): string {
  return `${SPOTIFY_API}${path}`;
}

function encodeBasic(clientId: string, clientSecret: string): string {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`, "utf8").toString("base64")}`;
}

function parseJsonText(value: string): unknown {
  try { return JSON.parse(value) as unknown; } catch { return null; }
}

function normalizeScopes(value: unknown): string[] {
  if (typeof value !== "string") return [];
  return value.split(/\s+/u).filter((scope) => /^[a-z0-9-]+$/u.test(scope)).slice(0, 64);
}

function spotifyUri(value: unknown, expectedType?: SpotifySearchType): string {
  if (typeof value !== "string" || value.length > 255) throw new SpotifyProviderError(400, "PROVIDER_REQUEST_FAILED");
  const match = /^spotify:(track|artist|album|playlist):[A-Za-z0-9]+$/u.exec(value);
  if (!match || (expectedType !== undefined && match[1] !== expectedType)) throw new SpotifyProviderError(400, "PROVIDER_REQUEST_FAILED");
  return value;
}

function deviceId(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 255) throw new SpotifyProviderError(400, "PROVIDER_REQUEST_FAILED");
  return value;
}

function normalizeDevice(value: unknown): SpotifyDevice {
  if (!isObject(value)) throw new SpotifyProviderError(502, "INVALID_PROVIDER_RESPONSE");
  const volume = value.volume_percent === null || value.volume_percent === undefined ? null : integerField(value.volume_percent, "volume_percent");
  return {
    id: stringField(value.id, "id"),
    name: stringField(value.name, "name"),
    type: stringField(value.type, "type"),
    isActive: value.is_active === true,
    isRestricted: value.is_restricted === true,
    volumePercent: volume === null ? null : Math.min(volume, 100),
    supportsVolume: value.supports_volume === true,
  };
}

function normalizeSearchItem(value: unknown, type: SpotifySearchType): any {
  if (!isObject(value)) throw new SpotifyProviderError(502, "INVALID_PROVIDER_RESPONSE");
  const base = { id: stringField(value.id, "id"), name: stringField(value.name, "name"), uri: stringField(value.uri, "uri") };
  if (type === "track" || type === "album") {
    const artists = Array.isArray(value.artists) ? value.artists.filter(isObject).map((artist) => optionalString(artist.name)).filter((name): name is string => name !== null).slice(0, 20) : [];
    return { ...base, artists };
  }
  if (type === "playlist") return { ...base, owner: isObject(value.owner) ? optionalString(value.owner.display_name) : null };
  return base;
}

export class SpotifyApiClient {
  readonly #fetcher: Fetcher;
  readonly #timeoutMs: number;

  constructor(private readonly options: SpotifyClientOptions) {
    this.#fetcher = options.fetcher ?? fetch;
    this.#timeoutMs = options.timeoutMs ?? 15_000;
    if (!options.clientId || !options.clientSecret) throw new Error("Spotify client credentials are required");
  }

  async exchangeCode(code: string, redirectUri: string): Promise<SpotifyTokenSet> {
    return this.#tokenRequest(new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri }));
  }

  async refreshToken(refreshToken: string): Promise<SpotifyTokenSet> {
    return this.#tokenRequest(new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }));
  }

  async search(accessToken: string, query: string, types: SpotifySearchType[] = ["track", "artist", "album", "playlist"], market?: string | null): Promise<SpotifySearchResults> {
    const uniqueTypes = [...new Set(types)];
    const params = new URLSearchParams({ q: query, type: uniqueTypes.join(","), limit: "10", ...(market ? { market } : {}) });
    const payload = await this.#apiRequest(`/search?${params.toString()}`, accessToken, { method: "GET" });
    return {
      tracks: this.#searchItems(payload, "tracks", "track"),
      artists: this.#searchItems(payload, "artists", "artist"),
      albums: this.#searchItems(payload, "albums", "album"),
      playlists: this.#searchItems(payload, "playlists", "playlist"),
    };
  }

  async currentUser(accessToken: string): Promise<SpotifyCurrentUser> {
    const payload = await this.#apiRequest("/me", accessToken, { method: "GET" });
    if (!isObject(payload)) throw new SpotifyProviderError(502, "INVALID_PROVIDER_RESPONSE");
    const country = typeof payload.country === "string" && /^[A-Z]{2}$/u.test(payload.country) ? payload.country : null;
    return {
      accountId: stringField(payload.account_id, "account_id"),
      profileId: optionalString(payload.id),
      market: country,
      product: typeof payload.product === "string" && payload.product.length <= 32 ? payload.product : null,
    };
  }

  async devices(accessToken: string): Promise<SpotifyDevice[]> {
    const payload = await this.#apiRequest("/me/player/devices", accessToken, { method: "GET" });
    if (!isObject(payload) || !Array.isArray(payload.devices)) throw new SpotifyProviderError(502, "INVALID_PROVIDER_RESPONSE");
    return payload.devices.slice(0, 50).map(normalizeDevice);
  }

  async playback(accessToken: string): Promise<SpotifyPlaybackState | null> {
    const response = await this.#apiResponse("/me/player", accessToken, { method: "GET" });
    if (response.status === 204) return null;
    const payload = await this.#responseJson(response);
    if (!isObject(payload)) throw new SpotifyProviderError(502, "INVALID_PROVIDER_RESPONSE");
    const device = payload.device === null || payload.device === undefined ? null : normalizeDevice(payload.device);
    const item = isObject(payload.item) ? payload.item : null;
    const context = isObject(payload.context) ? payload.context : null;
    return {
      isPlaying: payload.is_playing === true,
      device,
      contextUri: context ? optionalString(context.uri) : null,
      itemUri: item ? optionalString(item.uri) : null,
      itemName: item ? optionalString(item.name) : null,
      progressMs: payload.progress_ms === null || payload.progress_ms === undefined ? null : integerField(payload.progress_ms, "progress_ms"),
      durationMs: item && item.duration_ms !== undefined ? integerField(item.duration_ms, "duration_ms") : null,
      shuffleState: typeof payload.shuffle_state === "boolean" ? payload.shuffle_state : null,
      repeatState: payload.repeat_state === "track" || payload.repeat_state === "context" || payload.repeat_state === "off" ? payload.repeat_state : null,
    };
  }

  async action(accessToken: string, action: string, payload: Record<string, unknown>): Promise<{ code: string; metadata?: string }> {
    const mapped = this.#mapAction(action, payload);
    await this.#apiResponse(mapped.path, accessToken, { method: mapped.method, ...(mapped.body === undefined ? {} : { body: JSON.stringify(mapped.body), headers: { "content-type": "application/json" } }) });
    return { code: "SPOTIFY_COMMAND_ACCEPTED", ...(mapped.metadata === undefined ? {} : { metadata: mapped.metadata }) };
  }

  async #tokenRequest(body: URLSearchParams): Promise<SpotifyTokenSet> {
    const response = await this.#request(SPOTIFY_TOKEN, {
      method: "POST",
      headers: { authorization: encodeBasic(this.options.clientId, this.options.clientSecret), "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body,
    });
    const payload = await this.#responseJson(response);
    if (!response.ok) throw normalizeProviderError(response.status, payload, true);
    if (!isObject(payload)) throw new SpotifyProviderError(502, "INVALID_PROVIDER_RESPONSE");
    return {
      accessToken: stringField(payload.access_token, "access_token"),
      ...(payload.refresh_token === undefined ? {} : { refreshToken: stringField(payload.refresh_token, "refresh_token") }),
      expiresIn: integerField(payload.expires_in, "expires_in", 1),
      scopes: normalizeScopes(payload.scope),
    };
  }

  async #apiRequest(path: string, accessToken: string, init: RequestInit): Promise<unknown> {
    const response = await this.#apiResponse(path, accessToken, init);
    if (response.status === 204) return null;
    return this.#responseJson(response);
  }

  async #apiResponse(path: string, accessToken: string, init: RequestInit): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${accessToken}`);
    headers.set("accept", "application/json");
    const response = await this.#request(endpoint(path), { ...init, headers });
    if (!response.ok && response.status !== 204) {
      const payload = await this.#responseJson(response);
      throw normalizeProviderError(response.status, payload);
    }
    return response;
  }

  async #request(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);
    try {
      return await this.#fetcher(url, { ...init, signal: controller.signal });
    } catch (error) {
      if (error instanceof SpotifyProviderError) throw error;
      throw new SpotifyProviderError(503, error instanceof DOMException && error.name === "AbortError" ? "PROVIDER_UNAVAILABLE" : "PROVIDER_REQUEST_FAILED");
    } finally {
      clearTimeout(timer);
    }
  }

  async #responseJson(response: Response): Promise<unknown> {
    const text = await response.text();
    if (text.length > 2_000_000) throw new SpotifyProviderError(502, "INVALID_PROVIDER_RESPONSE");
    const payload = parseJsonText(text);
    if (payload === null && text.trim() !== "null") throw new SpotifyProviderError(502, "INVALID_PROVIDER_RESPONSE");
    return payload;
  }

  #searchItems(payload: unknown, key: string, type: SpotifySearchType): any[] {
    if (!isObject(payload) || payload[key] === undefined) return [];
    if (!isObject(payload[key]) || !Array.isArray(payload[key].items)) throw new SpotifyProviderError(502, "INVALID_PROVIDER_RESPONSE");
    return payload[key].items.slice(0, 10).map((item) => normalizeSearchItem(item, type));
  }

  #mapAction(action: string, payload: Record<string, unknown>): { method: string; path: string; body?: unknown; metadata?: string } {
    const deviceQuery = payload.deviceId === undefined ? "" : `?device_id=${encodeURIComponent(deviceId(payload.deviceId))}`;
    if (action === "RESUME") return { method: "PUT", path: `/me/player/play${deviceQuery}` };
    if (action === "PAUSE") return { method: "PUT", path: `/me/player/pause${deviceQuery}` };
    if (action === "NEXT") return { method: "POST", path: `/me/player/next${deviceQuery}` };
    if (action === "PREVIOUS") return { method: "POST", path: `/me/player/previous${deviceQuery}` };
    if (action === "PLAY" || action === "PLAY_TRACK" || action === "PLAY_ARTIST" || action === "PLAY_ALBUM" || action === "PLAY_PLAYLIST") {
      const expectedType = action === "PLAY_TRACK" ? "track" : action === "PLAY_ARTIST" ? "artist" : action === "PLAY_ALBUM" ? "album" : action === "PLAY_PLAYLIST" ? "playlist" : undefined;
      const uri = spotifyUri(payload.uri, expectedType);
      const body = uri.startsWith("spotify:track:") ? { uris: [uri] } : { context_uri: uri };
      return { method: "PUT", path: `/me/player/play${deviceQuery}`, body };
    }
    if (action === "TRANSFER") return { method: "PUT", path: "/me/player", body: { device_ids: [deviceId(payload.deviceId)], play: payload.play === true } };
    if (action === "SEEK") return { method: "PUT", path: `/me/player/seek?position_ms=${integerField(payload.positionMs, "positionMs")}${deviceQuery ? `&${deviceQuery.slice(1)}` : ""}` };
    if (action === "VOLUME") return { method: "PUT", path: `/me/player/volume?volume_percent=${integerField(payload.volume, "volume")}${deviceQuery ? `&${deviceQuery.slice(1)}` : ""}` };
    if (action === "SHUFFLE") return { method: "PUT", path: `/me/player/shuffle?state=${payload.state === true}${deviceQuery ? `&${deviceQuery.slice(1)}` : ""}` };
    if (action === "REPEAT") {
      const state = stringField(payload.state, "state");
      if (state !== "track" && state !== "context" && state !== "off") throw new SpotifyProviderError(400, "PROVIDER_REQUEST_FAILED");
      return { method: "PUT", path: `/me/player/repeat?state=${encodeURIComponent(state)}${deviceQuery ? `&${deviceQuery.slice(1)}` : ""}` };
    }
    throw new SpotifyProviderError(400, "PROVIDER_REQUEST_FAILED");
  }
}
