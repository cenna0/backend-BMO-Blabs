import { randomUUID } from "node:crypto";
import { copyFile, mkdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface TempAudioRecord {
  audioId: string;
  path: string;
  size: number;
  expiresAt: number;
}

export class TempAudioService {
  readonly #audio = new Map<string, TempAudioRecord>();

  constructor(
    private readonly root: string,
    private readonly ttlSeconds: number,
  ) {}

  async initialize(): Promise<void> {
    await mkdir(this.root, { recursive: true });
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
      expiresAt: Date.now() + this.ttlSeconds * 1_000,
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
      expiresAt: Date.now() + this.ttlSeconds * 1_000,
    };
    this.#audio.set(audioId, record);
    return record;
  }

  get(audioId: string): TempAudioRecord | undefined {
    return this.#audio.get(audioId);
  }

  async deleteAudio(audioId: string): Promise<void> {
    const record = this.#audio.get(audioId);
    if (!record) return;
    this.#audio.delete(audioId);
    await rm(record.path, { force: true });
  }
}
