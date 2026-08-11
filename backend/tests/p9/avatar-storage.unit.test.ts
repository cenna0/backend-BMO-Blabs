import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { AvatarStorage } from "../../src/p9/services/avatar-storage.service.js";

const onePixelPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("avatar storage", () => {
  async function fixture(maxBytes = 5 * 1024 * 1024) {
    const directory = await mkdtemp(join(tmpdir(), "bmo-avatar-test-"));
    directories.push(directory);
    const storage = new AvatarStorage(directory, maxBytes);
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

  it("reconciles only unreferenced exact UUID WebP files and preserves referenced/in-flight files", async () => {
    const { directory, storage } = await fixture();
    const referenced = await storage.store(onePixelPng, "image/png");
    storage.release(referenced.key);
    const orphan = await storage.store(onePixelPng, "image/png");
    storage.release(orphan.key);
    const inFlight = await storage.store(onePixelPng, "image/png");
    await writeFile(join(directory, ".upload-in-progress.tmp"), "temporary");
    await writeFile(join(directory, "not-an-avatar.webp"), "unrelated");

    await expect(storage.reconcile(new Set([referenced.key]))).resolves.toEqual({ removed: 1 });
    expect(await storage.read(referenced.key)).toBeInstanceOf(Buffer);
    expect(await storage.read(inFlight.key)).toBeInstanceOf(Buffer);
    expect(await storage.read(orphan.key)).toBeNull();
    expect(await readdir(directory)).toEqual(expect.arrayContaining([
      `${referenced.key}.webp`, `${inFlight.key}.webp`, ".upload-in-progress.tmp", "not-an-avatar.webp",
    ]));
  });

  it("keeps the in-flight snapshot protected when an upload commits during directory scanning", async () => {
    const directory = await mkdtemp(join(tmpdir(), "bmo-avatar-test-"));
    directories.push(directory);
    let storage: AvatarStorage;
    let committingKey = "";
    storage = new AvatarStorage(directory, 5 * 1024 * 1024, {
      readdir: async (path) => {
        storage.release(committingKey);
        return readdir(path);
      },
    });
    await storage.initialize();
    const committing = await storage.store(onePixelPng, "image/png");
    committingKey = committing.key;

    await expect(storage.reconcile(new Set())).resolves.toEqual({ removed: 0 });
    expect(await storage.read(committing.key)).toBeInstanceOf(Buffer);
  });
});
