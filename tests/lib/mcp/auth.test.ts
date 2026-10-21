import { describe, it, expect, beforeAll } from "vitest";
import { resolveCredential } from "@/lib/mcp/auth";
import { signAccessToken } from "@/lib/mcp/jwt";

beforeAll(() => { process.env.MCP_JWT_SECRET = "test-secret-at-least-32-bytes-long-xxxxx"; });

const noPatSupabase = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) } as any;

it("resolves a valid JWT", async () => {
  const jwt = await signAccessToken({ householdId: "h1", userId: "u1", ttlSeconds: 900 });
  const id = await resolveCredential(`Bearer ${jwt}`, noPatSupabase);
  expect(id?.householdId).toBe("h1");
});
it("returns null for a missing/garbage header", async () => {
  expect(await resolveCredential(undefined, noPatSupabase)).toBeNull();
  expect(await resolveCredential("Bearer not-a-token", noPatSupabase)).toBeNull();
});
