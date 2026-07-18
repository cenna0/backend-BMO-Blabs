import { createHash, timingSafeEqual } from "node:crypto";

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

export function deviceTokenMatches(received: string, expected: string): boolean {
  return timingSafeEqual(digest(received), digest(expected));
}
