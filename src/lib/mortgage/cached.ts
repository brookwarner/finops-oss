import { cachedHouseholdRead } from "@/lib/cache/household";
import { computeMortgagePI, type MortgagePI } from "./pi";

/**
 * Cached `computeMortgagePI` for the DEFAULT lens (current year, no what-if
 * scenario) — what the investments page and a bare GET /api/mortgage use.
 * `MortgagePI` is plain JSON. A specific `?year=` or a `scenario` lever
 * (extraMonthly / lumpSum / refixRate) is parameterised and rare, so those calls
 * compute live rather than caching every combination.
 */
export async function getCachedMortgagePI(householdId: string): Promise<MortgagePI> {
  return cachedHouseholdRead(householdId, ["mortgage-pi"], (supabase) =>
    computeMortgagePI({ supabase, householdId }),
  );
}
