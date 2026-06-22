import { cachedHouseholdRead } from "@/lib/cache/household";
import { computeFI, type FIResult } from "./compute";

/**
 * Cached `computeFI` for the DEFAULT projection (current `now`, default real
 * return) — what the investments page and a bare GET /api/fi use. `FIResult` is
 * plain JSON. A `?realReturn=` what-if is a rare, open-ended parameter, so those
 * calls compute live (caller passes them to `computeFI` directly) rather than
 * bloating the cache with low-reuse entries.
 */
export async function getCachedFI(householdId: string): Promise<FIResult> {
  return cachedHouseholdRead(householdId, ["fi"], (supabase) =>
    computeFI({ supabase, householdId }),
  );
}
