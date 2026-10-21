import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { mcpConfig } from "./config";

export function verifyPkceS256(verifier: string, challenge: string): boolean {
  const computed = createHash("sha256").update(verifier).digest("base64url");
  const a = Buffer.from(computed), b = Buffer.from(challenge);
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface AuthCodePayload { userId: string; householdId: string; codeChallenge: string; redirectUri: string; jti: string; }

export async function signAuthCode(p: Omit<AuthCodePayload, "jti"> & { jti?: string }): Promise<string> {
  const jti = p.jti ?? randomUUID();
  return new SignJWT({ ...p, jti, kind: "authcode" })
    .setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("60s")
    .sign(mcpConfig().jwtSecret());
}
export async function verifyAuthCode(code: string): Promise<AuthCodePayload> {
  const { payload } = await jwtVerify(code, mcpConfig().jwtSecret());
  if (payload.kind !== "authcode") throw new Error("not an auth code");
  return { userId: String(payload.userId), householdId: String(payload.householdId),
    codeChallenge: String(payload.codeChallenge), redirectUri: String(payload.redirectUri),
    jti: String(payload.jti) };
}
