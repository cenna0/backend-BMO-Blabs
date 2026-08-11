import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AvatarStorage } from "../../src/p9/services/avatar-storage.service.js";

const onePixelPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

const directories: string[] = [];
const storages: AvatarStorage[] = [];

afterEach(async () => {
  await Promise.all(storages.splice(0).map((storage) => storage.close()));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("avatar storage", () => {
  async function fixture(maxBytes = 5 * 1024 * 1024) {
    const directory = await mkdtemp(join(tmpdir(), "bmo-avatar-test-"));
    directories.push(directory);
    const storage = new AvatarStorage(directory, maxBytes);
    storages.push(storage);
    await storage.initialize();
    return { directory, storage };
  }

  it("decodes JPEG/PNG/WebP input, strips it to WebP, and uses only an opaque UUID key", async () => {
    const { directory, storage } = await fixture();
    const stored = await storage.store(onePixelPng, "image/png");
    expect(stored.key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(stored).toMatchObject({ contentType: "image/webp" });
    const encoded = await readFile(join(directory, `${stored.key}.webp`));
    expect(encoded.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(encoded.subarray(8, 12).toString("ascii")).toBe("WEBP");
    expect(stored.byteSize).toBe(encoded.length);
  });

  it("rejects MIME mismatch, malformed images, and oversized bodies", async () => {
    const { storage } = await fixture(onePixelPng.length);
    await expect(storage.store(onePixelPng, "image/jpeg")).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(storage.store(Buffer.from("not-an-image"), "image/png")).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(storage.store(Buffer.concat([onePixelPng, Buffer.from([0])]), "image/png")).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("rejects a highly compressed image whose decoded pixel count exceeds avatar bounds", async () => {
    const { storage } = await fixture();
    const compressed = await sharp({
      create: { width: 3_000, height: 3_000, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    }).png({ compressionLevel: 9 }).toBuffer();
    expect(compressed.length).toBeLessThan(5 * 1024 * 1024);

    await expect(storage.store(compressed, "image/png")).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("validates opaque reads exactly and cannot traverse the storage directory", async () => {
    const { storage } = await fixture();
    expect(await storage.read("../secret")).toBeNull();
    expect(await storage.read("4f37e5f8-a53a-4d18-8f9a-7b6e5cb8c003.webp")).toBeNull();
    const stored = await storage.store(onePixelPng, "image/png");
    expect(await storage.read(stored.key)).toBeInstanceOf(Buffer);
    await storage.delete(stored.key);
    expect(await storage.read(stored.key)).toBeNull();
  });

  it("cleans every temporary/final artifact when atomic publication fails", async () => {
    const directory = await mkdtemp(join(tmpdir(), "bmo-avatar-test-"));
    directories.push(directory);
    const storage = new AvatarStorage(directory, 5 * 1024 * 1024, {
      rename: async () => { throw new Error("rename failed"); },
    });
    await storage.initialize();

    await expect(storage.store(onePixelPng, "image/png")).rejects.toThrow("rename failed");
    expect(await readdir(directory)).toEqual([]);
  });

  it("discovers only aged exact avatar/temp candidates while preserving in-flight and unrelated files", async () => {
    const { directory, storage } = await fixture();
    const referenced = await storage.store(onePixelPng, "image/png");
    storage.release(referenced.key);
    const orphan = await storage.store(onePixelPng, "image/png");
    storage.release(orphan.key);
    const inFlight = await storage.store(onePixelPng, "image/png");
    const recent = await storage.store(onePixelPng, "image/png");
    storage.release(recent.key);
    const tempName = ".4f37e5f8-a53a-4d18-8f9a-7b6e5cb8c003.69234e09-073a-44ab-8dc2-7c4f225445e8.tmp";
    const recentTempName = ".e6472beb-5c87-4542-aef3-24e4cf95bd91.d6b87f39-17d3-4e65-9f3f-2032f233ffca.tmp";
    await writeFile(join(directory, tempName), "temporary");
    await writeFile(join(directory, recentTempName), "temporary");
    await writeFile(join(directory, ".upload-in-progress.tmp"), "temporary");
    await writeFile(join(directory, "not-an-avatar.webp"), "unrelated");
    const old = new Date("2020-01-01T00:00:00.000Z");
    await Promise.all([
      utimes(join(directory, `${referenced.key}.webp`), old, old),
      utimes(join(directory, `${orphan.key}.webp`), old, old),
      utimes(join(directory, `${inFlight.key}.webp`), old, old),
      utimes(join(directory, tempName), old, old),
    ]);
    const recentTime = new Date("2026-08-11T00:00:00.000Z");
    await Promise.all([
      utimes(join(directory, `${recent.key}.webp`), recentTime, recentTime),
      utimes(join(directory, recentTempName), recentTime, recentTime),
    ]);

    const candidates = await storage.findReconciliationCandidates({
      cutoff: new Date("2026-08-10T00:00:00.000Z"), scanLimit: 100, batchSize: 100,
    });
    expect(candidates.avatarKeys).toEqual(expect.arrayContaining([referenced.key, orphan.key]));
    expect(candidates.avatarKeys).not.toContain(inFlight.key);
    expect(candidates.avatarKeys).not.toContain(recent.key);
    expect(candidates.temporaryFiles).toEqual([tempName]);
    await storage.deleteTemporary(tempName);
    await storage.deleteTemporary("../unrelated");
    expect(await storage.read(referenced.key)).toBeInstanceOf(Buffer);
    expect(await storage.read(inFlight.key)).toBeInstanceOf(Buffer);
    expect(await readdir(directory)).toEqual(expect.arrayContaining([
      `${referenced.key}.webp`, `${inFlight.key}.webp`, ".upload-in-progress.tmp", "not-an-avatar.webp",
    ]));
    expect(await readdir(directory)).not.toContain(tempName);
  });

  it("bounds each maintenance directory pass", async () => {
    const { directory, storage } = await fixture();
    await Promise.all(Array.from({ length: 20 }, (_, index) => writeFile(join(directory, `unrelated-${index}`), "x")));
    await expect(storage.findReconciliationCandidates({
      cutoff: new Date(), scanLimit: 3, batchSize: 2,
    })).resolves.toMatchObject({ scanned: 3, avatarKeys: [], temporaryFiles: [] });
    await expect(storage.findReconciliationCandidates({
      cutoff: new Date(), scanLimit: 3, batchSize: 2,
    })).resolves.toMatchObject({ scanned: 3, avatarKeys: [], temporaryFiles: [] });
  });

  it("fails closed for symlinked, redirected, permissive, and foreign-owned storage directories", async () => {
    const root = await mkdtemp(join(tmpdir(), "bmo-avatar-safety-"));
    directories.push(root);
    const target = join(root, "target");
    await mkdir(target, { mode: 0o700 });

    const finalLink = join(root, "final-link");
    await symlink(target, finalLink, "dir");
    await expect(new AvatarStorage(finalLink, 1024).initialize()).rejects.toThrow(/real directory|symlink/u);

    const parentLink = join(root, "parent-link");
    await symlink(target, parentLink, "dir");
    await expect(new AvatarStorage(join(parentLink, "avatars"), 1024).initialize()).rejects.toThrow(/symlink/u);
    await expect(stat(join(target, "avatars"))).rejects.toMatchObject({ code: "ENOENT" });

    const permissive = join(root, "permissive");
    await mkdir(permissive, { mode: 0o700 });
    await chmod(permissive, 0o750);
    await expect(new AvatarStorage(permissive, 1024).initialize()).rejects.toThrow(/owner-only/u);

    if (typeof process.getuid === "function") {
      const foreign = join(root, "foreign");
      await mkdir(foreign, { mode: 0o700 });
      const storage = new AvatarStorage(foreign, 1024, {
        stat: async (path) => {
          const details = await stat(path);
          return { mode: details.mode, uid: process.getuid!() + 1, mtime: details.mtime };
        },
      });
      await expect(storage.initialize()).rejects.toThrow(/runtime user/u);
    }
  });

  it("closes its paginated directory handle when candidate inspection fails", async () => {
    const directory = await mkdtemp(join(tmpdir(), "bmo-avatar-scan-error-"));
    directories.push(directory);
    const scanError = new Error("candidate stat failed");
    const closeIterator = vi.fn().mockResolvedValue({ done: true, value: undefined });
    const iterator = {
      next: vi.fn().mockResolvedValueOnce({
        done: false,
        value: { name: "4f37e5f8-a53a-4d18-8f9a-7b6e5cb8c003.webp", isFile: () => true },
      }),
      return: closeIterator,
    };
    const storage = new AvatarStorage(directory, 1024, {
      openDirectory: async () => ({ [Symbol.asyncIterator]: () => iterator }),
      stat: async (path) => {
        if (path === directory) {
          const details = await stat(path);
          return { mode: details.mode, uid: details.uid, mtime: details.mtime };
        }
        throw scanError;
      },
    });
    storages.push(storage);
    await storage.initialize();

    await expect(storage.findReconciliationCandidates({
      cutoff: new Date(), scanLimit: 10, batchSize: 10,
    })).rejects.toBe(scanError);
    expect(closeIterator).toHaveBeenCalledOnce();
  });
});
