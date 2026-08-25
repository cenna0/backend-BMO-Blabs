import { createRemoteJWKSet, jwtVerify, type JWTVerifyOptions } from "jose";
import { P9Error } from "../errors.js";

export interface GoogleUserIdentity {
  sub: string;
  email: string;
  emailVerified: boolean;
  displayName?: string | null;
  avatarUrl?: string | null;
}

export interface GoogleAuthClientOptions {
  googleJwksUrl?: string;
  googleUserinfoUrl?: string;
  googleTokeninfoUrl?: string;
  allowedClientIds?: string[];
}

export interface GoogleVerifyInput {
  idToken?: string | null;
  accessToken?: string | null;
}

export class GoogleAuthClient {
  private readonly jwks: ReturnType<typeof createRemoteJWKSet>;
  private readonly userinfoUrl: string;
  private readonly tokeninfoUrl: string;
  private readonly allowedClientIds?: string[];

  constructor(options: GoogleAuthClientOptions = {}) {
    const jwksUrl = options.googleJwksUrl ?? "https://www.googleapis.com/oauth2/v3/certs";
    this.jwks = createRemoteJWKSet(new URL(jwksUrl));
    this.userinfoUrl = options.googleUserinfoUrl ?? "https://www.googleapis.com/oauth2/v3/userinfo";
    this.tokeninfoUrl = options.googleTokeninfoUrl ?? "https://oauth2.googleapis.com/tokeninfo";
    if (options.allowedClientIds) {
      this.allowedClientIds = options.allowedClientIds;
    }
  }

  async verifyToken(tokens: GoogleVerifyInput): Promise<GoogleUserIdentity> {
    if (tokens.idToken) {
      try {
        const verifyOptions: JWTVerifyOptions = {
          issuer: ["https://accounts.google.com", "accounts.google.com"],
        };
        if (this.allowedClientIds && this.allowedClientIds.length > 0) {
          verifyOptions.audience = this.allowedClientIds;
        }
        const verified = await jwtVerify(tokens.idToken, this.jwks, verifyOptions);
        const payload = verified.payload;
        if (typeof payload.sub !== "string" || typeof payload.email !== "string") {
          throw new P9Error("AUTHENTICATION_FAILED", 401, "Google token missing required claims");
        }
        const emailVerified = payload.email_verified === true || payload.email_verified === "true";
        if (!emailVerified) {
          throw new P9Error("AUTHENTICATION_FAILED", 401, "Google email not verified");
        }
        return {
          sub: payload.sub,
          email: payload.email,
          emailVerified: true,
          displayName: typeof payload.name === "string" ? payload.name.trim() : null,
          avatarUrl: typeof payload.picture === "string" ? payload.picture.trim() : null,
        };
      } catch (error) {
        if (error instanceof P9Error) throw error;
        try {
          const res = await fetch(`${this.tokeninfoUrl}?id_token=${encodeURIComponent(tokens.idToken)}`);
          if (res.ok) {
            const data = (await res.json()) as Record<string, unknown>;
            if (typeof data.sub === "string" && typeof data.email === "string") {
              const emailVerified = data.email_verified === true || data.email_verified === "true";
              if (emailVerified) {
                return {
                  sub: data.sub,
                  email: data.email,
                  emailVerified: true,
                  displayName: typeof data.name === "string" ? data.name.trim() : null,
                  avatarUrl: typeof data.picture === "string" ? data.picture.trim() : null,
                };
              }
            }
          }
        } catch {
          // ignore fallback error
        }
        throw new P9Error("AUTHENTICATION_FAILED", 401, "Invalid Google ID token");
      }
    }

    if (tokens.accessToken) {
      try {
        const res = await fetch(this.userinfoUrl, {
          headers: { Authorization: `Bearer ${tokens.accessToken}` },
        });
        if (!res.ok) {
          throw new P9Error("AUTHENTICATION_FAILED", 401, "Invalid Google access token");
        }
        const data = (await res.json()) as Record<string, unknown>;
        if (typeof data.sub !== "string" || typeof data.email !== "string") {
          throw new P9Error("AUTHENTICATION_FAILED", 401, "Google userinfo missing required claims");
        }
        const emailVerified = data.email_verified === true || data.email_verified === "true";
        if (!emailVerified) {
          throw new P9Error("AUTHENTICATION_FAILED", 401, "Google email not verified");
        }
        return {
          sub: data.sub,
          email: data.email,
          emailVerified: true,
          displayName: typeof data.name === "string" ? data.name.trim() : null,
          avatarUrl: typeof data.picture === "string" ? data.picture.trim() : null,
        };
      } catch (error) {
        if (error instanceof P9Error) throw error;
        throw new P9Error("AUTHENTICATION_FAILED", 401, "Invalid Google access token");
      }
    }

    throw new P9Error("INVALID_INPUT", 400, "Either idToken or accessToken is required");
  }
}
