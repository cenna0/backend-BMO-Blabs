import { describe, expect, it } from "vitest";

import { parseP9Config } from "../../src/p9/config.js";

const enabled = {
  P9_ENABLED: "true",
  DATABASE_URL: "postgresql://bmo:password@127.0.0.1:5432/bmo",
  P9_JWT_SECRET: "a".repeat(32),
  P9_PAIRING_PEPPER: "b".repeat(32),
};

describe("P9 configuration", () => {
  it("is disabled without database or security secrets", () => {
    expect(parseP9Config({})).toMatchObject({
      enabled: false,
      canonicalTimezone: "Asia/Jakarta",
      accessTokenTtlSeconds: 900,
      refreshTokenTtlSeconds: 2_592_000,
      pairingTtlSeconds: 600,
      prismaPoolSize: 5,
      postgresMaxConnections: 20,
    });
  });

  it("requires strong runtime secrets when enabled", () => {
    expect(() => parseP9Config({ P9_ENABLED: "true" })).toThrow();
    expect(() => parseP9Config({ ...enabled, P9_JWT_SECRET: "short" })).toThrow(
      /P9_JWT_SECRET/,
    );
    expect(() => parseP9Config({ ...enabled, P9_PAIRING_PEPPER: "short" })).toThrow(
      /P9_PAIRING_PEPPER/,
    );
  });

  it("accepts the isolated candidate defaults and explicit safe limits", () => {
    expect(parseP9Config(enabled)).toEqual({
      enabled: true,
      databaseUrl: enabled.DATABASE_URL,
      jwtSecret: enabled.P9_JWT_SECRET,
      pairingPepper: enabled.P9_PAIRING_PEPPER,
      canonicalTimezone: "Asia/Jakarta",
      accessTokenTtlSeconds: 900,
      refreshTokenTtlSeconds: 2_592_000,
      pairingTtlSeconds: 600,
      prismaPoolSize: 5,
      postgresMaxConnections: 20,
      loginWindowMs: 15 * 60 * 1000,
      loginLimit: 5,
      pairingWindowMs: 15 * 60 * 1000,
      pairingLimit: 10,
      publicBaseUrl: "http://127.0.0.1:3000",
      avatarStorageDir: "/opt/bmo/data/avatars",
      avatarMaxBytes: 5 * 1024 * 1024,
      avatarUploadWindowMs: 15 * 60 * 1000,
      avatarUploadUserLimit: 10,
      avatarUploadIpLimit: 20,
      avatarGcIntervalMs: 60 * 60 * 1000,
      avatarGcGraceMs: 24 * 60 * 60 * 1000,
      avatarGcScanLimit: 200,
      avatarGcBatchSize: 25,
      recoveryTokenTtlSeconds: 600,
      recoveryMaxAttempts: 5,
      recoveryWindowMs: 15 * 60 * 1000,
      recoveryIpLimit: 5,
      recoveryEmailLimit: 3,
    });
  });

  it("rejects avatar storage paths that are relative, root, traversal-normalized, or padded", () => {
    for (const avatarStorageDir of ["avatars", "/", "/srv/bmo/../avatars", " /srv/bmo/avatars", "/srv/bmo/avatars "]) {
      expect(() => parseP9Config({ ...enabled, AVATAR_STORAGE_DIR: avatarStorageDir })).toThrow();
    }
    expect(parseP9Config({ ...enabled, AVATAR_STORAGE_DIR: "/srv/bmo/avatars/" }).avatarStorageDir)
      .toBe("/srv/bmo/avatars");
  });

  it("accepts explicit public avatar storage configuration without exposing it as a route", () => {
    expect(parseP9Config({
      ...enabled,
      PUBLIC_BASE_URL: "https://api.example.com/",
      AVATAR_STORAGE_DIR: "/srv/bmo/avatars",
    })).toMatchObject({
      publicBaseUrl: "https://api.example.com",
      avatarStorageDir: "/srv/bmo/avatars",
      avatarMaxBytes: 5 * 1024 * 1024,
    });
  });

  it("accepts only an HTTP(S) origin and normalizes its trailing slash", () => {
    expect(parseP9Config({ ...enabled, PUBLIC_BASE_URL: "https://api.example.com:8443/" }).publicBaseUrl)
      .toBe("https://api.example.com:8443");
    for (const publicBaseUrl of [
      "javascript:alert(1)",
      "https://user:secret@api.example.com",
      "https://api.example.com/v1",
      "https://api.example.com?tenant=one",
      "https://api.example.com/#fragment",
    ]) {
      expect(() => parseP9Config({ ...enabled, PUBLIC_BASE_URL: publicBaseUrl })).toThrow();
    }
  });

  it("does not allow the timezone to be configured", () => {
    expect(() => parseP9Config({ ...enabled, P9_TIMEZONE: "UTC" })).toThrow(
      /Asia\/Jakarta/,
    );
  });
});
