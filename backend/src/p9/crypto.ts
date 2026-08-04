import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import argon2 from "argon2";

export const ARGON2ID_PARAMETERS = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 3,
  parallelism: 1,
  hashLength: 32,
  saltLength: 16,
} as const;

export function createOpaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

export function createPairingCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

export function sha256Hex(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export function keyedDigest(value: string, pepper: string): string {
  return createHmac("sha256", pepper).update(value, "utf8").digest("hex");
}

export function safeDigestEqual(left: string, right: string): boolean {
  const leftDigest = createHash("sha256").update(left, "utf8").digest();
  const rightDigest = createHash("sha256").update(right, "utf8").digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, ARGON2ID_PARAMETERS);
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}
