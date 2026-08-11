import { z } from "zod";

import type { PrismaClient } from "../../generated/prisma/client.js";
import { createOpaqueToken, hashPassword, safeDigestEqual, sha256Hex } from "../crypto.js";
import { withP9Transaction } from "../db/client.js";
import { P9Repositories } from "../db/repositories.js";
import { P9Error } from "../errors.js";
import { normalizeEmail, parseDateOfBirth } from "../validation.js";
import { AuditService } from "./audit.service.js";

const verifySchema = z.object({ email: z.string(), dateOfBirth: z.string() }).strict();
const resetSchema = z.object({
  recoveryToken: z.string().min(1).max(256),
  newPassword: z.string().min(12).max(256),
}).strict();

export interface RecoveryContext {
  now?: Date;
  ip?: string;
  userAgent?: string;
  requestId?: string;
}

export class RecoveryService {
  constructor(
    private readonly client: PrismaClient,
    private readonly repositories: P9Repositories,
    private readonly options: { ttlSeconds: number; maxAttempts: number },
  ) {}

  async verify(input: unknown, context: RecoveryContext = {}) {
    let parsed: z.infer<typeof verifySchema>;
    let email: string;
    let dateOfBirth: Date;
    try {
      parsed = verifySchema.parse(input);
      email = normalizeEmail(parsed.email);
      dateOfBirth = parseDateOfBirth(parsed.dateOfBirth, context.now);
    } catch {
      throw new P9Error("RECOVERY_INVALID", 400, "Recovery verification failed");
    }
    const now = context.now ?? new Date();
    const recoveryToken = createOpaqueToken();
    const tokenVerifier = sha256Hex(recoveryToken);
    const user = await this.repositories.user.findUnique({
      where: { email }, select: { id: true, dateOfBirth: true },
    });
    const storedDate = user?.dateOfBirth?.toISOString().slice(0, 10) ?? "0000-00-00";
    const suppliedDate = dateOfBirth.toISOString().slice(0, 10);
    const matches = safeDigestEqual(storedDate, suppliedDate) && user !== null && user.dateOfBirth !== null;
    if (!matches || !user) {
      await this.repositories.passwordRecovery.findUnique({ where: { tokenVerifier } });
      await new AuditService(this.repositories).record({
        eventType: "PASSWORD_RECOVERY_VERIFICATION_FAILED",
        outcome: "denied",
        actorType: "anonymous",
        resourceType: "password_recovery",
        ...(context.requestId ? { context: { requestId: context.requestId } } : {}),
      }).catch(() => undefined);
      throw new P9Error("RECOVERY_INVALID", 400, "Recovery verification failed");
    }
    const expiresAt = new Date(now.getTime() + this.options.ttlSeconds * 1_000);
    await this.repositories.passwordRecovery.create({
      data: {
        userId: user.id,
        tokenVerifier,
        expiresAt,
        maxAttempts: this.options.maxAttempts,
        ...(context.ip ? { requestIpHash: sha256Hex(context.ip) } : {}),
        ...(context.userAgent ? { requestUserAgentHash: sha256Hex(context.userAgent) } : {}),
        ...(context.requestId ? { requestId: context.requestId } : {}),
      },
    });
    await new AuditService(this.repositories).record({
      eventType: "PASSWORD_RECOVERY_VERIFIED",
      outcome: "success",
      actorType: "user",
      resourceType: "password_recovery",
      userId: user.id,
      ...(context.requestId ? { context: { requestId: context.requestId } } : {}),
    });
    return { recoveryToken, expiresAt };
  }

  async reset(input: unknown, now = new Date()): Promise<void> {
    let parsed: z.infer<typeof resetSchema>;
    try {
      parsed = resetSchema.parse(input);
    } catch {
      throw new P9Error("RECOVERY_INVALID", 400, "Recovery token is invalid or expired");
    }
    const tokenVerifier = sha256Hex(parsed.recoveryToken);
    const passwordHash = await hashPassword(parsed.newPassword);
    const accepted = await withP9Transaction(this.client, async (transaction) => {
      const repositories = new P9Repositories(transaction);
      const recovery = await repositories.passwordRecovery.findUnique({ where: { tokenVerifier } });
      if (!recovery) return false;
      const claimed = await repositories.passwordRecovery.updateMany({
        where: {
          id: recovery.id,
          usedAt: null,
          expiresAt: { gt: now },
          attemptCount: { lt: recovery.maxAttempts },
        },
        data: { usedAt: now, lastAttemptAt: now, attemptCount: { increment: 1 } },
      });
      if (claimed.count !== 1) return false;
      await repositories.passwordCredential.update({
        where: { userId: recovery.userId },
        data: { passwordHash, algorithm: "argon2id" },
      });
      await repositories.session.updateMany({
        where: { userId: recovery.userId, revokedAt: null },
        data: { revokedAt: now, revokedReason: "password_reset" },
      });
      await repositories.refreshToken.updateMany({
        where: { session: { userId: recovery.userId }, revokedAt: null },
        data: { revokedAt: now },
      });
      await new AuditService(repositories).record({
        eventType: "PASSWORD_RESET_SUCCEEDED",
        outcome: "success",
        actorType: "user",
        resourceType: "user",
        resourceId: recovery.userId,
        userId: recovery.userId,
      });
      return true;
    });
    if (!accepted) throw new P9Error("RECOVERY_INVALID", 400, "Recovery token is invalid or expired");
  }
}
