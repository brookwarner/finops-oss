const EXACT = new Set(["https://claude.ai/api/mcp/auth_callback", "https://claude.com/api/mcp/auth_callback"]);
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1"]);

export function isAllowedRedirectUri(uri: string): boolean {
  if (EXACT.has(uri)) return true;
  let u: URL;
  try { u = new URL(uri); } catch { return false; }
  return u.protocol === "http:" && LOOPBACK_HOSTS.has(u.hostname) && u.pathname === "/callback";
}
