import type { SupabaseClient } from "@supabase/supabase-js";
import { scopedDb } from "@/lib/supabase/scoped";

export type Cat = { id: string; name: string; group: string | null };

export type ResolveResult =
  | { ok: true; category: Cat }
  | { ok: false; reason: "none" | "ambiguous"; candidates: Cat[] };

/** Pure name → category matcher. Exact (ci) wins; else a UNIQUE substring; else refuse. */
export function pickCategory(categories: Cat[], name: string): ResolveResult {
  const q = name.trim().toLowerCase();
  if (!q) return { ok: false, reason: "none", candidates: categories };

  const exact = categories.find((c) => c.name.toLowerCase() === q);
  if (exact) return { ok: true, category: exact };

  const subs = categories.filter((c) => c.name.toLowerCase().includes(q));
  if (subs.length === 1) return { ok: true, category: subs[0] };
  if (subs.length === 0) return { ok: false, reason: "none", candidates: categories };
  return { ok: false, reason: "ambiguous", candidates: subs };
}

/** Fetch this household's categories and resolve `name` via pickCategory. */
export async function resolveCategory(
  supabase: SupabaseClient,
  householdId: string,
  name: string,
): Promise<ResolveResult> {
  const { data, error } = await scopedDb(supabase, householdId).categories
    .select("id, name, \"group\"");
  if (error) return { ok: false, reason: "none", candidates: [] };
  return pickCategory((data ?? []) as Cat[], name);
}
