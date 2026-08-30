import type { ScopedDb } from "@/lib/supabase/scoped";
import { RESERVE_ACCRUAL_START } from "./period";

/**
 * Reserve (sinking-fund) spend per category from RESERVE_ACCRUAL_START up to
 * `periodEnd`, summed as outflow (`-amount`, so inflows/refunds offset spend).
 *
 * Shared by the budgets page (net reserve balance per category) and the cashflow
 * forecast (net earmarked total) so the "what's left in the pot" figure can't
 * drift between surfaces. The history scan can span years, so it pages past the
 * 1000-row cap.
 */
export async function reserveSpendByCat(
  db: ScopedDb,
  reserveCatIds: string[],
  periodEnd: Date,
): Promise<Map<string, number>> {
  const spend = new Map<string, number>();
  if (reserveCatIds.length === 0) return spend;
  const rows: { amount: number; category_id: string }[] = await db.transactions.selectAllPaged((q) =>
    q.select("amount, category_id, occurred_at")
      .in("category_id", reserveCatIds)
      .gte("occurred_at", RESERVE_ACCRUAL_START.toISOString())
      .lt("occurred_at", periodEnd.toISOString()),
  );
  for (const t of rows) {
    const cat = t.category_id as string;
    // outflow = -amount (uniform sign convention: outflows positive, refunds offset).
    spend.set(cat, (spend.get(cat) ?? 0) + -Number(t.amount));
  }
  return spend;
}
