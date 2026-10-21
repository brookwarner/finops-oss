import type { ZodRawShape } from "zod";

/** The `extra` object the mcp-handler passes to every tool handler. */
export interface ToolExtra {
  authInfo?: { extra?: { householdId?: string } };
}

/** Resolve the authenticated household id from the request context. */
export function householdId(extra: ToolExtra): string {
  return (extra.authInfo?.extra as { householdId?: string } | undefined)
    ?.householdId as string;
}

/** Standard MCP text-content result. The index signature keeps it assignable
 * to the mcp-handler / SDK `CallToolResult` shape. */
export interface ToolResult {
  content: { type: "text"; text: string }[];
  [key: string]: unknown;
}

/** Serialise an arbitrary value into the standard single-text-block result. */
export function text(value: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}

export type ToolHandler<Args> = (
  args: Args,
  extra: ToolExtra,
) => Promise<ToolResult>;

/** A self-describing MCP tool, registered via the route's loop. */
export interface ToolDef<Shape extends ZodRawShape = ZodRawShape> {
  name: string;
  description: string;
  schema: Shape;
  handler: ToolHandler<Record<string, unknown>>;
}

/**
 * Wrap a handler so any thrown error becomes a structured `{ error }` text
 * block instead of an unstructured MCP transport error. Behaviour-preserving on
 * the success path.
 */
export function wrapTool<Shape extends ZodRawShape>(
  def: ToolDef<Shape>,
): ToolDef<Shape> {
  return {
    ...def,
    handler: async (args, extra) => {
      try {
        return await def.handler(args, extra);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return text({ error: message });
      }
    },
  };
}

/** Helper to declare a tool with inferred-arg typing then erase to the loop's
 * shape. Keeps each tool's handler strongly typed at the definition site. */
export function defineTool<Shape extends ZodRawShape>(
  name: string,
  description: string,
  schema: Shape,
  handler: (args: Record<string, never>, extra: ToolExtra) => Promise<ToolResult>,
): ToolDef<Shape>;
export function defineTool<Shape extends ZodRawShape, Args>(
  name: string,
  description: string,
  schema: Shape,
  handler: (args: Args, extra: ToolExtra) => Promise<ToolResult>,
): ToolDef<Shape>;
export function defineTool<Shape extends ZodRawShape>(
  name: string,
  description: string,
  schema: Shape,
  handler: (args: never, extra: ToolExtra) => Promise<ToolResult>,
): ToolDef<Shape> {
  return {
    name,
    description,
    schema,
    handler: handler as ToolHandler<Record<string, unknown>>,
  };
}
