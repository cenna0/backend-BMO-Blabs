import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp, { type Sharp } from "sharp";

import { P9Error } from "../errors.js";
import { isAvatarKey } from "../avatar-key.js";

const formatForMime = new Map([
  ["image/jpeg", "jpeg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);

export interface StoredAvatar {
  key: string;
  contentType: "image/webp";
  byteSize: number;
}

interface AvatarFileOperations {
  mkdir(path: string, options: { recursive: true; mode: number }): Promise<unknown>;
  readFile(path: string): Promise<Buffer>;
  readdir(path: string): Promise<string[]>;
  rename(oldPath: string, newPath: string): Promise<void>;
  unlink(path: string): Promise<void>;
  writeFile(path: string, data: Buffer, options: { flag: "wx"; mode: number }): Promise<void>;
}

const defaultFileOperations: AvatarFileOperations = {
  mkdir: async (path, options) => { await mkdir(path, options); },
  readFile,
  readdir: async (path) => readdir(path),
  rename,
  unlink,
  writeFile,
};

export class AvatarStorage {
  readonly #fileOperations: AvatarFileOperations;
  readonly #inFlightKeys = new Set<string>();

  constructor(
    private readonly directory: string,
    private readonly maxBytes: number,
    fileOperations: Partial<AvatarFileOperations> = {},
  ) {
    this.#fileOperations = { ...defaultFileOperations, ...fileOperations };
  }

  async initialize(): Promise<void> {
    await this.#fileOperations.mkdir(this.directory, { recursive: true, mode: 0o700 });
  }

  async store(input: Buffer, declaredContentType: string): Promise<StoredAvatar> {
    const expectedFormat = formatForMime.get(declaredContentType);
    if (!expectedFormat || input.length === 0 || input.length > this.maxBytes) {
      throw new P9Error("INVALID_INPUT", 400, "Invalid avatar image");
    }
    let pipeline: Sharp;
    try {
      pipeline = sharp(input, { failOn: "error", limitInputPixels: 40_000_000 });
      const metadata = await pipeline.metadata();
      if (metadata.format !== expectedFormat || !metadata.width || !metadata.height) {
        throw new Error("image type mismatch");
      }
    } catch {
      throw new P9Error("INVALID_INPUT", 400, "Invalid avatar image");
    }
    let encoded: Buffer;
    try {
      encoded = await pipeline
        .rotate()
        .resize({ width: 1_024, height: 1_024, fit: "inside", withoutEnlargement: true })
        .webp({ quality: 85, effort: 4 })
        .toBuffer();
    } catch {
      throw new P9Error("INVALID_INPUT", 400, "Invalid avatar image");
    }
    const key = randomUUID();
    const temporaryPath = join(this.directory, `.${key}.${randomUUID()}.tmp`);
    this.#inFlightKeys.add(key);
    try {
      await this.#fileOperations.writeFile(temporaryPath, encoded, { flag: "wx", mode: 0o600 });
      await this.#fileOperations.rename(temporaryPath, this.#path(key));
      return { key, contentType: "image/webp", byteSize: encoded.length };
    } catch (error) {
      await this.#fileOperations.unlink(temporaryPath).catch(() => undefined);
      this.#inFlightKeys.delete(key);
      throw error;
    }
  }

  async read(key: string): Promise<Buffer | null> {
    if (!isAvatarKey(key)) return null;
    try {
      return await this.#fileOperations.readFile(this.#path(key));
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return null;
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    if (!isAvatarKey(key)) return;
    try {
      await this.#fileOperations.unlink(this.#path(key));
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return;
      throw error;
    } finally {
      this.#inFlightKeys.delete(key);
    }
  }

  release(key: string): void {
    this.#inFlightKeys.delete(key);
  }

  async reconcile(referencedKeys: ReadonlySet<string>): Promise<{ removed: number }> {
    const protectedInFlightKeys = new Set(this.#inFlightKeys);
    const names = await this.#fileOperations.readdir(this.directory);
    let removed = 0;
    for (const name of names) {
      const match = name.match(/^([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.webp$/);
      const key = match?.[1];
      if (!key || referencedKeys.has(key) || protectedInFlightKeys.has(key) || this.#inFlightKeys.has(key)) continue;
      try {
        await this.#fileOperations.unlink(join(this.directory, name));
        removed += 1;
      } catch (error) {
        if (!(typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT")) throw error;
      }
    }
    return { removed };
  }

  #path(key: string): string {
    return join(this.directory, `${key}.webp`);
  }
}
