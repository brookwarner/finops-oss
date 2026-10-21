import { z } from "zod";
import { ProtocolError, type McpServer } from "@modelcontextprotocol/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { scopedDb, type Db } from "@/lib/supabase/scoped";
import { EVENT_NAME, eventArguments } from "./event-contract";
import { subscribe, subscribeParams, unsubscribe, unsubscribeParams, type Principal } from "./webhook-subscriptions";

export { EVENT_NAME } from "./event-contract";
const MAX_AGE_MS = 7 * 86_400_000;
export const pollParams = z.object({
  name: z.literal(EVENT_NAME),
  arguments: eventArguments.default({}),
  cursor: z.string().max(2048).nullable().default(null),
  maxAgeMs: z.number().int().min(1).max(MAX_AGE_MS).default(MAX_AGE_MS),
  maxEvents: z.number().int().min(1).max(100).default(50),
});
const cursorSchema = z.object({
  v: z.literal(1), household: z.uuid(), category: z.uuid().nullable(),
  sequence: z.number().int().nonnegative(), time: z.number().int().nonnegative(),
});
type Cursor = z.infer<typeof cursorSchema>;

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}
export function decodeCursor(raw: string, household: string, category: string | null): Cursor {
  try {
    const cursor = cursorSchema.parse(JSON.parse(Buffer.from(raw, "base64url").toString()));
    if (cursor.household !== household || cursor.category !== category) throw new Error();
    return cursor;
  } catch {
    throw new ProtocolError(-32602, "Invalid event cursor for this household or filter");
  }
}

export async function pollBudgetEvents(
  db: Db, household: string, input: z.input<typeof pollParams>, now = Date.now(),
) {
  if (!household) throw new ProtocolError(-32024, "Authenticated household required");
  const params = pollParams.parse(input);
  const category = params.arguments.categoryId ?? null;
  const prior = params.cursor === null ? null : decodeCursor(params.cursor, household, category);
  const table = scopedDb(db, household).mcp_events;
  const { data: heads, error: headError } = await table.select("sequence")
    .order("sequence", { ascending: false }).limit(1);
  if (headError) throw new Error("Event feed unavailable");
  const head = heads?.[0]?.sequence ?? 0;
  if (prior && (prior.sequence > head || prior.time > now)) {
    throw new ProtocolError(-32602, "Event cursor is ahead of this feed");
  }
  const cursorAt = (sequence: number) => encodeCursor({
    v: 1, household, category, sequence, time: now,
  });
  // Null starts from now without replaying existing events.
  if (!prior) return { events: [], cursor: cursorAt(head), truncated: false, hasMore: false, nextPollMs: 60_000 };

  let query = table.select("sequence, event_id, name, occurred_at, data")
    .gt("sequence", prior.sequence).lte("sequence", head)
    .gte("occurred_at", new Date(now - params.maxAgeMs).toISOString())
    .order("sequence", { ascending: true }).limit(params.maxEvents + 1);
  if (category) query = query.eq("category_id", category);
  const { data, error } = await query;
  if (error) throw new Error("Event feed unavailable");
  const rows = (data ?? []) as { sequence: number; event_id: string; name: string; occurred_at: string; data: unknown }[];
  const hasMore = rows.length > params.maxEvents;
  const page = rows.slice(0, params.maxEvents);
  return {
    events: page.map(row => ({ eventId: row.event_id, name: row.name, timestamp: row.occurred_at, data: row.data })),
    cursor: cursorAt(hasMore ? page[page.length - 1].sequence : head),
    truncated: prior.time < now - params.maxAgeMs,
    hasMore, nextPollMs: 60_000,
  };
}

export function registerBudgetEvents(server: McpServer) {
  // The draft Events field is intentionally outside the stable SDK schema.
  server.server.registerCapabilities({ events: {} } as Parameters<typeof server.server.registerCapabilities>[0]);
  server.server.setRequestHandler("events/list", {
    params: z.object({ cursor: z.string().optional() }),
  }, async (params, ctx) => {
    if (!ctx.http?.authInfo?.extra?.householdId) throw new ProtocolError(-32024, "Authenticated household required");
    if (params.cursor !== undefined) throw new ProtocolError(-32602, "Catalog has no further pages");
    return { events: [{
      name: EVENT_NAME,
      description: "A budget moves into warning or over-budget state during the daily alert evaluation. Supports webhook subscriptions for Dots and polling.",
      delivery: ["webhook", "poll"],
      inputSchema: z.toJSONSchema(eventArguments),
      payloadSchema: z.toJSONSchema(z.object({
        categoryId: z.uuid().nullable(), periodStart: z.string().nullable(),
        state: z.enum(["warning", "over"]), target: z.number(), netSpent: z.number(), pct: z.number(),
      })),
    }] };
  });
  server.server.setRequestHandler("events/poll", { params: pollParams }, async (params, ctx) => {
    const household = ctx.http?.authInfo?.extra?.householdId;
    if (typeof household !== "string" || !household) throw new ProtocolError(-32024, "Authenticated household required");
    return pollBudgetEvents(createSupabaseServiceClient(), household, params);
  });
  const principal = (info: { extra?: Record<string, unknown>; token?: string } | undefined): Principal => {
    if (typeof info?.extra?.householdId !== "string" || typeof info.extra.userId !== "string") {
      throw new ProtocolError(-32024, "Authenticated household and user required");
    }
    return { householdId: info.extra.householdId, userId: info.extra.userId, token: info.token };
  };
  server.server.setRequestHandler("events/subscribe", { params: subscribeParams }, async (params, ctx) =>
    subscribe(createSupabaseServiceClient(), principal(ctx.http?.authInfo), params));
  server.server.setRequestHandler("events/unsubscribe", { params: unsubscribeParams }, async (params, ctx) =>
    unsubscribe(createSupabaseServiceClient(), principal(ctx.http?.authInfo), params));
}
