import type { PrismaClient } from "../../generated/prisma/client.js";
import { withP9Transaction } from "../db/client.js";
import { P9Repositories } from "../db/repositories.js";
import { P9Error } from "../errors.js";
import { avatarUrl } from "../avatar-key.js";
import type { AvatarStorage } from "./avatar-storage.service.js";

export class AvatarService {
  #nextReconciliationAt = 0;
  #reconciliation: Promise<AvatarReconciliationResult> | null = null;

  constructor(
    private readonly client: PrismaClient,
    private readonly storage: AvatarStorage,
    private readonly publicBaseUrl: string,
    private readonly reconciliationOptions: AvatarReconciliationOptions = {
      intervalMs: 3_600_000,
      graceMs: 86_400_000,
      scanLimit: 200,
      batchSize: 25,
    },
  ) {}

  async upload(userId: string, input: Buffer, declaredContentType: string, _requestId?: string) {
    const stored = await this.storage.store(input, declaredContentType);
    let priorKey: string | null = null;
    try {
      priorKey = await withP9Transaction(this.client, async (transaction) => {
        const repositories = new P9Repositories(transaction);
        await repositories.lockUser(userId);
        const current = await repositories.user.findUnique({
          where: { id: userId }, select: { id: true, avatarKey: true },
        });
        if (!current) throw new P9Error("OWNERSHIP_DENIED", 404, "User not found");
        await repositories.user.update({
          where: { id: userId },
          data: {
            avatarKey: stored.key,
            avatarContentType: stored.contentType,
            avatarByteSize: stored.byteSize,
          },
        });
        return current.avatarKey;
      });
    } catch (error) {
      await this.storage.delete(stored.key).catch(() => undefined);
      this.storage.release(stored.key);
      throw error;
    }
    this.storage.release(stored.key);
    if (priorKey) await this.storage.delete(priorKey).catch(() => undefined);
    return {
      avatarUrl: avatarUrl(this.publicBaseUrl, stored.key),
    };
  }

  async reconcile(now = new Date(), force = false): Promise<AvatarReconciliationResult> {
    if (this.#reconciliation) return this.#reconciliation;
    if (!force && now.getTime() < this.#nextReconciliationAt) {
      return { removed: 0, temporaryRemoved: 0, scanned: 0, skipped: true };
    }
    this.#nextReconciliationAt = now.getTime() + this.reconciliationOptions.intervalMs;
    const operation = this.#reconcile(now);
    this.#reconciliation = operation;
    try {
      return await operation;
    } finally {
      if (this.#reconciliation === operation) this.#reconciliation = null;
    }
  }

  async #reconcile(now: Date): Promise<AvatarReconciliationResult> {
    const candidates = await this.storage.findReconciliationCandidates({
      cutoff: new Date(now.getTime() - this.reconciliationOptions.graceMs),
      scanLimit: this.reconciliationOptions.scanLimit,
      batchSize: this.reconciliationOptions.batchSize,
    });
    let temporaryRemoved = 0;
    for (const fileName of candidates.temporaryFiles) {
      await this.storage.deleteTemporary(fileName);
      temporaryRemoved += 1;
    }
    let removed = 0;
    for (const key of candidates.avatarKeys) {
      const reference = await this.client.user.findFirst({
        where: { avatarKey: key },
        select: { id: true },
      });
      if (reference) continue;
      await this.storage.delete(key);
      removed += 1;
    }
    return { removed, temporaryRemoved, scanned: candidates.scanned, skipped: false };
  }
}

export interface AvatarReconciliationOptions {
  intervalMs: number;
  graceMs: number;
  scanLimit: number;
  batchSize: number;
}

export interface AvatarReconciliationResult {
  removed: number;
  temporaryRemoved: number;
  scanned: number;
  skipped: boolean;
}
