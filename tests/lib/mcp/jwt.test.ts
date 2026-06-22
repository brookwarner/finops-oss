import { describe, it, expect, beforeAll } from "vitest";
import { signAccessToken, verifyAccessToken, signRefreshToken, verifyRefreshToken } from "@/lib/mcp/jwt";

beforeAll(() => { process.env.MCP_JWT_SECRET = "test-secret-at-least-32-bytes-long-xxxxx"; });

it("round-trips household + user claims", async () => {
  const jwt = await signAccessToken({ householdId: "h1", userId: "u1", ttlSeconds: 900 });
  const claims = await verifyAccessToken(jwt);
  expect(claims.householdId).toBe("h1");
  expect(claims.userId).toBe("u1");
});
it("rejects a token signed with a different secret", async () => {
  const jwt = await signAccessToken({ householdId: "h1", userId: "u1", ttlSeconds: 900 });
  process.env.MCP_JWT_SECRET = "a-completely-different-secret-32-bytes-xx";
  await expect(verifyAccessToken(jwt)).rejects.toThrow();
  process.env.MCP_JWT_SECRET = "test-secret-at-least-32-bytes-long-xxxxx";
});

it("round-trips a refresh token with a stable jti", async () => {
  const { token, jti, expiresAt } = await signRefreshToken({ householdId: "h1", userId: "u1" });
  const claims = await verifyRefreshToken(token);
  expect(claims.householdId).toBe("h1");
  expect(claims.userId).toBe("u1");
  expect(claims.jti).toBe(jti);
  expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
});
it("will not accept a refresh token as an access token (no audience)", async () => {
  const { token } = await signRefreshToken({ householdId: "h1", userId: "u1" });
  await expect(verifyAccessToken(token)).rejects.toThrow();
});
it("will not accept an access token as a refresh token (kind guard)", async () => {
  const access = await signAccessToken({ householdId: "h1", userId: "u1", ttlSeconds: 900 });
  await expect(verifyRefreshToken(access)).rejects.toThrow();
});
it("rejects an expired refresh token", async () => {
  const { token } = await signRefreshToken({ householdId: "h1", userId: "u1", ttlSeconds: -1 });
  await expect(verifyRefreshToken(token)).rejects.toThrow();
});
