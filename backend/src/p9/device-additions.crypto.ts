import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export interface EncryptedWifiPassword {
  ciphertext: string;
  nonce: string;
  tag: string;
  keyVersion: number;
}

const ALGORITHM = "aes-256-gcm";
const NONCE_BYTES = 12;
export const WIFI_ENCRYPTION_KEY_VERSION = 1;

export function decodeWifiEncryptionKey(value: string): Buffer {
  const decoded = Buffer.from(value, "base64url");
  if (decoded.byteLength === 32 && decoded.toString("base64url") === value.replace(/=+$/u, "")) return decoded;
  const raw = Buffer.from(value, "utf8");
  if (raw.byteLength === 32) return raw;
  throw new Error("P9_WIFI_ENCRYPTION_KEY must decode to exactly 32 bytes");
}

function validateKey(key: Buffer): void {
  if (key.byteLength !== 32) throw new Error("Wi-Fi encryption key must be exactly 32 bytes");
}

export function encryptWifiPassword(password: string, key: Buffer): EncryptedWifiPassword {
  validateKey(key);
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, nonce);
  const ciphertext = Buffer.concat([cipher.update(password, "utf8"), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64url"),
    nonce: nonce.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
    keyVersion: WIFI_ENCRYPTION_KEY_VERSION,
  };
}

export function decryptWifiPassword(encrypted: EncryptedWifiPassword, key: Buffer): string {
  validateKey(key);
  if (encrypted.keyVersion !== WIFI_ENCRYPTION_KEY_VERSION) throw new Error("unsupported Wi-Fi encryption key version");
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(encrypted.nonce, "base64url"));
  decipher.setAuthTag(Buffer.from(encrypted.tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted.ciphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
