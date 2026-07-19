import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { isUuidV4 } from "../utils/uuid.js";

export interface TempAudioRecord {
  audioId: string;
  path: string;
  size: number;
  expiresAt: number;
}

export type AudioDownloadLookup =
  | { status: "available"; record: TempAudioRecord }
  | { status: "expired" }
  | { status: "unknown" };

export interface TempAudioServiceOptions {
  now?: () => number;
  inputWavMaxAgeMs?: number;
}

export class TempAudioService {
  readonly #audio = new Map<string, TempAudioRecord>();
  readonly #expiredAudio = new Map<string, number>();
  readonly #now: () => number;
  readonly #inputWavMaxAgeMs: number;

  constructor(
    private readonly root: string,
    private readonly ttlSeconds: number,
    options: TempAudioServiceOptions = {},
  ) {
    this.#now = options.now ?? Date.now;
    this.#inputWavMaxAgeMs = options.inputWavMaxAgeMs ?? 600_000;
  }

  async initialize(): Promise<void> {
    await mkdir(this.root, { recursive: true });
  }

  async startupCleanup(): Promise<void> {
    await this.initialize();
    const root = resolve(this.root);
    const files = await readdir(root, { withFileTypes: true });
    const now = this.#now();
    for (const file of files) {
      if (!file.isFile()) continue;
      const path = resolve(root, file.name);
      if (!path.startsWith(root)) continue;
      const info = await stat(path);
      const ageMs = now - info.mtimeMs;
      if (file.name.endsWith(".mp3")) {
        const audioId = file.name.slice(0, -4);
        if (isUuidV4(audioId) && ageMs >= this.ttlSeconds * 1_000) {
          await rm(path, { force: true });
        }
        continue;
      }
      if (file.name.startsWith("input-") && file.name.endsWith(".wav") && ageMs >= this.#inputWavMaxAgeMs) {
        await rm(path, { force: true });
      }
    }
  }

  async writeInput(requestId: string, bytes: Buffer): Promise<string> {
    const path = join(this.root, `input-${requestId}.wav`);
    await writeFile(path, bytes, { flag: "wx" });
    return path;
  }

  async deleteInput(path: string): Promise<void> {
    await rm(path, { force: true });
  }

  async createFromFixture(fixturePath: string): Promise<TempAudioRecord> {
    const audioId = randomUUID();
    const path = join(this.root, `${audioId}.mp3`);
    await copyFile(fixturePath, path);
    const info = await stat(path);
    const record = {
      audioId,
      path,
      size: info.size,
      expiresAt: this.#now() + this.ttlSeconds * 1_000,
    };
    this.#audio.set(audioId, record);
    return record;
  }

  async createFromBytes(bytes: Buffer): Promise<TempAudioRecord> {
    const audioId = randomUUID();
    const path = join(this.root, `${audioId}.mp3`);
    await writeFile(path, bytes, { flag: "wx" });
    const info = await stat(path);
    const record = {
      audioId,
      path,
      size: info.size,
      expiresAt: this.#now() + this.ttlSeconds * 1_000,
    };
    this.#audio.set(audioId, record);
    return record;
  }

  get(audioId: string): TempAudioRecord | undefined {
    return this.#audio.get(audioId);
  }

  getForDownload(audioId: string): AudioDownloadLookup {
    const record = this.#audio.get(audioId);
    if (!record) {
      return this.#expiredAudio.has(audioId) ? { status: "expired" } : { status: "unknown" };
    }
    if (record.expiresAt <= this.#now()) {
      return { status: "expired" };
    }
    return { status: "available", record };
  }

  async deleteAudio(audioId: string): Promise<void> {
    const record = this.#audio.get(audioId);
    if (!record) return;
    this.#audio.delete(audioId);
    await rm(record.path, { force: true });
  }

  async expireAudio(audioId: string): Promise<void> {
    const record = this.#audio.get(audioId);
    if (record) {
      this.#audio.delete(audioId);
      this.#expiredAudio.set(audioId, this.#now());
      await rm(record.path, { force: true });
      return;
    }
    this.#expiredAudio.set(audioId, this.#now());
  }

  collectExpiredAudioTombstones(retentionMs: number, maxEntries = 1_000): void {
    const now = this.#now();
    for (const [audioId, expiredAt] of this.#expiredAudio) {
      if (now - expiredAt > retentionMs) {
        this.#expiredAudio.delete(audioId);
      }
    }
    while (this.#expiredAudio.size > maxEntries) {
      const oldest = [...this.#expiredAudio.entries()].sort((left, right) => left[1] - right[1])[0];
      if (!oldest) break;
      this.#expiredAudio.delete(oldest[0]);
    }
  }
}
