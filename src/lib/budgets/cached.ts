import { cachedHouseholdRead } from "@/lib/cache/household";
import { computeBudgets, type BudgetComputeResult } from "./compute";
import type { Period } from "./period";

/**
 * Cached `computeBudgets`. The budgets tab is the most-navigated surface and its
 * compute is the heaviest read (a paged rolling-window transaction scan aggregated
 * in JS), so re-navigating to it was paying full freight every time. Cached per
 * household + period; any household write busts it (see revalidateHousehold).
 *
 * The whole `BudgetComputeResult` is plain JSON (numbers / strings / nested plain
 * objects — no Map/Date/class), so it round-trips through the cache cleanly. `now`
 * is captured by the closure but intentionally NOT keyed: within the TTL it drifts
 * <60s (immaterial to day-granular projections) and the period bounds, which DO
 * key the cache, already roll with the cycle.
 */
export async function getCachedBudgets(
  householdId: string,
  period: Period,
  now?: Date,
): Promise<BudgetComputeResult> {
  return cachedHouseholdRead(
    householdId,
    ["budgets", period.start.toISOString(), period.end.toISOString()],
    (supabase) => computeBudgets({ supabase, householdId, period, now }),
  );
}
