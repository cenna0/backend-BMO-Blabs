export type RequestStatus =
  | "accepted"
  | "transcribing"
  | "thinking"
  | "generating_voice"
  | "audio_ready"
  | "completed"
  | "failed"
  | "expired";

export type PublicRequestStatus = "processing" | "audio_ready" | "completed" | "failed" | "expired";

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
  terminalAt: number | null;
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

export interface RequestStoreOptions {
  now?: () => number;
  tombstoneTtlMs?: number;
  maxEntries?: number;
}

export function toPublicRequestStatus(record: VoiceRequestRecord): PublicRequestStatus {
  if (
    record.status === "accepted" ||
    record.status === "transcribing" ||
    record.status === "thinking" ||
    record.status === "generating_voice"
  ) {
    return "processing";
  }
  return record.status;
}

export class RequestStore {
  readonly #requests = new Map<string, VoiceRequestRecord>();
  readonly #activeByDevice = new Map<string, string>();
  readonly #now: () => number;
  readonly #tombstoneTtlMs: number;
  readonly #maxEntries: number;

  constructor(options: RequestStoreOptions = {}) {
    this.#now = options.now ?? Date.now;
    this.#tombstoneTtlMs = options.tombstoneTtlMs ?? 600_000;
    this.#maxEntries = options.maxEntries ?? 1_000;
  }

  create(input: NewRequest): VoiceRequestRecord {
    this.collectGarbage();
    if (this.#activeByDevice.has(input.deviceId)) {
      throw new RequestStoreError("DEVICE_BUSY");
    }
    if (this.#requests.has(input.requestId)) {
      throw new RequestStoreError("INVALID_REQUEST_STATE");
    }

    const record: VoiceRequestRecord = {
      ...input,
      status: "accepted",
      createdAt: this.#now(),
      terminalAt: null,
      audioId: null,
      audioPath: null,
      audioUrl: null,
      expiresAt: null,
      playbackState: "waiting",
      errorCode: null,
    };
    this.#requests.set(input.requestId, record);
    this.#activeByDevice.set(input.deviceId, input.requestId);
    this.collectGarbage();
    return record;
  }

  get(requestId: string): VoiceRequestRecord | undefined {
    return this.#requests.get(requestId);
  }

  getActiveForDevice(deviceId: string): VoiceRequestRecord | undefined {
    const requestId = this.#activeByDevice.get(deviceId);
    return requestId ? this.#requests.get(requestId) : undefined;
  }

  setStatus(
    requestId: string,
    status: Exclude<RequestStatus, "completed" | "failed" | "expired">,
  ): VoiceRequestRecord {
    const record = this.#require(requestId);
    if (this.#isTerminal(record)) {
      throw new RequestStoreError("INVALID_REQUEST_STATE");
    }
    record.status = status;
    return record;
  }

  markAudioReady(requestId: string, output: AudioOutput): VoiceRequestRecord {
    const record = this.#require(requestId);
    if (
      record.status !== "accepted" &&
      record.status !== "transcribing" &&
      record.status !== "thinking" &&
      record.status !== "generating_voice"
    ) {
      throw new RequestStoreError("INVALID_REQUEST_STATE");
    }

    Object.assign(record, output, { status: "audio_ready" satisfies RequestStatus });
    return record;
  }

  complete(requestId: string): VoiceRequestRecord {
    const record = this.#require(requestId);
    if (record.status === "completed") return record;
    if (this.#isTerminal(record)) return record;
    record.status = "completed";
    record.playbackState = "done";
    record.terminalAt = this.#now();
    this.#release(record);
    return record;
  }

  fail(requestId: string, errorCode: string): VoiceRequestRecord {
    const record = this.#require(requestId);
    if (record.status === "failed" && record.errorCode === errorCode) return record;
    if (this.#isTerminal(record)) return record;
    record.status = "failed";
    record.playbackState = "failed";
    record.errorCode = errorCode;
    record.terminalAt = this.#now();
    this.#release(record);
    return record;
  }

  expire(requestId: string): VoiceRequestRecord {
    const record = this.#require(requestId);
    if (record.status === "expired") return record;
    if (this.#isTerminal(record)) return record;
    record.status = "expired";
    record.playbackState = "failed";
    record.errorCode = "AUDIO_EXPIRED";
    record.terminalAt = this.#now();
    this.#release(record);
    return record;
  }

  getByAudioId(audioId: string): VoiceRequestRecord | undefined {
    for (const record of this.#requests.values()) {
      if (record.audioId === audioId) return record;
    }
    return undefined;
  }

  expireReadyBefore(now = this.#now()): VoiceRequestRecord[] {
    const expired: VoiceRequestRecord[] = [];
    for (const record of this.#requests.values()) {
      if (record.status === "audio_ready" && record.expiresAt !== null && record.expiresAt <= now) {
        expired.push(this.expire(record.requestId));
      }
    }
    return expired;
  }

  collectGarbage(): void {
    const now = this.#now();
    for (const [requestId, record] of this.#requests) {
      if (record.terminalAt !== null && now - record.terminalAt > this.#tombstoneTtlMs) {
        this.#requests.delete(requestId);
      }
    }

    while (this.#requests.size > this.#maxEntries) {
      const terminal = [...this.#requests.values()]
        .filter((record) => record.terminalAt !== null)
        .sort((left, right) => left.terminalAt! - right.terminalAt!)[0];
      if (!terminal) break;
      this.#requests.delete(terminal.requestId);
    }
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

  #isTerminal(record: VoiceRequestRecord): boolean {
    return record.status === "completed" || record.status === "failed" || record.status === "expired";
  }
}
