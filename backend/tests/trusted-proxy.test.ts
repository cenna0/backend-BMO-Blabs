import express from "express";
import request from "supertest";
import { rateLimit } from "express-rate-limit";
import { describe, expect, it } from "vitest";

import {
  configureTrustedProxy,
  isTrustedLoopbackProxy,
  normalizeClientIp,
  rateLimitClientIp,
} from "../src/http/trusted-proxy.js";

function appReportingIp(remoteAddress?: string) {
  const app = express();
  configureTrustedProxy(app);
  if (remoteAddress !== undefined) {
    app.use((request, _response, next) => {
      Object.defineProperty(request, "socket", {
        configurable: true,
        value: { remoteAddress },
      });
      next();
    });
  }
  app.get("/", (request, response) => response.json({ ip: request.ip, ips: request.ips }));
  return app;
}

describe("trusted proxy and client-IP normalization", () => {
  it("trusts only the three loopback proxy addresses", () => {
    expect(isTrustedLoopbackProxy("127.0.0.1")).toBe(true);
    expect(isTrustedLoopbackProxy("::1")).toBe(true);
    expect(isTrustedLoopbackProxy("::ffff:127.0.0.1")).toBe(true);
    expect(isTrustedLoopbackProxy("127.0.0.2")).toBe(false);
    expect(isTrustedLoopbackProxy("::ffff:192.0.2.10")).toBe(false);
  });

  it("configures an explicit trust function and never trust-proxy=true", () => {
    const app = express();
    configureTrustedProxy(app);
    const trust = app.get("trust proxy") as (ip: string) => boolean;
    expect(typeof trust).toBe("function");
    expect(trust("127.0.0.1")).toBe(true);
    expect(trust("::1")).toBe(true);
    expect(trust("::ffff:127.0.0.1")).toBe(true);
    expect(trust("198.51.100.10")).toBe(false);
  });

  it("resolves the forwarded public client through a trusted loopback proxy", async () => {
    await request(appReportingIp())
      .get("/")
      .set("X-Forwarded-For", "198.51.100.10")
      .expect(200)
      .expect(({ body }) => {
        expect(body.ip).toBe("198.51.100.10");
        expect(body.ips).toContain("198.51.100.10");
      });
  });

  it("ignores spoofed forwarding headers from an untrusted remote address", async () => {
    await request(appReportingIp("198.51.100.20"))
      .get("/")
      .set("X-Forwarded-For", "203.0.113.10")
      .set("X-Real-IP", "203.0.113.11")
      .set("Forwarded", "for=203.0.113.12")
      .expect(200)
      .expect(({ body }) => {
        expect(body.ip).toBe("198.51.100.20");
        expect(body.ips).toEqual([]);
      });
  });

  it("normalizes IPv4, IPv6, and IPv4-mapped client identities", () => {
    expect(normalizeClientIp("192.0.2.10")).toBe("192.0.2.10");
    expect(normalizeClientIp("::ffff:192.0.2.10")).toBe("192.0.2.10");
    expect(normalizeClientIp("2001:DB8::1234")).toMatch(/^2001:db8:/);
    expect(normalizeClientIp("2001:db8::1234")).toMatch(/\/56$/);
  });

  it("uses normalized req.ip values for rate-limit keys", async () => {
    const keys: string[] = [];
    const app = express();
    configureTrustedProxy(app);
    app.use(rateLimit({
      windowMs: 60_000,
      limit: 1,
      standardHeaders: false,
      legacyHeaders: false,
      keyGenerator: (request) => {
        const key = rateLimitClientIp(request);
        keys.push(key);
        return key;
      },
      handler: (_request, response) => response.status(429).json({ error: "RATE_LIMITED" }),
    }));
    app.get("/", (_request, response) => response.status(200).send("ok"));

    await request(app).get("/").set("X-Forwarded-For", "::ffff:192.0.2.44").expect(200);
    await request(app).get("/").set("X-Forwarded-For", "192.0.2.44").expect(429);
    expect(keys).toEqual(["192.0.2.44", "192.0.2.44"]);
  });
});
