import { describe, it, expect, beforeAll } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import { verifyPkceS256, signAuthCode, verifyAuthCode } from "@/lib/mcp/pkce";

beforeAll(() => { process.env.MCP_JWT_SECRET = "test-secret-at-least-32-bytes-long-xxxxx"; });

function challengeFor(verifier: string) { return createHash("sha256").update(verifier).digest("base64url"); }

it("verifies a correct S256 challenge", () => {
  const verifier = randomBytes(32).toString("base64url");
  expect(verifyPkceS256(verifier, challengeFor(verifier))).toBe(true);
  expect(verifyPkceS256(verifier, challengeFor("other"))).toBe(false);
});
it("round-trips a short-lived auth code", async () => {
  const code = await signAuthCode({ userId: "u1", householdId: "h1", codeChallenge: "abc", redirectUri: "https://claude.ai/api/mcp/auth_callback" });
  const payload = await verifyAuthCode(code);
  expect(payload.userId).toBe("u1");
  expect(payload.redirectUri).toContain("claude.ai");
  expect(typeof payload.jti).toBe("string");
  expect(payload.jti.length).toBeGreaterThan(0);
});
