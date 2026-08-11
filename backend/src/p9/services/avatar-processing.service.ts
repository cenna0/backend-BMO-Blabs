import { P9Error } from "../errors.js";

export interface AvatarProcessingQueue {
  run<T>(work: () => Promise<T>): Promise<T>;
}

export class BoundedAvatarProcessingQueue implements AvatarProcessingQueue {
  #active = 0;
  readonly #waiters: Array<() => void> = [];

  constructor(
    private readonly concurrency: number,
    private readonly maxWaiters: number,
  ) {
    if (!Number.isInteger(concurrency) || concurrency < 1 || !Number.isInteger(maxWaiters) || maxWaiters < 0) {
      throw new Error("invalid avatar processing queue bounds");
    }
  }

  async run<T>(work: () => Promise<T>): Promise<T> {
    await this.#acquire();
    try {
      return await work();
    } finally {
      this.#release();
    }
  }

  async #acquire(): Promise<void> {
    if (this.#active < this.concurrency) {
      this.#active += 1;
      return;
    }
    if (this.#waiters.length >= this.maxWaiters) {
      throw new P9Error(
        "SERVICE_UNAVAILABLE",
        503,
        "Avatar processing temporarily unavailable",
      );
    }
    await new Promise<void>((resolve) => { this.#waiters.push(resolve); });
  }

  #release(): void {
    const next = this.#waiters.shift();
    if (next) next();
    else this.#active -= 1;
  }
}

export const avatarProcessingQueue = new BoundedAvatarProcessingQueue(2, 4);
