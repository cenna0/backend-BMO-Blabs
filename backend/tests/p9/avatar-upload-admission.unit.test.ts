import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";

import {
  AvatarUploadAdmissionAborted,
  BoundedAvatarUploadAdmission,
  createAvatarUploadAdmissionMiddleware,
} from "../../src/p9/http/avatar-upload-admission.js";

describe("avatar multipart admission", () => {
  it("bounds active and waiting leases and rejects excess work", async () => {
    const admission = new BoundedAvatarUploadAdmission(1, 1);
    const first = await admission.acquire();
    const secondPending = admission.acquire();
    expect(admission.snapshot()).toEqual({ active: 1, waiting: 1 });
    await expect(admission.acquire()).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
      status: 503,
    });

    first.release();
    const second = await secondPending;
    expect(admission.snapshot()).toEqual({ active: 1, waiting: 0 });
    second.release();
    second.release();
    expect(admission.snapshot()).toEqual({ active: 0, waiting: 0 });
  });

  it("removes a disconnected waiter without consuming a lease", async () => {
    const admission = new BoundedAvatarUploadAdmission(1, 1);
    const first = await admission.acquire();
    const controller = new AbortController();
    const waiting = admission.acquire(controller.signal);
    expect(admission.snapshot()).toEqual({ active: 1, waiting: 1 });

    controller.abort();
    await expect(waiting).rejects.toBeInstanceOf(AvatarUploadAdmissionAborted);
    expect(admission.snapshot()).toEqual({ active: 1, waiting: 0 });
    first.release();
    expect(admission.snapshot()).toEqual({ active: 0, waiting: 0 });
  });

  it.each(["finish", "close", "aborted"] as const)("releases an active lease on %s", async (event) => {
    const admission = new BoundedAvatarUploadAdmission(1, 0);
    const middleware = createAvatarUploadAdmissionMiddleware(admission);
    const request = new EventEmitter();
    const response = new EventEmitter();
    const next = vi.fn();

    middleware(request as any, response as any, next);
    await vi.waitFor(() => expect(next).toHaveBeenCalledOnce());
    expect(admission.snapshot()).toEqual({ active: 1, waiting: 0 });
    (event === "aborted" ? request : response).emit(event);
    expect(admission.snapshot()).toEqual({ active: 0, waiting: 0 });
  });

  it("removes a waiting HTTP request when its connection closes", async () => {
    const admission = new BoundedAvatarUploadAdmission(1, 1);
    const first = await admission.acquire();
    const middleware = createAvatarUploadAdmissionMiddleware(admission);
    const request = new EventEmitter();
    const response = new EventEmitter();
    const next = vi.fn();

    middleware(request as any, response as any, next);
    await vi.waitFor(() => expect(admission.snapshot()).toEqual({ active: 1, waiting: 1 }));
    response.emit("close");
    await vi.waitFor(() => expect(admission.snapshot()).toEqual({ active: 1, waiting: 0 }));
    expect(next).not.toHaveBeenCalled();
    first.release();
    expect(admission.snapshot()).toEqual({ active: 0, waiting: 0 });
  });
});
