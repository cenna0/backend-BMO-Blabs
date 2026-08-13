import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export interface EncryptedProviderToken {
  ciphertext: string;
  nonce: string;
  tag: string;
  keyVersion: number;
}

const ALGORITHM = "aes-256-gcm";
const KEY_VERSION = 1;

function assertKey(key: Buffer): void {
  if (key.byteLength !== 32) throw new Error("provider encryption key must be exactly 32 bytes");
}

export function encryptProviderToken(value: string, key: Buffer): EncryptedProviderToken {
  assertKey(key);
  const nonce = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, nonce);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64url"),
    nonce: nonce.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
    keyVersion: KEY_VERSION,
  };
}

export function decryptProviderToken(value: EncryptedProviderToken, key: Buffer): string {
  assertKey(key);
  if (value.keyVersion !== KEY_VERSION) throw new Error("unsupported provider encryption key version");
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(value.nonce, "base64url"));
  decipher.setAuthTag(Buffer.from(value.tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(value.ciphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export const PROVIDER_ENCRYPTION_KEY_VERSION = KEY_VERSION;
