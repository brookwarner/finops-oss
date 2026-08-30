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
import { derivePostings, type PostingTxn } from "./postings";

const DAY_MS = 86_400_000;

// Trailing window for pay-cadence inference (both engines).
export const INCOME_TXN_WINDOW_DAYS = 56;
// Bound the bill-seeding scan: 120 days comfortably covers a monthly bill's most
// recent cycle; cap the row count so a busy category can't run it away. The limit
// is generous because the whole cycle is seeded now (a category can be a dozen
// direct debits), and rows come back newest-first so any truncation drops the
// oldest — which `derivePostings` would discard as stale anyway.
const LAST_ACTUAL_WINDOW_DAYS = 120;
const LAST_ACTUAL_ROW_LIMIT = 1000;
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
 * seeded with one monthly cycle of its actual postings — day-of-month + amount per
 * debit (so a bill clones forward as dated lumps, not a smeared monthly average).
 * A category is seeded from ALL of its recurring debits, not just the most recent
 * one: "Insurance" is five direct debits on the 20th, and seeding only the last of
 * them understated the category by hundreds of dollars a month. Reserves are
 * excluded by the caller — they're sinking funds spent in irregular lumps.
 */
export async function loadCommittedWithLastActual(
  db: ScopedDb,
  committedBudgets: any[],
  now: Date,
): Promise<CommittedBudget[]> {
  const committedCatIds = committedBudgets.map((b) => b.category_id as string);

  const byCat = new Map<string, PostingTxn[]>();
  if (committedCatIds.length) {
    const histRes = await db.transactions
      .select("amount, occurred_at, category_id, merchant, description")
      .in("category_id", committedCatIds)
      .lt("amount", 0)
      .gte("occurred_at", new Date(now.getTime() - LAST_ACTUAL_WINDOW_DAYS * DAY_MS).toISOString())
      .order("occurred_at", { ascending: false })
      .limit(LAST_ACTUAL_ROW_LIMIT);
    if (histRes.error) throw new Error(histRes.error.message);
    for (const t of (histRes.data ?? []) as any[]) {
      const cat = t.category_id as string;
      const rows = byCat.get(cat);
      const row: PostingTxn = {
        occurred_at: t.occurred_at as string,
        amount: Number(t.amount),
        merchant: (t.merchant as string | null) ?? null,
        description: (t.description as string | null) ?? null,
      };
      if (rows) rows.push(row); else byCat.set(cat, [row]);
    }
  }

  return committedBudgets.map((b) => ({
    categoryId: (getFirstNested(b.categories)?.name as string) ?? (b.category_id as string),
    kind: b.kind as "ap_amortised" | "reserve",
    monthlyTarget: Number(b.monthly_target),
    postings: derivePostings(byCat.get(b.category_id as string) ?? [], now),
    spendClass: normaliseSpendClass(getFirstNested(b.categories)?.spend_class),
  }));
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
