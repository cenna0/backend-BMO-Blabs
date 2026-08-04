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
    });
  });

  it("does not allow the timezone to be configured", () => {
    expect(() => parseP9Config({ ...enabled, P9_TIMEZONE: "UTC" })).toThrow(
      /Asia\/Jakarta/,
    );
  });
});
