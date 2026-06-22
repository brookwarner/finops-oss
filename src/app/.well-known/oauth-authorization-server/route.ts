import { NextResponse } from "next/server";
import { mcpConfig } from "@/lib/mcp/config";
export function GET() {
  const cfg = mcpConfig();
  return NextResponse.json({
    issuer: cfg.issuer,
    authorization_endpoint: `${cfg.baseUrl}/api/oauth/authorize`,
    token_endpoint: `${cfg.baseUrl}/api/oauth/token`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["client_secret_post", "none"],
  });
}
