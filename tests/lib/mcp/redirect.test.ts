import { describe, it, expect } from "vitest";
import { isAllowedRedirectUri } from "@/lib/mcp/redirect";

it("allows the claude.ai callback exactly", () => {
  expect(isAllowedRedirectUri("https://claude.ai/api/mcp/auth_callback")).toBe(true);
  expect(isAllowedRedirectUri("https://evil.com/api/mcp/auth_callback")).toBe(false);
});
it("allows loopback callbacks on any port", () => {
  expect(isAllowedRedirectUri("http://localhost:54321/callback")).toBe(true);
  expect(isAllowedRedirectUri("http://127.0.0.1:8080/callback")).toBe(true);
  expect(isAllowedRedirectUri("http://localhost:54321/evil")).toBe(false);
  expect(isAllowedRedirectUri("http://192.168.1.5:8080/callback")).toBe(false);
});
