import { describe, expect, it } from "vitest";

import {
  ARGON2ID_PARAMETERS,
  createOpaqueToken,
  createPairingCode,
  hashPassword,
  keyedDigest,
  safeDigestEqual,
  sha256Hex,
  verifyPassword,
} from "../../src/p9/crypto.js";

describe("P9 cryptographic primitives", () => {
  it("creates unique high-entropy opaque tokens", () => {
    const first = createOpaqueToken();
    const second = createOpaqueToken();
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(second).not.toBe(first);
  });

  it("creates exactly six numeric pairing digits", () => {
    expect(createPairingCode()).toMatch(/^\d{6}$/);
  });

  it("hashes deterministic digests without storing raw values", () => {
    expect(sha256Hex("refresh-token")).toBe(
      "0eb17643d4e9261163783a420859c92c7d212fa9624106a12b510afbec266120",
    );
    expect(keyedDigest("123456", "pepper")).not.toContain("123456");
    expect(safeDigestEqual("abc", "abc")).toBe(true);
    expect(safeDigestEqual("abc", "abd")).toBe(false);
    expect(safeDigestEqual("abc", "ab")).toBe(false);
  });

  it("uses explicit Argon2id parameters and verifies passwords", async () => {
    expect(ARGON2ID_PARAMETERS).toEqual({
      type: 2,
      memoryCost: 19_456,
      timeCost: 3,
      parallelism: 1,
      hashLength: 32,
      saltLength: 16,
    });
    const hash = await hashPassword("correct horse battery staple");
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(hash).not.toContain("correct horse");
    await expect(verifyPassword(hash, "correct horse battery staple")).resolves.toBe(true);
    await expect(verifyPassword(hash, "wrong password")).resolves.toBe(false);
  });
});
