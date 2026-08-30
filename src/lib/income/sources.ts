// src/lib/income/sources.ts
//
// Read/write the per-source income classification (categories.income_type,
// migration 0042). Used by the /settings/income editor; the *reads* that act on
// the classification live in the forecast and runway engines.

import type { SupabaseClient } from "@supabase/supabase-js";
import { scopedDb } from "@/lib/supabase/scoped";
import { INCOME_TYPES, normaliseIncomeType, type IncomeType } from "./classify";

export interface IncomeSource {
  id: string;
  name: string;
  incomeType: IncomeType;
}

/** Every income category for the household, with its classification (NULL ⇒
 *  'recurring'), ordered by name for a stable settings list. */
export async function listIncomeSources(
  supabase: SupabaseClient,
  householdId: string,
): Promise<IncomeSource[]> {
  const db = scopedDb(supabase, householdId);
  const { data, error } = await db.categories
    .select("id, name, income_type")
    .eq("kind", "income")
    .order("name", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((c: any) => ({
    id: c.id as string,
    name: c.name as string,
    incomeType: normaliseIncomeType(c.income_type as string | null),
  }));
}

export type SetIncomeTypeResult = { ok: true } | { ok: false; reason: string };

/** Set an income category's classification. Scoped to the household and to
 *  kind='income' so only income sources are ever touched. */
export async function setIncomeType(args: {
  supabase: SupabaseClient;
  householdId: string;
  categoryId: string;
  incomeType: IncomeType;
}): Promise<SetIncomeTypeResult> {
  if (!INCOME_TYPES.includes(args.incomeType)) return { ok: false, reason: "invalid-type" };
  const db = scopedDb(args.supabase, args.householdId);
  const { data, error } = await db.categories
    .update({ income_type: args.incomeType })
    .eq("id", args.categoryId)
    .eq("kind", "income")
    .select("id")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return { ok: false, reason: "not-found" };
  return { ok: true };
}
