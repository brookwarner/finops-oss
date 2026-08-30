import type { SupabaseClient } from "@supabase/supabase-js";
import type { SubRow } from "./present";
import { scopedDb } from "@/lib/supabase/scoped";

/** Columns selected for subscription presentation. Single source of truth so
 * the REST `/api/subscriptions` route and the MCP `get_subscriptions` tool
 * issue the identical query. */
export const SUBSCRIPTION_SELECT =
  "display_name, cadence, amount, amount_min, amount_max, next_expected, last_seen, status, category_id";

/**
 * Fetch a household's detected subscriptions. Returns the raw `SubRow[]` ready
 * to pass to `presentSubscriptions`. Throws on a query error so callers decide
 * how to surface it (REST → 500, MCP → wrapped error).
 */
export async function fetchSubscriptions(
  supabase: SupabaseClient,
  householdId: string,
): Promise<SubRow[]> {
  const { data, error } = await scopedDb(supabase, householdId)
    .subscriptions.select(SUBSCRIPTION_SELECT);
  if (error) throw new Error(error.message);
  return (data ?? []) as SubRow[];
}
