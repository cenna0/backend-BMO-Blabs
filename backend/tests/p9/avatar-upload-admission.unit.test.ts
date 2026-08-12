import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";

import {
  AvatarUploadAdmissionAborted,
  BoundedAvatarUploadAdmission,
  createAvatarUploadAdmissionMiddleware,
  type AvatarUploadPrincipal,
} from "../../src/p9/http/avatar-upload-admission.js";

const principal = (ownerKey: string, ipKey: string): AvatarUploadPrincipal => ({ ownerKey, ipKey });
const limits = {
  maxActive: 2,
  maxWaiters: 4,
  maxActivePerOwner: 1,
  maxWaitersPerOwner: 2,
  maxActivePerIp: 1,
  maxWaitersPerIp: 2,
};

describe("avatar multipart admission", () => {
  it("bounds active and waiting leases and rejects excess work", async () => {
    const admission = new BoundedAvatarUploadAdmission({
      ...limits,
      maxActive: 1,
      maxWaiters: 1,
      maxWaitersPerOwner: 1,
      maxWaitersPerIp: 1,
    });
    const upload = principal("owner-1", "ip-1");
    const first = await admission.acquire(upload);
    const secondPending = admission.acquire(upload);
    expect(admission.snapshot()).toEqual({ active: 1, waiting: 1 });
    await expect(admission.acquire(upload)).rejects.toMatchObject({
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
    const admission = new BoundedAvatarUploadAdmission({
      ...limits,
      maxActive: 1,
      maxWaiters: 1,
      maxWaitersPerOwner: 1,
      maxWaitersPerIp: 1,
    });
    const upload = principal("owner-1", "ip-1");
    const first = await admission.acquire(upload);
    const controller = new AbortController();
    const waiting = admission.acquire(upload, controller.signal);
    expect(admission.snapshot()).toEqual({ active: 1, waiting: 1 });

    controller.abort();
    await expect(waiting).rejects.toBeInstanceOf(AvatarUploadAdmissionAborted);
    expect(admission.snapshot()).toEqual({ active: 1, waiting: 0 });
    first.release();
    expect(admission.snapshot()).toEqual({ active: 0, waiting: 0 });
  });

  it("reserves active and waiting capacity from a single owner", async () => {
    const admission = new BoundedAvatarUploadAdmission(limits);
    const firstPrincipal = principal("owner-1", "ip-1");
    const first = await admission.acquire(firstPrincipal);
    const secondPending = admission.acquire(principal("owner-1", "ip-2"));
    const thirdPending = admission.acquire(principal("owner-1", "ip-3"));
    await expect(admission.acquire(principal("owner-1", "ip-4"))).rejects.toMatchObject({ status: 503 });

    const other = await admission.acquire(principal("owner-2", "ip-4"));
    expect(admission.snapshot()).toEqual({ active: 2, waiting: 2 });

    first.release();
    const second = await secondPending;
    expect(admission.snapshot()).toEqual({ active: 2, waiting: 1 });
    second.release();
    const third = await thirdPending;
    other.release();
    third.release();
    expect(admission.snapshot()).toEqual({ active: 0, waiting: 0 });
  });

  it("reserves active and waiting capacity from a single proxy-aware IP", async () => {
    const admission = new BoundedAvatarUploadAdmission(limits);
    const first = await admission.acquire(principal("owner-1", "ip-shared"));
    const secondPending = admission.acquire(principal("owner-2", "ip-shared"));
    const thirdPending = admission.acquire(principal("owner-3", "ip-shared"));
    await expect(admission.acquire(principal("owner-4", "ip-shared"))).rejects.toMatchObject({ status: 503 });

    const other = await admission.acquire(principal("owner-4", "ip-other"));
    expect(admission.snapshot()).toEqual({ active: 2, waiting: 2 });

    first.release();
    const second = await secondPending;
    second.release();
    const third = await thirdPending;
    other.release();
    third.release();
    expect(admission.snapshot()).toEqual({ active: 0, waiting: 0 });
  });

  it("does not let a new principal bypass an older waiter", async () => {
    const admission = new BoundedAvatarUploadAdmission({
      ...limits,
      maxActive: 1,
      maxWaiters: 2,
      maxWaitersPerOwner: 2,
      maxWaitersPerIp: 2,
    });
    const first = await admission.acquire(principal("owner-1", "ip-1"));
    const olderWaiter = admission.acquire(principal("owner-2", "ip-2"));
    let newcomerResolved = false;
    const newcomer = admission.acquire(principal("owner-2", "ip-3")).then((lease) => {
      newcomerResolved = true;
      return lease;
    });

    expect(admission.snapshot()).toEqual({ active: 1, waiting: 2 });
    await Promise.resolve();
    expect(newcomerResolved).toBe(false);

    first.release();
    const olderLease = await olderWaiter;
    expect(newcomerResolved).toBe(false);
    olderLease.release();
    const newcomerLease = await newcomer;
    expect(newcomerResolved).toBe(true);
    newcomerLease.release();
    expect(admission.snapshot()).toEqual({ active: 0, waiting: 0 });
  });

  it.each(["finish", "close", "aborted"] as const)("releases an active lease on %s", async (event) => {
    const admission = new BoundedAvatarUploadAdmission({
      ...limits,
      maxActive: 1,
      maxWaiters: 0,
      maxWaitersPerOwner: 0,
      maxWaitersPerIp: 0,
    });
    const middleware = createAvatarUploadAdmissionMiddleware(admission, 1_000);
    const request = Object.assign(new EventEmitter(), { p9Auth: { userId: "owner-1" }, ip: "203.0.113.1" });
    const response = new EventEmitter();
    const next = vi.fn();

    middleware(request as any, response as any, next);
    await vi.waitFor(() => expect(next).toHaveBeenCalledOnce());
    expect(admission.snapshot()).toEqual({ active: 1, waiting: 0 });
    (event === "aborted" ? request : response).emit(event);
    expect(admission.snapshot()).toEqual({ active: 0, waiting: 0 });
  });

  it("removes a waiting HTTP request when its connection closes", async () => {
    const admission = new BoundedAvatarUploadAdmission({
      ...limits,
      maxActive: 1,
      maxWaiters: 1,
      maxWaitersPerOwner: 1,
      maxWaitersPerIp: 1,
    });
    const first = await admission.acquire(principal("owner-1", "ip-1"));
    const middleware = createAvatarUploadAdmissionMiddleware(admission, 1_000);
    const request = Object.assign(new EventEmitter(), { p9Auth: { userId: "owner-2" }, ip: "203.0.113.2" });
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

  it("expires a queued HTTP request and releases its waiter", async () => {
    const admission = new BoundedAvatarUploadAdmission({
      ...limits,
      maxActive: 1,
      maxWaiters: 1,
      maxWaitersPerOwner: 1,
      maxWaitersPerIp: 1,
    });
    const first = await admission.acquire(principal("owner-1", "ip-1"));
    const middleware = createAvatarUploadAdmissionMiddleware(admission, 10);
    const request = Object.assign(new EventEmitter(), { p9Auth: { userId: "owner-2" }, ip: "203.0.113.2" });
    const response = Object.assign(new EventEmitter(), {
      headersSent: false,
      setHeader: vi.fn(),
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    });
    const next = vi.fn();

    middleware(request as any, response as any, next);
    await vi.waitFor(() => expect(admission.snapshot()).toEqual({ active: 1, waiting: 1 }));
    await vi.waitFor(() => expect(response.status).toHaveBeenCalledWith(408));
    expect(response.json).toHaveBeenCalledWith({ error: "REQUEST_TIMEOUT" });
    expect(next).not.toHaveBeenCalled();
    first.release();
    expect(admission.snapshot()).toEqual({ active: 0, waiting: 0 });
  });

  it("expires an admitted request before parsing and releases its active lease", async () => {
    const admission = new BoundedAvatarUploadAdmission({
      ...limits,
      maxActive: 1,
      maxWaiters: 0,
      maxWaitersPerOwner: 0,
      maxWaitersPerIp: 0,
    });
    const middleware = createAvatarUploadAdmissionMiddleware(admission, 10);
    const request = Object.assign(new EventEmitter(), { p9Auth: { userId: "owner-1" }, ip: "203.0.113.1" });
    const response = Object.assign(new EventEmitter(), {
      headersSent: false,
      setHeader: vi.fn(),
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    });
    const next = vi.fn();

    middleware(request as any, response as any, next);
    await vi.waitFor(() => expect(next).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(response.status).toHaveBeenCalledWith(408));
    expect(response.json).toHaveBeenCalledWith({ error: "REQUEST_TIMEOUT" });
    expect(admission.snapshot()).toEqual({ active: 0, waiting: 0 });
  });
});
