import { createMcpHandler, withMcpAuth } from "mcp-handler";
import type { AuthInfo } from "@modelcontextprotocol/server";
import { z } from "zod";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { resolveCredential } from "@/lib/mcp/auth";
import { mcpConfig } from "@/lib/mcp/config";
import { allTools, wrapTool } from "@/lib/mcp/tools";
import { registerBudgetEvents } from "@/lib/mcp/events";

const handler = createMcpHandler((server) => {
  for (const tool of allTools) {
    const wrapped = wrapTool(tool);
    server.registerTool(wrapped.name, {
      description: wrapped.description,
      inputSchema: z.object(wrapped.schema),
    }, (args, ctx) => wrapped.handler(args, { authInfo: ctx.http?.authInfo }));
  }
  registerBudgetEvents(server);
}, { serverInfo: { name: "finops", version: "0.43.1" } });

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
