import { cachedHouseholdRead } from "@/lib/cache/household";
import { loadInvestments } from "./investments";
import type { AccountHoldings } from "./group";

/**
 * Cached `loadInvestments`. Shared by the investments page and GET /api/investments
 * (CLI / `get_holdings` MCP). `AccountHoldings[]` is plain JSON (dates are ISO
 * strings). Holdings refresh nightly; that write busts the household tag, and the
 * TTL backstop bounds it regardless.
 */
export async function getCachedInvestments(householdId: string): Promise<AccountHoldings[]> {
  return cachedHouseholdRead(householdId, ["investments"], (supabase) =>
    loadInvestments({ supabase, householdId }),
  );
}
