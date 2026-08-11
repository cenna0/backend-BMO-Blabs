import type { Request, RequestHandler } from "express";

import { P9Error } from "../errors.js";

export interface AvatarUploadLease {
  release(): void;
}

export interface AvatarUploadAdmission {
  acquire(signal?: AbortSignal): Promise<AvatarUploadLease>;
}

export class AvatarUploadAdmissionAborted extends Error {
  constructor() {
    super("avatar upload admission aborted");
    this.name = "AvatarUploadAdmissionAborted";
  }
}

interface AdmissionWaiter {
  signal?: AbortSignal;
  resolve(lease: AvatarUploadLease): void;
  reject(error: AvatarUploadAdmissionAborted): void;
  onAbort?: () => void;
}

interface AvatarUploadRequestAdmission {
  lease: AvatarUploadLease;
  retainedUntilSettled: boolean;
  released: boolean;
}

const requestAdmissions = new WeakMap<Request, AvatarUploadRequestAdmission>();

function releaseRequestAdmission(state: AvatarUploadRequestAdmission): void {
  if (state.released) return;
  state.released = true;
  state.lease.release();
}

export function retainAvatarUploadAdmission(request: Request): void {
  const state = requestAdmissions.get(request);
  if (!state || state.released) throw new Error("avatar upload admission is not active");
  state.retainedUntilSettled = true;
}

export function releaseAvatarUploadAdmission(request: Request): void {
  const state = requestAdmissions.get(request);
  if (!state) return;
  requestAdmissions.delete(request);
  releaseRequestAdmission(state);
}

export class BoundedAvatarUploadAdmission implements AvatarUploadAdmission {
  #active = 0;
  readonly #waiters: AdmissionWaiter[] = [];

  constructor(
    private readonly maxActive: number,
    private readonly maxWaiters: number,
  ) {
    if (!Number.isInteger(maxActive) || maxActive < 1 || !Number.isInteger(maxWaiters) || maxWaiters < 0) {
      throw new Error("invalid avatar upload admission bounds");
    }
  }

  async acquire(signal?: AbortSignal): Promise<AvatarUploadLease> {
    if (signal?.aborted) throw new AvatarUploadAdmissionAborted();
    if (this.#active < this.maxActive) {
      this.#active += 1;
      return this.#lease();
    }
    if (this.#waiters.length >= this.maxWaiters) {
      throw new P9Error("SERVICE_UNAVAILABLE", 503, "Avatar upload temporarily unavailable");
    }
    return new Promise<AvatarUploadLease>((resolve, reject) => {
      const waiter: AdmissionWaiter = { resolve, reject, ...(signal ? { signal } : {}) };
      if (signal) {
        waiter.onAbort = () => {
          const index = this.#waiters.indexOf(waiter);
          if (index >= 0) this.#waiters.splice(index, 1);
          reject(new AvatarUploadAdmissionAborted());
        };
        signal.addEventListener("abort", waiter.onAbort, { once: true });
      }
      this.#waiters.push(waiter);
    });
  }

  snapshot(): { active: number; waiting: number } {
    return { active: this.#active, waiting: this.#waiters.length };
  }

  #lease(): AvatarUploadLease {
    let released = false;
    return {
      release: () => {
        if (released) return;
        released = true;
        const next = this.#waiters.shift();
        if (next) {
          if (next.signal && next.onAbort) next.signal.removeEventListener("abort", next.onAbort);
          next.resolve(this.#lease());
        } else {
          this.#active -= 1;
        }
      },
    };
  }
}

export function createAvatarUploadAdmissionMiddleware(admission: AvatarUploadAdmission): RequestHandler {
  return (request, response, next) => {
    const controller = new AbortController();
    const abortWaiting = () => { controller.abort(); };
    request.once("aborted", abortWaiting);
    response.once("close", abortWaiting);
    void admission.acquire(controller.signal).then((lease) => {
      request.off("aborted", abortWaiting);
      response.off("close", abortWaiting);
      if (controller.signal.aborted) {
        lease.release();
        return;
      }
      const state: AvatarUploadRequestAdmission = {
        lease,
        retainedUntilSettled: false,
        released: false,
      };
      requestAdmissions.set(request, state);
      const releaseForTransport = () => {
        if (state.retainedUntilSettled) return;
        requestAdmissions.delete(request);
        releaseRequestAdmission(state);
      };
      request.once("aborted", releaseForTransport);
      response.once("finish", releaseForTransport);
      response.once("close", releaseForTransport);
      try {
        next();
      } catch (error) {
        requestAdmissions.delete(request);
        releaseRequestAdmission(state);
        next(error);
      }
    }).catch((error: unknown) => {
      request.off("aborted", abortWaiting);
      response.off("close", abortWaiting);
      if (error instanceof AvatarUploadAdmissionAborted) return;
      next(error);
    });
  };
}

export const avatarUploadAdmission = new BoundedAvatarUploadAdmission(2, 4);
