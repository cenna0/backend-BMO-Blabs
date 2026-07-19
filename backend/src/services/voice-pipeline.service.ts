import { readFile } from "node:fs/promises";
import type { Logger } from "pino";

import type { VoiceRequestRecord } from "../domain/request-store.js";
import { RequestStoreError, type RequestStore } from "../domain/request-store.js";
import type { OutboundEvent } from "../websocket/events.js";
import type { DeviceWebSocketServer } from "../websocket/websocket.server.js";
import type { AudioServicePort, SttResult, TtsResult } from "./audio-service.client.js";
import type { HermesGenerateClient } from "./hermes.client.js";
import type { TempAudioService } from "./temp-audio.service.js";

type RequestFailureCode = Extract<OutboundEvent, { event: "request_failed" }>["code"];

interface ConversationQueuePort {
  run(key: string, work: () => Promise<string>): Promise<string>;
}

interface VoicePipelineSockets {
  sendThinking(deviceId: string, requestId: string): boolean;
  sendAudioReady(record: VoiceRequestRecord): boolean;
  sendRequestFailed(deviceId: string, requestId: string, code: RequestFailureCode): boolean;
}

export interface VoicePipelineServiceOptions {
  publicBaseUrl: () => string;
  tempAudio: TempAudioService;
  requestStore: RequestStore;
  sockets: DeviceWebSocketServer | VoicePipelineSockets;
  logger: Pick<Logger, "error" | "warn" | "info">;
  audioService: AudioServicePort;
  hermes: HermesGenerateClient;
  conversationQueue: ConversationQueuePort;
  conversationKey: string;
  totalTimeoutMs: number;
}

export interface VoicePipelineResult {
  status: "audio_ready" | "failed";
  transcript?: string;
  responseText?: string;
  tts?: Pick<TtsResult, "rvcApplied" | "ttsEngine">;
  errorCode?: RequestFailureCode;
  timingsMs?: Record<string, number>;
}

function isErrorWithCode(value: unknown): value is { code: unknown } {
  return typeof value === "object" && value !== null && "code" in value;
}

function mapPipelineError(error: unknown): RequestFailureCode {
  if (isErrorWithCode(error)) {
    switch (error.code) {
      case "NO_SPEECH":
      case "INVALID_AUDIO":
      case "STT_FAILED":
      case "HERMES_FAILED":
      case "TTS_FAILED":
      case "PIPELINE_TIMEOUT":
        return error.code;
      default:
        break;
    }
  }
  return "INTERNAL_ERROR";
}

export class VoicePipelineService {
  constructor(private readonly options: VoicePipelineServiceOptions) {}

  async process(record: VoiceRequestRecord): Promise<VoicePipelineResult> {
    let timer: NodeJS.Timeout | undefined;
    let timedOut = false;
    const controller = new AbortController();
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
        reject(Object.assign(new Error("pipeline timeout"), { code: "PIPELINE_TIMEOUT" }));
      }, this.options.totalTimeoutMs);
    });

    try {
      return await Promise.race([this.#run(record, () => timedOut, controller.signal), timeout]);
    } catch (error) {
      const code = mapPipelineError(error);
      return this.#fail(record, code, error);
    } finally {
      if (timer) clearTimeout(timer);
      await this.options.tempAudio.deleteInput(record.inputPath);
    }
  }

  async #run(
    record: VoiceRequestRecord,
    isTimedOut: () => boolean,
    signal: AbortSignal,
  ): Promise<VoicePipelineResult> {
    const totalStarted = performance.now();
    this.options.requestStore.setStatus(record.requestId, "transcribing");
    const wav = await readFile(record.inputPath);
    this.#throwIfTimedOut(isTimedOut);
    const sttStarted = performance.now();
    const stt = await this.options.audioService.transcribe(wav, signal);
    const sttMs = Math.round(performance.now() - sttStarted);
    this.#throwIfTimedOut(isTimedOut);
    if (!this.#hasSpeech(stt)) {
      throw Object.assign(new Error("no speech detected"), { code: "NO_SPEECH" });
    }

    this.options.requestStore.setStatus(record.requestId, "thinking");
    this.options.sockets.sendThinking(record.deviceId, record.requestId);
    const hermesStarted = performance.now();
    const responseText = await this.options.conversationQueue.run(this.options.conversationKey, () =>
      this.options.hermes.generate(stt.text, signal),
    );
    const hermesMs = Math.round(performance.now() - hermesStarted);
    this.#throwIfTimedOut(isTimedOut);

    this.options.requestStore.setStatus(record.requestId, "generating_voice");
    const ttsStarted = performance.now();
    const tts = await this.options.audioService.synthesize(record.requestId, responseText, true, signal);
    const ttsMs = Math.round(performance.now() - ttsStarted);
    this.#throwIfTimedOut(isTimedOut);
    const storeStarted = performance.now();
    const audio = await this.options.tempAudio.createFromBytes(tts.audio);
    const storeMp3Ms = Math.round(performance.now() - storeStarted);
    if (isTimedOut()) {
      await this.options.tempAudio.deleteAudio(audio.audioId);
      this.#throwIfTimedOut(isTimedOut);
    }
    const ready = this.options.requestStore.markAudioReady(record.requestId, {
      audioId: audio.audioId,
      audioPath: audio.path,
      audioUrl: `${this.options.publicBaseUrl()}/audio/${audio.audioId}.mp3`,
      expiresAt: audio.expiresAt,
    });
    this.options.sockets.sendAudioReady(ready);
    const timingsMs = {
      stt: sttMs,
      hermes: hermesMs,
      tts: ttsMs,
      store_mp3: storeMp3Ms,
      total: Math.round(performance.now() - totalStarted),
    };
    this.options.logger.info(
      {
        request_id: record.requestId,
        language: stt.language,
        speech_detected: stt.speechDetected,
        rvc_applied: tts.rvcApplied,
        tts_engine: tts.ttsEngine,
        timings_ms: timingsMs,
      },
      "voice pipeline completed",
    );
    return {
      status: "audio_ready",
      transcript: stt.text,
      responseText,
      tts: {
        rvcApplied: tts.rvcApplied,
        ttsEngine: tts.ttsEngine,
      },
      timingsMs,
    };
  }

  #hasSpeech(stt: SttResult): boolean {
    return stt.speechDetected && stt.text.trim().length > 0;
  }

  #throwIfTimedOut(isTimedOut: () => boolean): void {
    if (isTimedOut()) {
      throw Object.assign(new Error("pipeline timeout"), { code: "PIPELINE_TIMEOUT" });
    }
  }

  #fail(record: VoiceRequestRecord, code: RequestFailureCode, error: unknown): VoicePipelineResult {
    try {
      this.options.requestStore.fail(record.requestId, code);
    } catch (storeError) {
      if (!(storeError instanceof RequestStoreError && storeError.code === "REQUEST_NOT_FOUND")) {
        this.options.logger.warn({ request_id: record.requestId, err: storeError }, "failed to mark request failed");
      }
    }
    this.options.logger.error({ request_id: record.requestId, code, err: error }, "voice pipeline failed");
    this.options.sockets.sendRequestFailed(record.deviceId, record.requestId, code);
    return { status: "failed", errorCode: code };
  }
}
