import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp, { type Sharp } from "sharp";

import { P9Error } from "../errors.js";

const opaqueKeyPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
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

export class AvatarStorage {
  constructor(
    private readonly directory: string,
    private readonly maxBytes: number,
  ) {}

  async initialize(): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
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
    await writeFile(this.#path(key), encoded, { flag: "wx", mode: 0o600 });
    return { key, contentType: "image/webp", byteSize: encoded.length };
  }

  async read(key: string): Promise<Buffer | null> {
    if (!opaqueKeyPattern.test(key)) return null;
    try {
      return await readFile(this.#path(key));
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return null;
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    if (!opaqueKeyPattern.test(key)) return;
    try {
      await unlink(this.#path(key));
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return;
      throw error;
    }
  }

  #path(key: string): string {
    return join(this.directory, `${key}.webp`);
  }
}

export function isAvatarKey(value: string): boolean {
  return opaqueKeyPattern.test(value);
}
