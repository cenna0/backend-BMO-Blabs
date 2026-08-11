import type { PrismaClient } from "../../generated/prisma/client.js";
import { withP9Transaction } from "../db/client.js";
import { P9Repositories } from "../db/repositories.js";
import { P9Error } from "../errors.js";
import type { AvatarStorage } from "./avatar-storage.service.js";

export class AvatarService {
  constructor(
    private readonly client: PrismaClient,
    private readonly storage: AvatarStorage,
    private readonly publicBaseUrl: string,
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
      throw error;
    }
    if (priorKey) await this.storage.delete(priorKey);
    return {
      avatarUrl: `${this.publicBaseUrl.replace(/\/$/, "")}/media/avatars/${stored.key}.webp`,
    };
  }
}
