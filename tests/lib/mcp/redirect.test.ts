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
it("allows the exact ChatGPT callback without admitting lookalikes or extra URL components", () => {
  expect(isAllowedRedirectUri("https://chatgpt.com/connector_platform_oauth_redirect")).toBe(true);
  for (const uri of [
    "http://chatgpt.com/connector_platform_oauth_redirect",
    "https://chatgpt.com.evil.example/connector_platform_oauth_redirect",
    "https://chatgpt.com/connector_platform_oauth_redirect/",
    "https://chatgpt.com/connector_platform_oauth_redirect?next=https://evil.example",
    "https://chatgpt.com/connector_platform_oauth_redirect#fragment",
  ]) expect(isAllowedRedirectUri(uri)).toBe(false);
});
