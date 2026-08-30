// src/lib/cashflow/compute.ts
// Cashflow loader: fetches inputs from Supabase and runs the pure engine.
// Pure `buildLines` and its types live in ./engine (client-safe, no Supabase).
// Back-compat re-exports below keep existing importers and tests working.

import type { SupabaseClient } from "@supabase/supabase-js";
import { scopedDb } from "@/lib/supabase/scoped";
import { defaultPeriod, periodProgress } from "@/lib/budgets/period";
import { getFirstNested } from "@/lib/supabase/relations";
import { normaliseSpendClass } from "@/lib/spend/classify";
import { LIQUID_ACCOUNT_TYPES, creditHeadroom } from "@/lib/accounts/classify";
import { mapInflows } from "./inflows";
import { loadIncomeTxns, loadCommittedWithLastActual, loadCapBudgets, loadIncomeFallback } from "@/lib/forecast/loaders";
import { type ActualCap } from "@/lib/forecast/events";
import { type CashflowToggles } from "./scenario";
import { buildLines, DAY_MS, HORIZON_CAP_DAYS, type BuildLinesArgs, type CashflowLine, type CashflowResult } from "./engine";

// Back-compat re-exports so existing importers (tests, CLI, MCP) don't break.
export { buildLines } from "./engine";
export type { BuildLinesArgs, CashflowLine, CashflowResult } from "./engine";

export interface ComputeCashflowArgs {
  supabase: SupabaseClient;
  householdId: string;
  toggles?: CashflowToggles;
  now?: Date;
}

export interface ComputeCashflowBaseArgs {
  supabase: SupabaseClient;
  householdId: string;
  now?: Date;
}

const ACTUAL_BURN_WINDOW_DAYS = 90; // trailing window for per-category actual daily burn

/**
 * Load everything the cashflow lines need and run the pure core. Data access
 * mirrors forecast/compute.ts (income txns, ap_amortised committed bills with
 * last-actual seeding, monthly_cap budget caps, cycle length) and
 * runway/compute.ts (liquid start balance, receivables). The one cashflow-only
 * load is `actualCaps`: trailing-90d actual spend per monthly_cap category,
 * which drives the actual/bare/custom burn lines.
 */
export async function computeCashflow(args: ComputeCashflowArgs): Promise<CashflowResult> {
  const base = await computeCashflowBase(args);
  return buildLines({ ...base, toggles: args.toggles ?? {} });
}

/**
 * Load everything the cashflow lines need and return the pure-engine input
 * (`BuildLinesArgs`) WITHOUT toggles applied (toggles defaults to `{}`). The
 * page derives a first-paint result via `buildLines(base)` and serialises the
 * base (now → ISO) to the client island so it can recompute live as the user
 * drags the what-if controls. `computeCashflow` is just `buildLines(base + toggles)`.
 */
export async function computeCashflowBase(args: ComputeCashflowBaseArgs): Promise<BuildLinesArgs> {
  const { supabase, householdId } = args;
  const db = scopedDb(supabase, householdId);
  const now = args.now ?? new Date();
  const period = defaultPeriod(now);
  const { periodLength } = periodProgress(period.start, period.end, now);

  const burnSince = new Date(now.getTime() - ACTUAL_BURN_WINDOW_DAYS * DAY_MS).toISOString();

  const [accountsRes, budgetsRes, incomeTxns, capSpendRes] = await Promise.all([
    db.accounts.select(
      "name, type, balance_current, balance_available, akahu_account_id, is_revolving_facility, expected_inflows(likelihood, expected_date, pre_tax, tax_rate)",
    ),
    db.budgets
      .select("monthly_target, kind, category_id, categories(name, income_type, spend_class)")
      .eq("active", true),
    // Last-56d forward-projecting income inflows — shared with forecast/compute.ts.
    loadIncomeTxns(db, now),
    // Trailing-90d outflows in monthly_cap categories → per-category daily actual.
    // Joined to categories so we can filter to monthly_cap + read spend_class; we
    // group in JS (the scoped client has no group-by). Cashflow-only.
    db.transactions
      .select("amount, occurred_at, category_id, categories(name, kind, spend_class)")
      .gte("occurred_at", burnSince)
      .lt("amount", 0),
  ]);
  if (accountsRes.error) throw new Error(accountsRes.error.message);
  if (budgetsRes.error) throw new Error(budgetsRes.error.message);
  if (capSpendRes.error) throw new Error(capSpendRes.error.message);

  const accounts = (accountsRes.data ?? []) as any[];
  const startLiquid = accounts
    .filter((a) => LIQUID_ACCOUNT_TYPES.has(a.type as string))
    .reduce((s, a) => s + Number(a.balance_current ?? 0), 0);

  const inflows = mapInflows(accounts);
  const receivables = inflows.reduce((s, i) => s + i.amount, 0);
  const headroom = creditHeadroom(accounts);

  const budgets = (budgetsRes.data ?? []) as any[];

  // Committed: ap_amortised budgets, each seeded with the day/amount of its most
  // recent actual posting (shared with forecast/compute.ts). Shadow (unbudgeted
  // recurring) committed bills are intentionally NOT appended here — the cashflow
  // lines are scenario-comparison oriented and the budgeted ap_amortised set is
  // the spend_class-classified one a scenario can reason about.
  const committed = await loadCommittedWithLastActual(
    db,
    budgets.filter((b) => b.kind === "ap_amortised"),
    now,
  );

  // Budget caps: monthly_cap budgets at their target (the on-budget line).
  const budgetCaps = loadCapBudgets(budgets);

  // Actual caps: trailing-90d actual outflow per monthly_cap category ÷ 90 days.
  // Only categories whose kind is monthly_cap count (committed bills are dated
  // lumps, not run-rated daily burn).
  const capSpend = new Map<string, { sum: number; spendClass: ReturnType<typeof normaliseSpendClass> }>();
  for (const t of (capSpendRes.data ?? []) as any[]) {
    const c = getFirstNested(t.categories);
    if (c?.kind !== "monthly_cap") continue;
    const cat = (t.category_id as string) ?? "";
    if (!cat) continue;
    const prev = capSpend.get(cat) ?? { sum: 0, spendClass: normaliseSpendClass(c?.spend_class) };
    prev.sum += Math.abs(Number(t.amount));
    capSpend.set(cat, prev);
  }
  const actualCaps: ActualCap[] = Array.from(capSpend.entries()).map(([categoryId, v]) => ({
    categoryId,
    // Divisor is the fixed 90-day window regardless of how much history exists;
    // sparse-history categories under-burn (documented run-rate smoothing).
    dailyActual: v.sum / ACTUAL_BURN_WINDOW_DAYS,
    spendClass: v.spendClass,
  }));

  // Monthly income fallback (only when no pay stream can be inferred): max
  // forward-projecting income budget target, posted mid-month. Shared loader.
  const incomeFallback = loadIncomeFallback(budgets);

  return {
    now,
    horizonDays: HORIZON_CAP_DAYS,
    startLiquid,
    cycleLength: periodLength,
    incomeTxns,
    incomeFallback,
    actualCaps,
    budgetCaps,
    committed,
    toggles: {},
    receivables,
    creditHeadroom: headroom,
    inflows,
  };
}
