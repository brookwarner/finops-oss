// src/lib/income/salaried.ts
// "Is the owner currently salaried?" — a salary-typed paycheck landed in the last
// ~5 weeks. Used to gate the /budgets income-pace card (which only makes sense
// when there's a salary to pace against). Self-corrects ~5 weeks after the last
// pay if the salary stops. Extracted from the retired runway lib's isSalaried
// (the live-salary-budget half of that AND is dropped — a recent real paycheck
// is the honest signal).

import type { SupabaseClient } from "@supabase/supabase-js";
import { scopedDb } from "@/lib/supabase/scoped";
import { getFirstNested } from "@/lib/supabase/relations";
import { normaliseIncomeType } from "@/lib/income/classify";

const DAY_MS = 86_400_000;
const SALARY_RECENT_DAYS = 35; // a salary landing within ~a cycle ⇒ still salaried
// Below this, an "income" credit is interest/cashback/PIE tax, not a wage.
const SALARY_NOISE_FLOOR = 95;

export interface IsCurrentlySalariedArgs {
  supabase: SupabaseClient;
  householdId: string;
  now?: Date;
}

/** True when a salary-typed income credit ≥ the noise floor posted in the last
 *  ~5 weeks. Deterministic given `now` (and the data). */
export async function isCurrentlySalaried(args: IsCurrentlySalariedArgs): Promise<boolean> {
  const { supabase, householdId } = args;
  const now = args.now ?? new Date();
  const db = scopedDb(supabase, householdId);
  const since = new Date(now.getTime() - SALARY_RECENT_DAYS * DAY_MS).toISOString();

  const res = await db.transactions
    .select("amount, categories(kind, income_type)")
    .gte("occurred_at", since)
    .gte("amount", SALARY_NOISE_FLOOR)
    .not("category_id", "is", null);
  if (res.error) throw new Error(res.error.message);

  return ((res.data ?? []) as any[]).some((t) => {
    const c = getFirstNested(t.categories);
    return c?.kind === "income" && normaliseIncomeType(c?.income_type as string | null) === "salary";
  });
}
