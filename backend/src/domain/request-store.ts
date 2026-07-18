export type RequestStatus = "accepted" | "audio_ready" | "completed" | "failed";

export interface NewRequest {
  requestId: string;
  deviceId: string;
  inputPath: string;
  inputSha256: string;
  inputContentLength: number;
}

export interface AudioOutput {
  audioId: string;
  audioPath: string;
  audioUrl: string;
  expiresAt: number;
}

export interface VoiceRequestRecord extends NewRequest {
  status: RequestStatus;
  createdAt: number;
  audioId: string | null;
  audioPath: string | null;
  audioUrl: string | null;
  expiresAt: number | null;
  playbackState: "waiting" | "done" | "failed";
  errorCode: string | null;
}

export type RequestStoreErrorCode = "DEVICE_BUSY" | "REQUEST_NOT_FOUND" | "INVALID_REQUEST_STATE";

export class RequestStoreError extends Error {
  constructor(public readonly code: RequestStoreErrorCode) {
    super(code);
    this.name = "RequestStoreError";
  }
}

export class RequestStore {
  readonly #requests = new Map<string, VoiceRequestRecord>();
  readonly #activeByDevice = new Map<string, string>();

  create(input: NewRequest): VoiceRequestRecord {
    if (this.#activeByDevice.has(input.deviceId)) {
      throw new RequestStoreError("DEVICE_BUSY");
    }
    if (this.#requests.has(input.requestId)) {
      throw new RequestStoreError("INVALID_REQUEST_STATE");
    }

    const record: VoiceRequestRecord = {
      ...input,
      status: "accepted",
      createdAt: Date.now(),
      audioId: null,
      audioPath: null,
      audioUrl: null,
      expiresAt: null,
      playbackState: "waiting",
      errorCode: null,
    };
    this.#requests.set(input.requestId, record);
    this.#activeByDevice.set(input.deviceId, input.requestId);
    return record;
  }

  get(requestId: string): VoiceRequestRecord | undefined {
    return this.#requests.get(requestId);
  }

  getActiveForDevice(deviceId: string): VoiceRequestRecord | undefined {
    const requestId = this.#activeByDevice.get(deviceId);
    return requestId ? this.#requests.get(requestId) : undefined;
  }

  markAudioReady(requestId: string, output: AudioOutput): VoiceRequestRecord {
    const record = this.#require(requestId);
    if (record.status !== "accepted") {
      throw new RequestStoreError("INVALID_REQUEST_STATE");
    }

    Object.assign(record, output, { status: "audio_ready" satisfies RequestStatus });
    return record;
  }

  complete(requestId: string): VoiceRequestRecord {
    const record = this.#require(requestId);
    record.status = "completed";
    record.playbackState = "done";
    this.#release(record);
    return record;
  }

  fail(requestId: string, errorCode: string): VoiceRequestRecord {
    const record = this.#require(requestId);
    record.status = "failed";
    record.playbackState = "failed";
    record.errorCode = errorCode;
    this.#release(record);
    return record;
  }

  #require(requestId: string): VoiceRequestRecord {
    const record = this.#requests.get(requestId);
    if (!record) {
      throw new RequestStoreError("REQUEST_NOT_FOUND");
    }
    return record;
  }

  #release(record: VoiceRequestRecord): void {
    if (this.#activeByDevice.get(record.deviceId) === record.requestId) {
      this.#activeByDevice.delete(record.deviceId);
    }
  }
}
