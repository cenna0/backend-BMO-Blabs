export interface BackendReadinessState {
  hermesReady: boolean;
  audioReady: boolean;
  rvcAvailable: boolean;
  databaseReady?: boolean;
}

export interface BackendReadinessPort {
  check(): Promise<BackendReadinessState>;
}

type Fetcher = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

interface BackendReadinessServiceOptions {
  hermesBaseUrl: string;
  audioServiceBaseUrl: string;
  timeoutMs: number;
  fetcher?: Fetcher;
  databaseReadiness?: () => Promise<boolean>;
}

interface AudioReadiness {
  ready: boolean;
  rvcAvailable: boolean;
}

function endpoint(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/$/, "")}${path}`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export class BackendReadinessService implements BackendReadinessPort {
  readonly #fetcher: Fetcher;

  constructor(private readonly options: BackendReadinessServiceOptions) {
    this.#fetcher = options.fetcher ?? fetch;
  }

  async #getJson(url: string): Promise<unknown | undefined> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
    try {
      const response = await this.#fetcher(url, {
        method: "GET",
        headers: { accept: "application/json" },
        signal: controller.signal,
      });
      if (!response.ok) return undefined;
      return await response.json();
    } catch {
      return undefined;
    } finally {
      clearTimeout(timer);
    }
  }

  async #checkHermes(): Promise<boolean> {
    const payload = await this.#getJson(endpoint(this.options.hermesBaseUrl, "/health"));
    return isObject(payload) && payload.status === "ok";
  }

  async #checkAudio(): Promise<AudioReadiness> {
    const payload = await this.#getJson(endpoint(this.options.audioServiceBaseUrl, "/readyz"));
    if (!isObject(payload)) return { ready: false, rvcAvailable: false };

    const mandatoryReady =
      (payload.status === "ok" || payload.status === "degraded") &&
      payload.stt_loaded === true &&
      payload.kokoro_loaded === true &&
      payload.ffmpeg_available === true;
    return {
      ready: mandatoryReady,
      rvcAvailable: mandatoryReady && payload.rvc_available === true,
    };
  }

  async #checkDatabase(): Promise<boolean | undefined> {
    if (!this.options.databaseReadiness) return undefined;
    return await new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (ready: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(ready);
      };
      const timer = setTimeout(() => finish(false), this.options.timeoutMs);
      void Promise.resolve()
        .then(() => this.options.databaseReadiness!())
        .then(finish, () => finish(false));
    });
  }

  async check(): Promise<BackendReadinessState> {
    const [hermesReady, audio, databaseReady] = await Promise.all([
      this.#checkHermes(),
      this.#checkAudio(),
      this.#checkDatabase(),
    ]);
    return {
      hermesReady,
      audioReady: audio.ready,
      rvcAvailable: audio.rvcAvailable,
      ...(databaseReady === undefined ? {} : { databaseReady }),
    };
  }
}
