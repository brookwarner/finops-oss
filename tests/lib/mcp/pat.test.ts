import { describe, it, expect } from "vitest";
import { generateToken, hashToken } from "@/lib/mcp/pat";

it("generates a prefixed token and a stable hash", () => {
  const { raw, prefix } = generateToken();
  expect(raw.startsWith("fops_")).toBe(true);
  expect(prefix.startsWith("fops_")).toBe(true);
  expect(hashToken(raw)).toBe(hashToken(raw));
  expect(hashToken(raw)).toHaveLength(64); // sha256 hex
});
