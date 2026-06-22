import { NextResponse } from "next/server";
import { mcpConfig } from "@/lib/mcp/config";
export function GET() {
  const cfg = mcpConfig();
  return NextResponse.json({
    resource: cfg.resource,
    authorization_servers: [cfg.issuer],
    bearer_methods_supported: ["header"],
  });
}
