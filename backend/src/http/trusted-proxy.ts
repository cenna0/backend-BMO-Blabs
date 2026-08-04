import { ipKeyGenerator } from "express-rate-limit";
import type { Express, Request } from "express";

const IPV6_SUBNET = 56;

/** The only addresses allowed to contribute forwarded client addresses. */
export function isTrustedLoopbackProxy(ip: string): boolean {
  const normalized = ip.trim().toLowerCase();
  return normalized === "127.0.0.1" || normalized === "::1" || normalized === "::ffff:127.0.0.1";
}

/** Install the exact one-hop Caddy trust boundary; never use trust-proxy=true. */
export function configureTrustedProxy(app: Express): void {
  app.set("trust proxy", isTrustedLoopbackProxy);
}

/** Normalize the Express-derived client IP for rate-limit identity keys. */
export function normalizeClientIp(ip: string | undefined): string {
  const candidate = (ip ?? "").trim().toLowerCase();
  return ipKeyGenerator(candidate || "0.0.0.0", IPV6_SUBNET);
}

/** Rate limits consume req.ip after Express has applied the trust function. */
export function rateLimitClientIp(request: Pick<Request, "ip">): string {
  return ipKeyGenerator(normalizeClientIp(request.ip), IPV6_SUBNET);
}
