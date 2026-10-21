import { randomUUID } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { mcpConfig } from "./config";

export interface AccessClaims { householdId: string; userId: string; }

// Default lifetime of a refresh token. Each rotation re-issues a fresh 30-day
// token, so an actively-used client never gets logged out (sliding expiry).
export const REFRESH_TTL_SECONDS = 60 * 60 * 24 * 30;

export async function signAccessToken(a: { householdId: string; userId: string; ttlSeconds: number }): Promise<string> {
  const cfg = mcpConfig();
  return new SignJWT({ household_id: a.householdId })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(a.userId)
    .setAudience(cfg.resource)
    .setIssuer(cfg.issuer)
    .setIssuedAt()
    .setExpirationTime(`${a.ttlSeconds}s`)
    .sign(cfg.jwtSecret());
}

export async function verifyAccessToken(token: string): Promise<AccessClaims> {
  const cfg = mcpConfig();
  const { payload } = await jwtVerify(token, cfg.jwtSecret(), { audience: cfg.resource, issuer: cfg.issuer });
  if (!payload.sub || !payload.household_id) throw new Error("missing claims");
  return { householdId: String(payload.household_id), userId: String(payload.sub) };
}

export interface RefreshClaims { householdId: string; userId: string; jti: string; }

// Refresh tokens carry a `kind: "refresh"` marker and no audience, so they can
// never be replayed as an access token at the MCP resource (verifyAccessToken
// requires audience = resource and would reject them).
export async function signRefreshToken(
  a: { householdId: string; userId: string; jti?: string; ttlSeconds?: number },
): Promise<{ token: string; jti: string; expiresAt: Date }> {
  const cfg = mcpConfig();
  const jti = a.jti ?? randomUUID();
  const ttl = a.ttlSeconds ?? REFRESH_TTL_SECONDS;
  const expiresAt = new Date(Date.now() + ttl * 1000);
  const token = await new SignJWT({ household_id: a.householdId, kind: "refresh" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(a.userId)
    .setIssuer(cfg.issuer)
    .setJti(jti)
    .setIssuedAt()
    .setExpirationTime(`${ttl}s`)
    .sign(cfg.jwtSecret());
  return { token, jti, expiresAt };
}

export async function verifyRefreshToken(token: string): Promise<RefreshClaims> {
  const cfg = mcpConfig();
  const { payload } = await jwtVerify(token, cfg.jwtSecret(), { issuer: cfg.issuer });
  if (payload.kind !== "refresh") throw new Error("not a refresh token");
  if (!payload.sub || !payload.household_id || !payload.jti) throw new Error("missing claims");
  return { householdId: String(payload.household_id), userId: String(payload.sub), jti: String(payload.jti) };
}
