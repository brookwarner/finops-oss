import type { SupabaseClient, PostgrestError } from "@supabase/supabase-js";

/**
 * Distinct `household_id`s, deduped from a set of already-fetched account rows.
 * Single-user today, but every cron iterates households for the multi-user-ready
 * data model.
 */
export function uniqueHouseholdIds(rows: { household_id: string }[]): string[] {
  return Array.from(new Set(rows.map((r) => r.household_id)));
}

/**
 * Load the household ids across all accounts. Surfaces the query error so the
 * caller can 500 (mirrors the inline pattern the cron routes shared).
 */
export async function loadHouseholdIds(
  supabase: SupabaseClient,
): Promise<{ households: string[]; error: PostgrestError | null }> {
  // scoped-db-exempt: enumerates distinct households across all accounts (the
  // multi-user-ready cron fan-out); callers scope every per-household query by
  // the ids returned here.
  const { data, error } = await supabase.from("accounts").select("household_id");
  if (error) return { households: [], error };
  return { households: uniqueHouseholdIds(data ?? []), error: null };
}
