import { revalidateTag, unstable_cache } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import type { Database } from "@/lib/supabase/database.types";

/**
 * TTL backstop for every household read cache. Interactive writes invalidate the
 * household tag immediately (revalidateHousehold), so this only bounds staleness
 * from sources that DON'T invalidate — chiefly the nightly/poll crons, which ride
 * this timer rather than each threading a revalidate. 60s keeps post-cron data
 * fresh-enough without a per-cron hook to maintain.
 */
export const HOUSEHOLD_READ_TTL_SECONDS = 60;

/**
 * One coarse cache tag per household. Every household-scoped read cache is
 * tagged with this; every write that touches household financial data busts it.
 *
 * Coarse on purpose. Fine-grained per-table invalidation risks missing a
 * dependency and serving stale *money* — the one thing a finance app can't do.
 * Over-invalidation just costs a recompute on the next read, so we always prefer
 * it: any write → drop the whole household's cached reads.
 */
export function householdCacheTag(householdId: string): string {
  return `household:${householdId}`;
}

/**
 * Bust every cached read for a household. Call from any server action / route
 * handler after a write that changes data the budgets/investments/net-worth
 * surfaces read (transactions, categories, budgets, accounts, holdings, …).
 *
 * Safe to over-call: a redundant invalidation is just a cache miss next read.
 */
export function revalidateHousehold(householdId: string): void {
  revalidateTag(householdCacheTag(householdId));
}

/**
 * Wrap a household-scoped READ in `unstable_cache`, keyed by household + caller
 * key parts, tagged so any household write busts it, with the TTL backstop.
 *
 * The compute runs against a service-role client — `unstable_cache` can't capture
 * the request's cookie client, and a service client is serialization-free. Callers
 * MUST keep every query scoped to `householdId` (via `scopedDb`), so results match
 * the RLS path; it stays read-only. Only cache plain-JSON returns: no `Map`, `Date`,
 * `Set`, or class instances (they don't round-trip through the cache).
 *
 * Time-dependent computes may capture a `now` in the closure that isn't part of the
 * key — fine while it drifts < the TTL window. Anything that changes the RESULT
 * shape (period bounds, a scenario lever) must go in `keyParts` instead, or bypass
 * the cache entirely for that call.
 */
export function cachedHouseholdRead<T>(
  householdId: string,
  keyParts: string[],
  compute: (supabase: SupabaseClient<Database>) => Promise<T>,
): Promise<T> {
  const run = unstable_cache(
    () => compute(createSupabaseServiceClient()),
    ["household-read", householdId, ...keyParts],
    { tags: [householdCacheTag(householdId)], revalidate: HOUSEHOLD_READ_TTL_SECONDS },
  );
  return run();
}
