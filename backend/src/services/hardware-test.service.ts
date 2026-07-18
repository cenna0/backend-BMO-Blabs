import type { Logger } from "pino";

import type { VoiceRequestRecord, RequestStore } from "../domain/request-store.js";
import type { DeviceWebSocketServer } from "../websocket/websocket.server.js";
import type { TempAudioService } from "./temp-audio.service.js";

export class HardwareTestService {
  constructor(
    private readonly fixturePath: string,
    private readonly publicBaseUrl: () => string,
    private readonly tempAudio: TempAudioService,
    private readonly requestStore: RequestStore,
    private readonly sockets: DeviceWebSocketServer,
    private readonly logger: Logger,
  ) {}

  async process(record: VoiceRequestRecord): Promise<void> {
    this.sockets.sendThinking(record.deviceId, record.requestId);
    try {
      const audio = await this.tempAudio.createFromFixture(this.fixturePath);
      const ready = this.requestStore.markAudioReady(record.requestId, {
        audioId: audio.audioId,
        audioPath: audio.path,
        audioUrl: `${this.publicBaseUrl()}/audio/${audio.audioId}.mp3`,
        expiresAt: audio.expiresAt,
      });
      this.sockets.sendAudioReady(ready);
    } catch (error) {
      this.requestStore.fail(record.requestId, "INTERNAL_ERROR");
      this.sockets.sendRequestFailed(record.deviceId, record.requestId, "INTERNAL_ERROR");
      this.logger.error({ request_id: record.requestId, err: error }, "hardware test processing failed");
    } finally {
      await this.tempAudio.deleteInput(record.inputPath);
    }
  }
}
