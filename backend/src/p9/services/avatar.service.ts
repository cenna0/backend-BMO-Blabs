import type { PrismaClient } from "../../generated/prisma/client.js";
import { withP9Transaction } from "../db/client.js";
import { P9Repositories } from "../db/repositories.js";
import { P9Error } from "../errors.js";
import { avatarUrl } from "../avatar-key.js";
import type { AvatarStorage } from "./avatar-storage.service.js";

export class AvatarService {
  #activeUploads = 0;
  #reconciliationBarrier: Promise<void> | null = null;
  readonly #uploadWaiters: Array<() => void> = [];

  constructor(
    private readonly client: PrismaClient,
    private readonly storage: AvatarStorage,
    private readonly publicBaseUrl: string,
  ) {}

  async upload(userId: string, input: Buffer, declaredContentType: string, _requestId?: string) {
    await this.#enterUpload();
    try {
      return await this.#upload(userId, input, declaredContentType);
    } finally {
      this.#leaveUpload();
    }
  }

  async #upload(userId: string, input: Buffer, declaredContentType: string) {
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

  async reconcile(): Promise<{ removed: number }> {
    const leaveReconciliation = await this.#enterReconciliation();
    try {
      const users = await this.client.user.findMany({
        where: { avatarKey: { not: null } },
        select: { avatarKey: true },
      });
      const referencedKeys = new Set(users.flatMap((user) => user.avatarKey ? [user.avatarKey] : []));
      return await this.storage.reconcile(referencedKeys);
    } finally {
      leaveReconciliation();
    }
  }

  async #enterUpload(): Promise<void> {
    while (this.#reconciliationBarrier) await this.#reconciliationBarrier;
    this.#activeUploads += 1;
  }

  #leaveUpload(): void {
    this.#activeUploads -= 1;
    if (this.#activeUploads === 0) {
      for (const resolve of this.#uploadWaiters.splice(0)) resolve();
    }
  }

  async #enterReconciliation(): Promise<() => void> {
    while (this.#reconciliationBarrier) await this.#reconciliationBarrier;
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    this.#reconciliationBarrier = barrier;
    if (this.#activeUploads > 0) {
      await new Promise<void>((resolve) => { this.#uploadWaiters.push(resolve); });
    }
    return () => {
      if (this.#reconciliationBarrier === barrier) this.#reconciliationBarrier = null;
      release();
    };
  }
}
