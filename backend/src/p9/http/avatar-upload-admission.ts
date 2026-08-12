import type { Request, RequestHandler } from "express";
import { ipKeyGenerator } from "express-rate-limit";

import { sha256Hex } from "../crypto.js";
import { P9Error } from "../errors.js";

export interface AvatarUploadLease {
  release(): void;
}

export interface AvatarUploadPrincipal {
  ownerKey: string;
  ipKey: string;
}

export interface AvatarUploadAdmission {
  acquire(principal: AvatarUploadPrincipal, signal?: AbortSignal): Promise<AvatarUploadLease>;
}

export class AvatarUploadAdmissionAborted extends Error {
  constructor() {
    super("avatar upload admission aborted");
    this.name = "AvatarUploadAdmissionAborted";
  }
}

interface AdmissionWaiter {
  principal: AvatarUploadPrincipal;
  signal?: AbortSignal;
  resolve(lease: AvatarUploadLease): void;
  reject(error: AvatarUploadAdmissionAborted): void;
  onAbort?: () => void;
}

export interface AvatarUploadAdmissionLimits {
  maxActive: number;
  maxWaiters: number;
  maxActivePerOwner: number;
  maxWaitersPerOwner: number;
  maxActivePerIp: number;
  maxWaitersPerIp: number;
}

interface AvatarUploadRequestAdmission {
  lease: AvatarUploadLease;
  retainedUntilSettled: boolean;
  released: boolean;
}

interface AvatarUploadTimeoutState {
  timer: ReturnType<typeof setTimeout>;
  timedOut: boolean;
}

const requestAdmissions = new WeakMap<Request, AvatarUploadRequestAdmission>();
const requestTimeouts = new WeakMap<Request, AvatarUploadTimeoutState>();
const timedOutAvatarRequests = new WeakSet<Request>();

function clearAvatarUploadTimeout(request: Request): void {
  const state = requestTimeouts.get(request);
  if (!state) return;
  clearTimeout(state.timer);
  requestTimeouts.delete(request);
}

function releaseRequestAdmission(state: AvatarUploadRequestAdmission): void {
  if (state.released) return;
  state.released = true;
  state.lease.release();
}

export function retainAvatarUploadAdmission(request: Request): void {
  const state = requestAdmissions.get(request);
  if (!state || state.released) throw new Error("avatar upload admission is not active");
  state.retainedUntilSettled = true;
  clearAvatarUploadTimeout(request);
}

export function releaseAvatarUploadAdmission(request: Request): void {
  clearAvatarUploadTimeout(request);
  const state = requestAdmissions.get(request);
  if (!state) return;
  requestAdmissions.delete(request);
  releaseRequestAdmission(state);
}

export function isAvatarUploadTimedOut(request: Request): boolean {
  return timedOutAvatarRequests.has(request);
}

export class BoundedAvatarUploadAdmission implements AvatarUploadAdmission {
  #active = 0;
  readonly #waiters: AdmissionWaiter[] = [];
  readonly #activeOwners = new Map<string, number>();
  readonly #activeIps = new Map<string, number>();
  readonly #waitingOwners = new Map<string, number>();
  readonly #waitingIps = new Map<string, number>();

  constructor(private readonly limits: AvatarUploadAdmissionLimits) {
    const positive = [limits.maxActive, limits.maxActivePerOwner, limits.maxActivePerIp];
    const nonnegative = [limits.maxWaiters, limits.maxWaitersPerOwner, limits.maxWaitersPerIp];
    if (
      positive.some((value) => !Number.isInteger(value) || value < 1) ||
      nonnegative.some((value) => !Number.isInteger(value) || value < 0) ||
      limits.maxActivePerOwner > limits.maxActive ||
      limits.maxActivePerIp > limits.maxActive ||
      limits.maxWaitersPerOwner > limits.maxWaiters ||
      limits.maxWaitersPerIp > limits.maxWaiters
    ) {
      throw new Error("invalid avatar upload admission bounds");
    }
  }

  async acquire(principal: AvatarUploadPrincipal, signal?: AbortSignal): Promise<AvatarUploadLease> {
    if (signal?.aborted) throw new AvatarUploadAdmissionAborted();
    if (this.#canActivate(principal) &&
      (this.#waiters.length === 0 || !this.#waiters.some((waiter) => this.#canActivate(waiter.principal)))) {
      this.#activate(principal);
      return this.#lease(principal);
    }
    if (!this.#canQueue(principal)) {
      throw new P9Error("SERVICE_UNAVAILABLE", 503, "Avatar upload temporarily unavailable");
    }
    return new Promise<AvatarUploadLease>((resolve, reject) => {
      const waiter: AdmissionWaiter = { principal, resolve, reject, ...(signal ? { signal } : {}) };
      if (signal) {
        waiter.onAbort = () => {
          const index = this.#waiters.indexOf(waiter);
          if (index >= 0) {
            this.#waiters.splice(index, 1);
            this.#decrement(this.#waitingOwners, principal.ownerKey);
            this.#decrement(this.#waitingIps, principal.ipKey);
          }
          reject(new AvatarUploadAdmissionAborted());
        };
        signal.addEventListener("abort", waiter.onAbort, { once: true });
      }
      this.#waiters.push(waiter);
      this.#increment(this.#waitingOwners, principal.ownerKey);
      this.#increment(this.#waitingIps, principal.ipKey);
    });
  }

  snapshot(): { active: number; waiting: number } {
    return { active: this.#active, waiting: this.#waiters.length };
  }

  #lease(principal: AvatarUploadPrincipal): AvatarUploadLease {
    let released = false;
    return {
      release: () => {
        if (released) return;
        released = true;
        this.#deactivate(principal);
        this.#dispatch();
      },
    };
  }

  #canActivate(principal: AvatarUploadPrincipal): boolean {
    return this.#active < this.limits.maxActive &&
      (this.#activeOwners.get(principal.ownerKey) ?? 0) < this.limits.maxActivePerOwner &&
      (this.#activeIps.get(principal.ipKey) ?? 0) < this.limits.maxActivePerIp;
  }

  #canQueue(principal: AvatarUploadPrincipal): boolean {
    return this.#waiters.length < this.limits.maxWaiters &&
      (this.#waitingOwners.get(principal.ownerKey) ?? 0) < this.limits.maxWaitersPerOwner &&
      (this.#waitingIps.get(principal.ipKey) ?? 0) < this.limits.maxWaitersPerIp;
  }

  #activate(principal: AvatarUploadPrincipal): void {
    this.#active += 1;
    this.#increment(this.#activeOwners, principal.ownerKey);
    this.#increment(this.#activeIps, principal.ipKey);
  }

  #deactivate(principal: AvatarUploadPrincipal): void {
    this.#active -= 1;
    this.#decrement(this.#activeOwners, principal.ownerKey);
    this.#decrement(this.#activeIps, principal.ipKey);
  }

  #dispatch(): void {
    while (this.#active < this.limits.maxActive) {
      const index = this.#waiters.findIndex((waiter) => this.#canActivate(waiter.principal));
      if (index < 0) return;
      const [next] = this.#waiters.splice(index, 1);
      if (!next) return;
      if (next.signal && next.onAbort) next.signal.removeEventListener("abort", next.onAbort);
      this.#decrement(this.#waitingOwners, next.principal.ownerKey);
      this.#decrement(this.#waitingIps, next.principal.ipKey);
      this.#activate(next.principal);
      next.resolve(this.#lease(next.principal));
    }
  }

  #increment(counts: Map<string, number>, key: string): void {
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  #decrement(counts: Map<string, number>, key: string): void {
    const next = (counts.get(key) ?? 0) - 1;
    if (next > 0) counts.set(key, next);
    else counts.delete(key);
  }
}

export function createAvatarUploadAdmissionMiddleware(
  admission: AvatarUploadAdmission,
  receiveTimeoutMs = 30_000,
): RequestHandler {
  return (request, response, next) => {
    const controller = new AbortController();
    const timeoutState: AvatarUploadTimeoutState = {
      timer: setTimeout(() => undefined, receiveTimeoutMs),
      timedOut: false,
    };
    clearTimeout(timeoutState.timer);
    requestTimeouts.set(request, timeoutState);
    const timeoutRequest = () => {
      if (timeoutState.timedOut) return;
      timeoutState.timedOut = true;
      timedOutAvatarRequests.add(request);
      clearAvatarUploadTimeout(request);
      controller.abort();
      const admissionState = requestAdmissions.get(request);
      if (admissionState) {
        requestAdmissions.delete(request);
        releaseRequestAdmission(admissionState);
      }
      if (!response.headersSent && !response.writableEnded) {
        response.setHeader("Connection", "close");
        response.status(408).json({ error: "REQUEST_TIMEOUT" });
      }
      const destroy = (request as Request & { destroy?: () => void }).destroy;
      destroy?.();
    };
    timeoutState.timer = setTimeout(timeoutRequest, receiveTimeoutMs);
    const abortWaiting = () => {
      if (!timeoutState.timedOut) clearAvatarUploadTimeout(request);
      controller.abort();
    };
    request.once("aborted", abortWaiting);
    response.once("close", abortWaiting);
    const principal = {
      ownerKey: sha256Hex(request.p9Auth?.userId ?? "unauthenticated"),
      ipKey: ipKeyGenerator(request.ip ?? "0.0.0.0"),
    };
    void admission.acquire(principal, controller.signal).then((lease) => {
      request.off("aborted", abortWaiting);
      response.off("close", abortWaiting);
      if (controller.signal.aborted || timeoutState.timedOut) {
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
        clearAvatarUploadTimeout(request);
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
      clearAvatarUploadTimeout(request);
      request.off("aborted", abortWaiting);
      response.off("close", abortWaiting);
      if (error instanceof AvatarUploadAdmissionAborted) return;
      next(error);
    });
  };
}

export const avatarUploadAdmission = new BoundedAvatarUploadAdmission({
  maxActive: 2,
  maxWaiters: 4,
  maxActivePerOwner: 1,
  maxWaitersPerOwner: 2,
  maxActivePerIp: 1,
  maxWaitersPerIp: 2,
});
