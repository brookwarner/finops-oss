// src/lib/forecast/loaders.ts
// Shared Supabase loaders for the forecast and cashflow engines. Both fetch the
// same income txns, committed ap_amortised bills (last-actual seeded), cap
// budgets, and monthly-income fallback — extracted here so a fix to e.g. the
// bill-seeding scan lands once. The walk is in ./walk; the pure event projectors
// are in ./events.

import type { ScopedDb } from "@/lib/supabase/scoped";
import { getFirstNested } from "@/lib/supabase/relations";
import { projectsForward } from "@/lib/income/classify";
import { normaliseSpendClass } from "@/lib/spend/classify";
import type { IncomeTxn, CommittedBudget, CapBudget, MonthlyIncomeFallback } from "./events";

const DAY_MS = 86_400_000;

// Trailing window for pay-cadence inference (both engines).
export const INCOME_TXN_WINDOW_DAYS = 56;
// Bound the last-actual scan: 120 days comfortably covers a monthly bill's most
// recent posting; cap the row count so a busy category can't run it away.
const LAST_ACTUAL_WINDOW_DAYS = 120;
const LAST_ACTUAL_ROW_LIMIT = 200;
// Mid-month guess for the monthly-income fallback (income budgets carry no
// payment-day column).
export const INCOME_FALLBACK_DAY = 15;

/**
 * Last-`INCOME_TXN_WINDOW_DAYS` income-kind inflows whose type projects forward.
 * Only salary/recurring income is cloned forward as future pay — an irregular or
 * one-off receipt (redundancy payout, receivership lump) is real but cloning it
 * forward would invent income that isn't coming.
 */
export async function loadIncomeTxns(db: ScopedDb, now: Date): Promise<IncomeTxn[]> {
  const incomeSince = new Date(now.getTime() - INCOME_TXN_WINDOW_DAYS * DAY_MS).toISOString();
  const res = await db.transactions
    .select("amount, occurred_at, description, categories(kind, income_type)")
    .gte("occurred_at", incomeSince)
    .order("occurred_at", { ascending: false });
  if (res.error) throw new Error(res.error.message);
  return ((res.data ?? []) as any[])
    .filter((t) => {
      const c = getFirstNested(t.categories);
      return c?.kind === "income" && Number(t.amount) > 0 && projectsForward(c?.income_type);
    })
    .map((t) => ({
      occurred_at: t.occurred_at as string,
      amount: Number(t.amount),
      description: (t.description as string | null) ?? null,
    }));
}

/**
 * Map the already-filtered ap_amortised budget rows into `CommittedBudget`s, each
 * seeded with the day-of-month and amount of its most recent actual posting (so a
 * bill clones forward as a dated lump, not a smeared monthly average). Reserves
 * are excluded by the caller — they're sinking funds spent in irregular lumps.
 */
export async function loadCommittedWithLastActual(
  db: ScopedDb,
  committedBudgets: any[],
  now: Date,
): Promise<CommittedBudget[]> {
  const committedCatIds = committedBudgets.map((b) => b.category_id as string);

  const lastActual = new Map<string, { day: number; amount: number }>();
  if (committedCatIds.length) {
    const histRes = await db.transactions
      .select("amount, occurred_at, category_id")
      .in("category_id", committedCatIds)
      .lt("amount", 0)
      .gte("occurred_at", new Date(now.getTime() - LAST_ACTUAL_WINDOW_DAYS * DAY_MS).toISOString())
      .order("occurred_at", { ascending: false })
      .limit(LAST_ACTUAL_ROW_LIMIT);
    if (histRes.error) throw new Error(histRes.error.message);
    for (const t of (histRes.data ?? []) as any[]) {
      const cat = t.category_id as string;
      if (lastActual.has(cat)) continue;
      lastActual.set(cat, { day: new Date(t.occurred_at).getUTCDate(), amount: Math.abs(Number(t.amount)) });
    }
  }

  return committedBudgets.map((b) => {
    const la = lastActual.get(b.category_id as string);
    return {
      categoryId: (getFirstNested(b.categories)?.name as string) ?? (b.category_id as string),
      kind: b.kind as "ap_amortised" | "reserve",
      monthlyTarget: Number(b.monthly_target),
      lastActualDay: la?.day ?? null,
      lastActualAmount: la?.amount ?? null,
      spendClass: normaliseSpendClass(getFirstNested(b.categories)?.spend_class),
    };
  });
}

/** monthly_cap budgets at their target — the variable-burn cap line. Pure. */
export function loadCapBudgets(budgets: any[]): CapBudget[] {
  return budgets
    .filter((b) => b.kind === "monthly_cap")
    .map((b) => ({
      categoryId: b.category_id as string,
      monthlyTarget: Number(b.monthly_target),
      spendClass: normaliseSpendClass(getFirstNested(b.categories)?.spend_class),
    }));
}

/**
 * Monthly-income fallback (used only when no pay stream can be inferred): the max
 * forward-projecting income budget target, posted mid-month. Ignores
 * irregular/one-off income budgets so it can't prop up the walk with income that
 * doesn't recur. Pure.
 */
export function loadIncomeFallback(budgets: any[]): MonthlyIncomeFallback | null {
  const incomeBudgets = budgets.filter(
    (b) => b.kind === "income" && projectsForward(getFirstNested(b.categories)?.income_type),
  );
  return incomeBudgets.length
    ? { day: INCOME_FALLBACK_DAY, amount: Math.max(...incomeBudgets.map((b) => Number(b.monthly_target))) }
    : null;
}
