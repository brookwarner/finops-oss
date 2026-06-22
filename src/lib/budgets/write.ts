import type { SupabaseClient } from "@supabase/supabase-js";
import { scopedDb } from "@/lib/supabase/scoped";

export type SetTargetResult =
  | { ok: true; previousTarget: number; newTarget: number }
  | { ok: false; reason: "no-budget" };

/** Set budgets.monthly_target for a household+category. Refuses if no row exists. */
export async function setBudgetTarget(args: {
  supabase: SupabaseClient;
  householdId: string;
  categoryId: string;
  monthlyTarget: number;
}): Promise<SetTargetResult> {
  const { supabase, householdId, categoryId, monthlyTarget } = args;
  const db = scopedDb(supabase, householdId);

  const { data: existing } = await db.budgets
    .select("monthly_target")
    .eq("category_id", categoryId)
    .maybeSingle();
  if (!existing) return { ok: false, reason: "no-budget" };

  const { error } = await db.budgets
    .update({ monthly_target: monthlyTarget })
    .eq("category_id", categoryId)
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  return { ok: true, previousTarget: Number(existing.monthly_target), newTarget: monthlyTarget };
}
