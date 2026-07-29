import { randomUUID } from "node:crypto";
import { copyFile, lstat, mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

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
  cleanupBatchLimit?: number;
}

export interface TempAudioCleanupResult {
  deleted: number;
  failed: number;
}

export class TempAudioService {
  readonly #audio = new Map<string, TempAudioRecord>();
  readonly #expiredAudio = new Map<string, number>();
  readonly #now: () => number;
  readonly #inputWavMaxAgeMs: number;
  readonly #cleanupBatchLimit: number;

  constructor(
    private readonly root: string,
    private readonly ttlSeconds: number,
    options: TempAudioServiceOptions = {},
  ) {
    this.#now = options.now ?? Date.now;
    this.#inputWavMaxAgeMs = options.inputWavMaxAgeMs ?? 600_000;
    this.#cleanupBatchLimit = options.cleanupBatchLimit ?? 256;
    if (!Number.isInteger(this.#cleanupBatchLimit) || this.#cleanupBatchLimit <= 0) {
      throw new RangeError("cleanupBatchLimit must be a positive integer");
    }
  }

  async initialize(): Promise<void> {
    await mkdir(this.root, { recursive: true });
  }

  async startupCleanup(): Promise<void> {
    await this.cleanupExpiredOrphans();
  }

  async cleanupExpiredOrphans(): Promise<TempAudioCleanupResult> {
    await this.initialize();
    const root = resolve(this.root);
    const files = await readdir(root, { withFileTypes: true });
    const now = this.#now();
    let deleted = 0;
    let failed = 0;
    for (const file of files) {
      if (!file.isFile()) continue;
      const path = resolve(root, file.name);
      if (dirname(path) !== root) continue;
      let maxAgeMs: number | undefined;
      if (file.name.endsWith(".mp3")) {
        const audioId = file.name.slice(0, -4);
        if (isUuidV4(audioId) && !this.#audio.has(audioId)) {
          maxAgeMs = this.ttlSeconds * 1_000;
        }
      } else if (file.name.startsWith("input-") && file.name.endsWith(".wav")) {
        const requestId = file.name.slice(6, -4);
        if (isUuidV4(requestId)) {
          maxAgeMs = this.#inputWavMaxAgeMs;
        }
      }
      if (maxAgeMs === undefined) continue;
      try {
        const info = await lstat(path);
        if (!info.isFile() || now - info.mtimeMs < maxAgeMs) continue;
        if (deleted + failed >= this.#cleanupBatchLimit) break;
        await rm(path, { force: true });
        deleted += 1;
      } catch {
        failed += 1;
        if (deleted + failed >= this.#cleanupBatchLimit) break;
      }
    }
    return { deleted, failed };
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
