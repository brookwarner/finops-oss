import type { SupabaseClient } from "@supabase/supabase-js";
import { scopedDb } from "@/lib/supabase/scoped";

/** Mirrors the budgets.kind / categories.kind CHECK constraints (migration 0036). */
export const BUDGET_KINDS = ["monthly_cap", "reserve", "ap_amortised", "income", "savings"] as const;
export type CreateableBudgetKind = (typeof BUDGET_KINDS)[number];

export type CreateBudgetResult =
  | { ok: true; categoryId: string; categoryCreated: boolean; kind: CreateableBudgetKind; monthlyTarget: number; group: string | null }
  | { ok: false; reason: "already-has-budget"; existingTarget: number }
  | { ok: false; reason: "invalid-kind" };

/**
 * Create a net-new budget. Attaches to an existing category (matched
 * case-insensitively, exact name only — no fuzzy/substring match, to avoid
 * silently attaching to the wrong category) if one exists, else creates the
 * category too (mirrors the 0014/0051 seed-migration shape, done at runtime).
 * Refuses if the category already has a budget — use setBudgetTarget instead.
 */
export async function createBudget(args: {
  supabase: SupabaseClient;
  householdId: string;
  categoryName: string;
  kind: string;
  monthlyTarget: number;
  group?: string | null;
}): Promise<CreateBudgetResult> {
  const { supabase, householdId, categoryName, kind, monthlyTarget, group } = args;
  if (!(BUDGET_KINDS as readonly string[]).includes(kind)) return { ok: false, reason: "invalid-kind" };
  const db = scopedDb(supabase, householdId);

  const name = categoryName.trim();
  const { data: categories, error: catListErr } = await db.categories.select("id, name, \"group\"");
  if (catListErr) throw new Error(catListErr.message);
  const existingCat = ((categories ?? []) as { id: string; name: string; group: string | null }[])
    .find((c) => c.name.toLowerCase() === name.toLowerCase());

  let categoryId: string;
  let categoryCreated = false;
  let resolvedGroup: string | null;

  if (existingCat) {
    categoryId = existingCat.id;
    resolvedGroup = existingCat.group;
  } else {
    const { data: inserted, error: catErr } = await db.categories
      .insert({ name, kind, group: group ?? null })
      .select("id, \"group\"")
      .single();
    if (catErr) throw new Error(catErr.message);
    categoryId = inserted.id;
    categoryCreated = true;
    resolvedGroup = inserted.group ?? null;
  }

  const { data: existingBudget } = await db.budgets
    .select("monthly_target")
    .eq("category_id", categoryId)
    .maybeSingle();
  if (existingBudget) {
    return { ok: false, reason: "already-has-budget", existingTarget: Number(existingBudget.monthly_target) };
  }

  const { error } = await db.budgets
    .insert({ category_id: categoryId, kind, monthly_target: monthlyTarget, active: true });
  if (error) throw new Error(error.message);

  return { ok: true, categoryId, categoryCreated, kind: kind as CreateableBudgetKind, monthlyTarget, group: resolvedGroup };
}

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
