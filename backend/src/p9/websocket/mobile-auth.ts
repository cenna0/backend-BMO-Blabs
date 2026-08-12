import type { MobileSocketIdentity } from "./mobile-websocket.server.js";
import { errors } from "jose";

interface VerifiedAccessToken {
  sub: string;
  sid: string;
  exp?: number;
}

interface AccessTokenVerifier {
  verify(accessToken: string): Promise<VerifiedAccessToken>;
}

interface ActiveSessionChecker {
  isActive(userId: string, sessionId: string): Promise<boolean>;
}

export async function authenticateMobileAccessToken(
  accessTokens: AccessTokenVerifier,
  sessions: ActiveSessionChecker,
  accessToken: string,
): Promise<MobileSocketIdentity | { kind: "expired" } | null> {
  try {
    const payload = await accessTokens.verify(accessToken);
    if (typeof payload.exp !== "number" || !Number.isSafeInteger(payload.exp)) return null;
    if (!await sessions.isActive(payload.sub, payload.sid)) return null;
    return {
      userId: payload.sub,
      sessionId: payload.sid,
      expiresAt: new Date(payload.exp * 1_000),
    };
  } catch (error) {
    if (error instanceof errors.JWTExpired) return { kind: "expired" };
    return null;
  }
}
