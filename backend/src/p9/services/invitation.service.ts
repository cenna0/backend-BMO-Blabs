import { randomUUID } from "node:crypto";

import type { P9Repositories } from "../db/repositories.js";
import { createOpaqueToken, sha256Hex } from "../crypto.js";
import { P9Error } from "../errors.js";
import { normalizeEmail } from "../validation.js";
import { AuditService } from "./audit.service.js";

export interface InvitationCreateInput {
  email: string;
  expiresAt: Date;
  createdBy?: string;
  requestId?: string;
}

export class InvitationService {
  constructor(private readonly repositories: P9Repositories) {}

  async expireIfNeeded(secret: string, now = new Date(), requestId?: string): Promise<void> {
    const invitation = await this.repositories.invitation.findUnique({ where: { tokenHash: sha256Hex(secret) } });
    if (!invitation || invitation.status !== "ACTIVE" || invitation.expiresAt > now) return;
    const updated = await this.repositories.invitation.updateMany({
      where: { id: invitation.id, status: "ACTIVE" },
      data: { status: "EXPIRED" },
    });
    if (updated.count !== 1) return;
    await new AuditService(this.repositories).record({
      eventType: "INVITATION_EXPIRED",
      outcome: "success",
      actorType: "system",
      resourceType: "invitation",
      resourceId: invitation.id,
      ...(requestId === undefined ? {} : { context: { requestId } }),
    });
  }

  async create(input: InvitationCreateInput): Promise<{ id: string; email: string; secret: string; expiresAt: Date }> {
    const email = normalizeEmail(input.email);
    const secret = createOpaqueToken();
    const invitation = await this.repositories.invitation.create({
      data: {
        email,
        tokenHash: sha256Hex(secret),
        expiresAt: input.expiresAt,
        ...(input.createdBy === undefined ? {} : { createdBy: input.createdBy }),
      },
    });
    await new AuditService(this.repositories).record({
      eventType: "INVITATION_CREATED",
      outcome: "success",
      actorType: input.createdBy ? "user" : "operator",
      resourceType: "invitation",
      resourceId: invitation.id,
      ...(input.createdBy === undefined ? {} : { userId: input.createdBy }),
      ...(input.requestId === undefined ? {} : { context: { requestId: input.requestId } }),
      metadata: { email },
    });
    return { id: invitation.id, email, secret, expiresAt: invitation.expiresAt };
  }

  async revoke(invitationId: string, actorUserId?: string, requestId?: string): Promise<void> {
    const now = new Date();
    const updated = await this.repositories.invitation.updateMany({
      where: { id: invitationId, status: "ACTIVE" },
      data: { status: "REVOKED", revokedAt: now },
    });
    if (updated.count !== 1) {
      throw new P9Error("INVITATION_INVALID", 404, "Invitation is not available");
    }
    await new AuditService(this.repositories).record({
      eventType: "INVITATION_REVOKED",
      outcome: "success",
      actorType: actorUserId ? "user" : "operator",
      resourceType: "invitation",
      resourceId: invitationId,
      ...(actorUserId === undefined ? {} : { userId: actorUserId }),
      ...(requestId === undefined ? {} : { context: { requestId } }),
    });
  }

  async consumeForRegistration(
    secret: string,
    email: string,
    repositories: P9Repositories,
    now = new Date(),
  ): Promise<{ id: string; email: string }> {
    const normalizedEmail = normalizeEmail(email);
    const tokenHash = sha256Hex(secret);
    const invitation = await repositories.invitation.findUnique({ where: { tokenHash } });
    if (!invitation || invitation.status !== "ACTIVE" || invitation.expiresAt <= now || invitation.email !== normalizedEmail) {
      throw new P9Error("INVITATION_INVALID", 400, "Invitation is not valid");
    }
    const claimed = await repositories.invitation.updateMany({
      where: { id: invitation.id, status: "ACTIVE", expiresAt: { gt: now }, email: normalizedEmail },
      data: { status: "ACCEPTED", acceptedAt: now },
    });
    if (claimed.count !== 1) throw new P9Error("INVITATION_INVALID", 400, "Invitation is not valid");
    await new AuditService(repositories).record({
      eventType: "INVITATION_USED",
      outcome: "success",
      actorType: "anonymous",
      resourceType: "invitation",
      resourceId: invitation.id,
    });
    return { id: invitation.id, email: normalizedEmail };
  }

  static operatorRequestId(): string {
    return randomUUID();
  }
}
