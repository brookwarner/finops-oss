import { cachedHouseholdRead } from "@/lib/cache/household";
import { computeNetWorth, type NetWorthResult } from "./compute";

/**
 * Cached `computeNetWorth`. Shared by the investments page headline and
 * GET /api/net-worth (CLI/MCP). `NetWorthResult` is plain JSON. Any household
 * write (balances, holdings, accounts) busts the tag.
 */
export async function getCachedNetWorth(householdId: string): Promise<NetWorthResult> {
  return cachedHouseholdRead(householdId, ["net-worth"], (supabase) =>
    computeNetWorth({ supabase, householdId }),
  );
}
