import { describe, expect, it, vi } from "vitest";

import { InvitationService } from "../../src/p9/services/invitation.service.js";

describe("P9 invitation lifecycle", () => {
  it("persists expiry and audit state before registration rejects", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const auditCreate = vi.fn().mockResolvedValue(undefined);
    const repositories = {
      invitation: {
        findUnique: vi.fn().mockResolvedValue({
          id: "invitation-1",
          status: "ACTIVE",
          expiresAt: new Date("2026-08-03T00:00:00.000Z"),
        }),
        updateMany,
      },
      auditEvent: { create: auditCreate },
    } as never;
    const service = new InvitationService(repositories);

    await service.expireIfNeeded("review-only-invitation", new Date("2026-08-04T00:00:00.000Z"), "request-1");

    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "invitation-1", status: "ACTIVE" },
      data: { status: "EXPIRED" },
    });
    expect(auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ eventType: "INVITATION_EXPIRED", requestId: "request-1" }),
    }));
  });
});
