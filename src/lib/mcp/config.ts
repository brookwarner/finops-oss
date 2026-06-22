import { env } from "@/lib/env";

export function mcpConfig() {
  const base = env.MCP_PUBLIC_URL ?? "http://localhost:3000";
  return {
    baseUrl: base,
    resource: `${base}/api/mcp`,
    issuer: base,
    clientId: env.MCP_OAUTH_CLIENT_ID ?? "finops-claude",
    clientSecret: env.MCP_OAUTH_CLIENT_SECRET ?? "",
    jwtSecret: () => new TextEncoder().encode(env.MCP_JWT_SECRET ?? ""),
  };
}
