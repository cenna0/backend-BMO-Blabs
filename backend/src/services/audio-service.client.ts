export type AudioServiceClientErrorCode = "STT_FAILED" | "TTS_FAILED" | "PIPELINE_TIMEOUT";

export class AudioServiceClientError extends Error {
  constructor(
    public readonly code: AudioServiceClientErrorCode,
    message: string = code,
  ) {
    super(message);
    this.name = "AudioServiceClientError";
  }
}

export interface SttResult {
  text: string;
  speechDetected: boolean;
  language: string | null;
  languageProbability: number;
  durationSeconds: number;
}

export interface TtsResult {
  audio: Buffer;
  rvcApplied: boolean;
  ttsEngine: string;
}

export interface AudioServicePort {
  transcribe(wav: Buffer, signal?: AbortSignal): Promise<SttResult>;
  synthesize(requestId: string, text: string, useRvc: boolean, signal?: AbortSignal): Promise<TtsResult>;
}

type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

interface AudioServiceClientOptions {
  baseUrl: string;
  internalToken: string;
  sttTimeoutMs: number;
  ttsTimeoutMs: number;
  fetcher?: Fetcher;
}

function endpoint(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/$/, "")}${path}`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeError(error: unknown, fallback: AudioServiceClientErrorCode): AudioServiceClientError {
  if (error instanceof AudioServiceClientError) return error;
  if (error instanceof DOMException && error.name === "AbortError") {
    return new AudioServiceClientError(fallback, "Audio Service request timed out");
  }
  if (isObject(error) && error.name === "AbortError") {
    return new AudioServiceClientError(fallback, "Audio Service request timed out");
  }
  return new AudioServiceClientError(fallback, "Audio Service request failed");
}

async function withTimeout<T>(
  timeoutMs: number,
  work: (signal: AbortSignal) => Promise<T>,
  fallback: AudioServiceClientErrorCode,
  parentSignal?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const abortFromParent = () => controller.abort();
  parentSignal?.addEventListener("abort", abortFromParent, { once: true });
  try {
    return await work(controller.signal);
  } catch (error) {
    throw normalizeError(error, fallback);
  } finally {
    clearTimeout(timer);
    parentSignal?.removeEventListener("abort", abortFromParent);
  }
}

function parseStt(payload: unknown): SttResult {
  if (!isObject(payload)) {
    throw new AudioServiceClientError("STT_FAILED", "STT response is not an object");
  }
  const text = payload.text;
  const speechDetected = payload.speech_detected;
  const language = payload.language;
  const languageProbability = payload.language_probability;
  const durationSeconds = payload.duration_seconds;
  if (
    typeof text !== "string" ||
    typeof speechDetected !== "boolean" ||
    !(typeof language === "string" || language === null) ||
    typeof languageProbability !== "number" ||
    typeof durationSeconds !== "number"
  ) {
    throw new AudioServiceClientError("STT_FAILED", "STT response schema is invalid");
  }
  return {
    text,
    speechDetected,
    language,
    languageProbability,
    durationSeconds,
  };
}

export class AudioServiceClient implements AudioServicePort {
  readonly #fetcher: Fetcher;

  constructor(private readonly options: AudioServiceClientOptions) {
    this.#fetcher = options.fetcher ?? fetch;
  }

  async transcribe(wav: Buffer, signal?: AbortSignal): Promise<SttResult> {
    return withTimeout(
      this.options.sttTimeoutMs,
      async (signal) => {
        const body = wav.buffer.slice(wav.byteOffset, wav.byteOffset + wav.byteLength);
        const response = await this.#fetcher(endpoint(this.options.baseUrl, "/stt/transcribe"), {
          method: "POST",
          headers: {
            "content-type": "audio/wav",
            "x-internal-service-token": this.options.internalToken,
          },
          body,
          signal,
        });
        if (!response.ok) {
          throw new AudioServiceClientError("STT_FAILED", `STT HTTP ${response.status}`);
        }
        try {
          return parseStt(await response.json());
        } catch (error) {
          throw normalizeError(error, "STT_FAILED");
        }
      },
      "STT_FAILED",
      signal,
    );
  }

  async synthesize(requestId: string, text: string, useRvc: boolean, signal?: AbortSignal): Promise<TtsResult> {
    return withTimeout(
      this.options.ttsTimeoutMs,
      async (signal) => {
        const response = await this.#fetcher(endpoint(this.options.baseUrl, "/tts/synthesize"), {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "audio/mpeg",
            "x-internal-service-token": this.options.internalToken,
          },
          body: JSON.stringify({
            request_id: requestId,
            text,
            use_rvc: useRvc,
          }),
          signal,
        });
        if (!response.ok) {
          throw new AudioServiceClientError("TTS_FAILED", `TTS HTTP ${response.status}`);
        }
        const audio = Buffer.from(await response.arrayBuffer());
        if (audio.length === 0) {
          throw new AudioServiceClientError("TTS_FAILED", "TTS returned empty audio");
        }
        return {
          audio,
          rvcApplied: response.headers.get("x-rvc-applied") === "true",
          ttsEngine: response.headers.get("x-tts-engine") ?? "unknown",
        };
      },
      "TTS_FAILED",
      signal,
    );
  }
}
