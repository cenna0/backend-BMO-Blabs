import { randomUUID } from "node:crypto";
import { lstat, mkdir, opendir, readFile, realpath, rename, stat, unlink, writeFile } from "node:fs/promises";
import { join, normalize, parse, sep } from "node:path";
import sharp, { type Sharp } from "sharp";

import { P9Error } from "../errors.js";
import { isAvatarKey, parseAvatarFileName } from "../avatar-key.js";
import {
  avatarProcessingQueue,
  type AvatarProcessingQueue,
} from "./avatar-processing.service.js";

const AVATAR_MAX_DECODED_PIXELS = 8_000_000;
const AVATAR_MAX_DIMENSION = 4_096;
const AVATAR_MAX_ASPECT_RATIO = 4;
const avatarTemporaryFilePattern = /^\.([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.tmp$/;

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
  lstat(path: string): Promise<{ isDirectory(): boolean; isSymbolicLink(): boolean }>;
  mkdir(path: string, options: { recursive: true; mode: number }): Promise<unknown>;
  openDirectory(path: string): Promise<AsyncIterable<{ name: string; isFile(): boolean }>>;
  readFile(path: string): Promise<Buffer>;
  realpath(path: string): Promise<string>;
  rename(oldPath: string, newPath: string): Promise<void>;
  stat(path: string): Promise<{ mode: number; uid: number; mtime: Date }>;
  unlink(path: string): Promise<void>;
  writeFile(path: string, data: Buffer, options: { flag: "wx"; mode: number }): Promise<void>;
}

const defaultFileOperations: AvatarFileOperations = {
  lstat,
  mkdir: async (path, options) => { await mkdir(path, options); },
  openDirectory: async (path) => opendir(path),
  readFile,
  realpath,
  rename,
  stat,
  unlink,
  writeFile,
};

export class AvatarStorage {
  readonly #fileOperations: AvatarFileOperations;
  readonly #inFlightKeys = new Set<string>();
  #scanIterator: AsyncIterator<{ name: string; isFile(): boolean }> | null = null;

  constructor(
    private readonly directory: string,
    private readonly maxBytes: number,
    fileOperations: Partial<AvatarFileOperations> = {},
    private readonly processingQueue: AvatarProcessingQueue = avatarProcessingQueue,
  ) {
    this.#fileOperations = { ...defaultFileOperations, ...fileOperations };
  }

  async initialize(): Promise<void> {
    await this.#validateExistingPath();
    await this.#fileOperations.mkdir(this.directory, { recursive: true, mode: 0o700 });
    const entry = await this.#fileOperations.lstat(this.directory);
    if (entry.isSymbolicLink() || !entry.isDirectory()) throw new Error("avatar storage must be a real directory");
    const resolved = normalize(await this.#fileOperations.realpath(this.directory));
    if (resolved !== normalize(this.directory)) throw new Error("avatar storage path cannot use symlinks");
    const details = await this.#fileOperations.stat(this.directory);
    if ((details.mode & 0o077) !== 0) throw new Error("avatar storage permissions must be owner-only");
    const runtimeUid = typeof process.getuid === "function" ? process.getuid() : undefined;
    if (runtimeUid !== undefined && details.uid !== runtimeUid) {
      throw new Error("avatar storage must be owned by the runtime user");
    }
  }

  async #validateExistingPath(): Promise<void> {
    const root = parse(this.directory).root;
    let current = root;
    for (const segment of this.directory.slice(root.length).split(sep).filter(Boolean)) {
      current = join(current, segment);
      try {
        const entry = await this.#fileOperations.lstat(current);
        if (entry.isSymbolicLink()) throw new Error("avatar storage path cannot use symlinks");
        if (!entry.isDirectory()) throw new Error("avatar storage ancestors must be directories");
      } catch (error) {
        if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return;
        throw error;
      }
    }
  }

  async store(input: Buffer, declaredContentType: string): Promise<StoredAvatar> {
    const expectedFormat = formatForMime.get(declaredContentType);
    if (!expectedFormat || input.length === 0 || input.length > this.maxBytes) {
      throw new P9Error("INVALID_INPUT", 400, "Invalid avatar image");
    }
    return this.processingQueue.run(async () => this.#processAndStore(input, expectedFormat));
  }

  async #processAndStore(input: Buffer, expectedFormat: string): Promise<StoredAvatar> {
    let pipeline: Sharp;
    let encoded: Buffer;
    try {
      pipeline = sharp(input, {
        failOn: "error",
        limitInputPixels: AVATAR_MAX_DECODED_PIXELS,
        sequentialRead: true,
      });
      const metadata = await pipeline.metadata();
      if (
        metadata.format !== expectedFormat ||
        !metadata.width ||
        !metadata.height ||
        metadata.width > AVATAR_MAX_DIMENSION ||
        metadata.height > AVATAR_MAX_DIMENSION ||
        metadata.width * metadata.height > AVATAR_MAX_DECODED_PIXELS ||
        Math.max(metadata.width / metadata.height, metadata.height / metadata.width) > AVATAR_MAX_ASPECT_RATIO ||
        (metadata.pages ?? 1) !== 1
      ) {
        throw new Error("image dimensions are outside avatar bounds");
      }
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

  async close(): Promise<void> {
    const iterator = this.#scanIterator;
    this.#scanIterator = null;
    await iterator?.return?.(undefined);
  }

  async findReconciliationCandidates(options: {
    cutoff: Date;
    scanLimit: number;
    batchSize: number;
  }): Promise<{ avatarKeys: string[]; temporaryFiles: string[]; scanned: number }> {
    const avatarKeys: string[] = [];
    const temporaryFiles: string[] = [];
    let scanned = 0;
    if (!this.#scanIterator) {
      const directory = await this.#fileOperations.openDirectory(this.directory);
      this.#scanIterator = directory[Symbol.asyncIterator]();
    }
    try {
      while (scanned < options.scanLimit && avatarKeys.length + temporaryFiles.length < options.batchSize) {
        const result = await this.#scanIterator.next();
        if (result.done) {
          this.#scanIterator = null;
          break;
        }
        const entry = result.value;
        scanned += 1;
        if (!entry.isFile()) continue;
        const avatarKey = parseAvatarFileName(entry.name);
        const isTemporary = avatarTemporaryFilePattern.test(entry.name);
        if ((!avatarKey && !isTemporary) || (avatarKey && this.#inFlightKeys.has(avatarKey))) continue;
        let details: { mtime: Date };
        try {
          details = await this.#fileOperations.stat(join(this.directory, entry.name));
        } catch (error) {
          if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") continue;
          throw error;
        }
        if (details.mtime > options.cutoff) continue;
        if (avatarKey) avatarKeys.push(avatarKey);
        else temporaryFiles.push(entry.name);
      }
    } catch (error) {
      const iterator = this.#scanIterator;
      this.#scanIterator = null;
      try {
        await iterator?.return?.(undefined);
      } catch {
        // Preserve the inspection failure that triggered cleanup.
      }
      throw error;
    }
    return { avatarKeys, temporaryFiles, scanned };
  }

  async deleteTemporary(fileName: string): Promise<void> {
    if (!avatarTemporaryFilePattern.test(fileName)) return;
    await this.#unlinkIfPresent(join(this.directory, fileName));
  }

  async #unlinkIfPresent(path: string): Promise<void> {
    try {
      await this.#fileOperations.unlink(path);
    } catch (error) {
      if (!(typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT")) throw error;
    }
  }

  #path(key: string): string {
    return join(this.directory, `${key}.webp`);
  }
}
