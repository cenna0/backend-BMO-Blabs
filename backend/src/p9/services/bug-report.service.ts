import { createHash, randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { PrismaClient } from "../../generated/prisma/client.js";
import { P9Repositories } from "../db/repositories.js";
import { withP9Transaction } from "../db/client.js";
import { P9Error } from "../errors.js";

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const CONTENT_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export class BugReportService {
  constructor(private readonly options: { client: PrismaClient; repositories: P9Repositories; storageDir: string }) {}

  async create(userId: string, input: { category: string; description: string; context?: string; includeScreenshot: boolean }, files: Express.Multer.File[], requestId?: string): Promise<{ id: string; status: "received" }> {
    const accepted = input.includeScreenshot ? files : [];
    if (accepted.length > 5 || accepted.some((file) => file.size > MAX_FILE_BYTES || !CONTENT_TYPES.has(file.mimetype))) throw new P9Error("INVALID_INPUT", 400, "Invalid bug report attachment");
    const id = randomUUID();
    const writes: Array<{ file: Express.Multer.File; key: string; temp: string }> = [];
    try {
      await mkdir(this.options.storageDir, { recursive: true, mode: 0o700 });
      for (const file of accepted) {
        const key = `${randomUUID()}.bin`;
        const temp = join(this.options.storageDir, `.${key}.tmp`);
        await writeFile(temp, file.buffer, { mode: 0o600, flag: "wx" });
        await rename(temp, join(this.options.storageDir, key));
        writes.push({ file, key, temp });
      }
      await withP9Transaction(this.options.client, async (tx) => {
        const repo = new P9Repositories(tx);
        await repo.bugReport.create({ data: { id, userId, category: input.category, description: input.description, ...(input.context ? { context: input.context } : {}), attachments: { create: writes.map(({ file, key }) => ({ storageKey: key, contentType: file.mimetype, byteSize: file.size, sha256: createHash("sha256").update(file.buffer).digest("hex") })) } } });
        await repo.auditEvent.create({ data: { eventType: "bug_report.created", outcome: "success", actorType: "user", resourceType: "bug_report", resourceId: id, userId, ...(requestId ? { requestId } : {}), metadata: {} } });
      });
      return { id, status: "received" };
    } catch (error) {
      await Promise.all(writes.map(({ key }) => rm(join(this.options.storageDir, key), { force: true })));
      await Promise.all(writes.map(({ temp }) => rm(temp, { force: true })));
      throw error;
    }
  }
}
