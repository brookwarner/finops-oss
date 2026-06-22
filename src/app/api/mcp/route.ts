import { createMcpHandler, withMcpAuth } from "mcp-handler";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { resolveCredential } from "@/lib/mcp/auth";
import { mcpConfig } from "@/lib/mcp/config";
import { allTools, wrapTool } from "@/lib/mcp/tools";

const handler = createMcpHandler((server) => {
  for (const tool of allTools) {
    const wrapped = wrapTool(tool);
    server.tool(wrapped.name, wrapped.description, wrapped.schema, wrapped.handler);
  }
}, {}, { basePath: "/api" });

const verifyToken = async (
  _req: Request,
  bearer?: string,
): Promise<AuthInfo | undefined> => {
  const supabase = createSupabaseServiceClient();
  const identity = await resolveCredential(
    bearer ? `Bearer ${bearer}` : undefined,
    supabase,
  );
  if (!identity) return undefined; // => 401
  return {
    token: bearer as string,
    clientId: mcpConfig().clientId,
    scopes: [],
    extra: { ...identity },
  };
};

const authed = withMcpAuth(handler, verifyToken, {
  required: true,
  resourceMetadataPath: "/.well-known/oauth-protected-resource",
});

export { authed as GET, authed as POST };
