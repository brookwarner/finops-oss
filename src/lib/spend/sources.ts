// src/lib/spend/sources.ts
//
// Read/write the per-category spend classification (categories.spend_class,
// migration 0043). Used by the /settings/spending editor; the *reads* that act on
// the classification live in the cashflow game-plan (bare-essentials floor +
// discretionary cut lever).

import type { SupabaseClient } from "@supabase/supabase-js";
import { scopedDb } from "@/lib/supabase/scoped";
import { SPEND_CLASSES, normaliseSpendClass, type SpendClass } from "./classify";

export interface SpendSource {
  id: string;
  name: string;
  group: string | null;
  spendClass: SpendClass;
}

/** Every spendable category for the household (monthly_cap + ap_amortised), with
 *  its classification (NULL ⇒ 'essential'), ordered by group then name for a
 *  stable settings list. */
export async function listSpendSources(
  supabase: SupabaseClient,
  householdId: string,
): Promise<SpendSource[]> {
  const db = scopedDb(supabase, householdId);
  const { data, error } = await db.categories
    .select("id, name, group, spend_class")
    .in("kind", ["monthly_cap", "ap_amortised"])
    .order("group", { ascending: true })
    .order("name", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((c: any) => ({
    id: c.id as string,
    name: c.name as string,
    group: (c.group as string | null) ?? null,
    spendClass: normaliseSpendClass(c.spend_class as string | null),
  }));
}

export type SetSpendClassResult = { ok: true } | { ok: false; reason: string };

/** Set a spend category's classification. Scoped to the household and to the
 *  spendable kinds (monthly_cap / ap_amortised) so only spend categories are
 *  ever touched. */
export async function setSpendClass(args: {
  supabase: SupabaseClient;
  householdId: string;
  categoryId: string;
  spendClass: SpendClass;
}): Promise<SetSpendClassResult> {
  if (!SPEND_CLASSES.includes(args.spendClass)) return { ok: false, reason: "invalid-class" };
  const db = scopedDb(args.supabase, args.householdId);
  const { data, error } = await db.categories
    .update({ spend_class: args.spendClass })
    .eq("id", args.categoryId)
    .in("kind", ["monthly_cap", "ap_amortised"])
    .select("id")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return { ok: false, reason: "not-found" };
  return { ok: true };
}
