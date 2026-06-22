import type { SupabaseClient } from "@supabase/supabase-js";
import { ROLLING_PERIODS, RESERVE_ACCRUAL_START, periodProgress, rollingWindowStart, priorCycleStart, monthsBetween, toISODate, type Period } from "./period";
import { computePosition, type Position } from "./position";
import { scopedDb } from "@/lib/supabase/scoped";
import { reserveSpendByCat } from "./reserves";
import { allocateContributions, loadBufferContext } from "@/lib/reserves/buffer";
import { getFirstNested } from "@/lib/supabase/relations";
import { shadowCommittedByCat, toShadowCategoryKind, type ShadowBill } from "./committed";
import { categorisePending, type Rule } from "@/lib/categorise/engine";

const LAST_N_PREVIEW = 5;

/** Round a number to the nearest cent (2 decimal places). */
function toCents(n: number): number {
  return Math.round(n * 100) / 100;
}

export interface TxnPreview {
  id: string; occurred_at: string; amount: number;
  merchant: string | null; description: string | null;
  category_id: string; accountType: string | null;
  /** True for provisional pending (unsettled) rows attributed by the rule
   *  engine — rendered with a "pending" hint and never persisted. */
  pending?: boolean;
}
export type BudgetKind = "monthly_cap" | "reserve" | "ap_amortised" | "income" | "savings";
export type RagStatus = "ok" | "warning" | "over";
export interface BudgetStatusRow {
  budgetId: string; categoryId: string; category: string; group: string | null; kind: BudgetKind;
  target: number; spent: number; reimbursed: number; netSpent: number;
  effectiveSpend: number; pct: number; remaining: number; status: RagStatus;
  projected: number | null; priorSpend: number;
  reserveBalance: number | null; avgMonthlySpend: number; recent: TxnPreview[];
  /**
   * Provisional pending (unsettled) net-outflow attributed to this category by
   * the rule engine — money spent at the bank but not yet settled. Additive to
   * `effectiveSpend` for a true "committed so far" view; 0 when none. Not part of
   * the audited `spent`/`pct`/`status`, which stay settled-only.
   */
  pendingSpent: number;
}
export interface BudgetComputeResult {
  period: { start: string; end: string; dayOfPeriod: number; periodLength: number; daysLeft: number };
  rows: BudgetStatusRow[];
  flex: { amount: number; categoriesIncluded: number };
  inbox: { categorisedInWindow: number; inboxInWindow: number };
  position: Position;
  shadowCommitted: ShadowBill[];
  /**
   * Pending net-outflow the rule engine couldn't attribute to a category (raw
   * pending descriptions sometimes don't match settled-trained rules). Surfaced
   * so the per-budget pending overlay never silently mis-attributes; it's still
   * counted in the Position total. Floored at 0.
   */
  unallocatedPending: number;
  /**
   * Designated reserve-buffer pot. `contributions` = inflows to the buffer
   * account since RESERVE_ACCRUAL_START (credited across behind reserves below);
   * `sweptThisCycle` = inflows since this cycle's start (drives the sweep nudge);
   * `uncommitted` = total contributions pot beyond total shortfall; `accountId` is null until a
   * buffer account is designated.
   */
  reserveBuffer: { accountId: string | null; balance: number; contributions: number; sweptThisCycle: number; uncommitted: number };
}
export interface ComputeArgs {
  supabase: SupabaseClient; householdId: string; period: Period; now?: Date;
}

function ragStatus(pct: number): RagStatus {
  if (pct > 100) return "over";
  if (pct >= 80) return "warning";
  return "ok";
}

export async function computeBudgets(args: ComputeArgs): Promise<BudgetComputeResult> {
  const { supabase, householdId, period } = args;
  const db = scopedDb(supabase, householdId);
  const now = args.now ?? new Date();
  const { periodLength, dayOfPeriod, daysLeft } = periodProgress(period.start, period.end, now);
  const windowStart = rollingWindowStart(period.start);
  const priorStart = priorCycleStart(period.start);

  const [budgetsRes, uncatRes, catsRes] = await Promise.all([
    db.budgets
      .select("id, monthly_target, kind, category_id, categories(id, name, group)")
      .eq("active", true)
      .order("monthly_target", { ascending: false }),
    db.transactions
      .select("id", { count: "exact", head: true })
      .gte("occurred_at", windowStart.toISOString())
      .lt("occurred_at", period.end.toISOString())
      .is("category_id", null).eq("is_manual_category", false),
    db.categories
      .select("id, kind, group, name"),
  ]);
  if (budgetsRes.error) throw new Error(budgetsRes.error.message);
  if (catsRes.error) throw new Error(catsRes.error.message);

  // Paginated rolling-window transaction scan (no .limit() / PostgREST cap is 1000 rows).
  const allTxns: any[] = await db.transactions.selectAllPaged((q) =>
    q.select("id, amount, category_id, occurred_at, merchant, description, accounts(type)")
      .gte("occurred_at", windowStart.toISOString())
      .lt("occurred_at", period.end.toISOString())
      .not("category_id", "is", null)
      .order("occurred_at", { ascending: false }),
  );

  const currentByCat = new Map<string, number>();
  const currentReimbByCat = new Map<string, number>();
  const rollingByCat = new Map<string, number>();
  const priorByCat = new Map<string, number>();
  const lastByCat = new Map<string, TxnPreview[]>();
  for (const t of allTxns) {
    const acct = getFirstNested((t as any).accounts);
    // Akahu signs debits negative on every account type (a loan interest charge
    // reads the same as an everyday-account purchase), so outflow is uniformly
    // -amount. Inflows (incl. the far leg of a transfer landing on the liability
    // side) come through negative and are excluded per-kind below.
    const outflow = toCents(-Number(t.amount));
    const cat = t.category_id as string;
    const occurred = new Date(t.occurred_at as string);
    if (occurred >= period.start) {
      if (outflow >= 0) currentByCat.set(cat, (currentByCat.get(cat) ?? 0) + outflow);
      else currentReimbByCat.set(cat, (currentReimbByCat.get(cat) ?? 0) + (-outflow));
    } else {
      rollingByCat.set(cat, (rollingByCat.get(cat) ?? 0) + outflow);
      if (occurred >= priorStart) priorByCat.set(cat, (priorByCat.get(cat) ?? 0) + outflow);
    }
    const list = lastByCat.get(cat) ?? [];
    if (list.length < LAST_N_PREVIEW) {
      list.push({ id: t.id as string, occurred_at: t.occurred_at as string, amount: Number(t.amount),
        merchant: (t as any).merchant ?? null, description: (t as any).description ?? null,
        category_id: cat, accountType: acct?.type ?? null });
      lastByCat.set(cat, list);
    }
  }

  const budgets = (budgetsRes.data ?? []) as any[];

  // Pending (unsettled) outflow for the current cycle. These rows are money
  // already spent at the bank but not yet in the settled `transactions` feed
  // (1–3 days behind). Pending carries no merchant/category, but the merchant is
  // the description prefix — so `categorisePending` resolves most rows to a
  // category via the household's existing rules (provisional, never persisted —
  // pending is wipe-replaced each poll). We bucket signed net (-amount, so a
  // pending refund/auth-reversal offsets a charge) by category for the per-budget
  // overlay, keep the unmatched remainder as "unallocated pending", and the
  // overall floored total feeds the Position projection. Best-effort: a failure
  // here must not break budgets.
  let pendingOutflow = 0;
  const pendingByCat = new Map<string, number>();
  // Pending rows attributed to a category, kept as previews so they surface in
  // the per-budget "Last N" list (unsettled spend was otherwise invisible there).
  const pendingPreviewByCat = new Map<string, TxnPreview[]>();
  let unallocatedPending = 0;
  const [pendingRes, rulesRes] = await Promise.all([
    db.pending_transactions
      .select("id, amount, occurred_at, description")
      .gte("occurred_at", period.start.toISOString())
      .lt("occurred_at", period.end.toISOString())
      .order("occurred_at", { ascending: false }),
    db.category_rules.select("id, category_id, match_type, match_value, field, priority, source, min_amount, max_amount"),
  ]);
  if (!pendingRes.error) {
    const rules = (rulesRes.error ? [] : (rulesRes.data ?? [])) as Rule[];
    let net = 0;
    for (const p of pendingRes.data ?? []) {
      const amount = Number((p as any).amount);
      const outflow = toCents(-amount); // signed: charge > 0, refund < 0
      net += outflow;
      const description = (p as any).description ?? null;
      const catId = categorisePending({ description, amount }, rules);
      if (catId) {
        pendingByCat.set(catId, toCents((pendingByCat.get(catId) ?? 0) + outflow));
        const list = pendingPreviewByCat.get(catId) ?? [];
        list.push({ id: (p as any).id as string, occurred_at: (p as any).occurred_at as string,
          amount, merchant: null, description, category_id: catId, accountType: null, pending: true });
        pendingPreviewByCat.set(catId, list);
      } else {
        unallocatedPending = toCents(unallocatedPending + outflow);
      }
    }
    pendingOutflow = Math.max(0, toCents(net));
    unallocatedPending = Math.max(0, unallocatedPending);
  }

  // Reserves (sinking funds) accrue monthly_target from RESERVE_ACCRUAL_START with
  // an opening balance of $0, decremented by real spend since that date — not the
  // 3-month rolling window the main query covers. Pull each reserve category's
  // spend since the start date separately. Inflows offset spend (signed); the
  // final balance is floored at $0 below (no negatives).
  const reserveCatIds = budgets
    .filter((b) => b.kind === "reserve")
    .map((b) => b.category_id as string);
  // Independent queries — run in parallel (reserve spend vs buffer inflows).
  const [reserveSpend, buffer] = await Promise.all([
    reserveSpendByCat(db, reserveCatIds, period.end),
    loadBufferContext(db, period.start, period.end),
  ]);

  const rows: BudgetStatusRow[] = budgets.map((b) => {
    const cat = b.category_id as string;
    const target = Number(b.monthly_target);
    const spent = currentByCat.get(cat) ?? 0;
    const reimbursed = currentReimbByCat.get(cat) ?? 0;
    const netSpent = spent - reimbursed;
    // Auto-pay budgets count the gross outflow leg only (interest charge, or cash
    // out toward principal); the transfer's far leg lands as an inflow and must
    // not offset the spend, else each repayment nets to $0. Other kinds use net.
    const effectiveSpend = b.kind === "ap_amortised" ? spent : netSpent;
    const pct = target > 0 ? (effectiveSpend / target) * 100 : 0;
    const avgMonthlySpend = Math.max(0, rollingByCat.get(cat) ?? 0) / ROLLING_PERIODS;
    // Gross outflow in the immediately-preceding cycle (old page: spentPrior).
    const priorSpend = Math.max(0, priorByCat.get(cat) ?? 0);
    // "On pace" run-rate projection for monthly caps (old page: projected).
    const projected = b.kind === "monthly_cap" && dayOfPeriod > 0
      ? (Math.max(0, effectiveSpend) / dayOfPeriod) * periodLength
      : null;
    let reserveBalance: number | null = null;
    if (b.kind === "reserve") {
      // Accrue target/month from the fixed start date (opening balance $0) through
      // the current partial cycle, minus spend since then. Can go negative — an
      // overdrawn fund reads its true position rather than clamping to $0, so a
      // -$17 fund is distinguishable from a -$1,600 one.
      const monthsElapsed = Math.max(0, monthsBetween(RESERVE_ACCRUAL_START, period.start) + dayOfPeriod / periodLength);
      const accrual = target * monthsElapsed;
      const spentSinceStart = reserveSpend.get(cat) ?? 0;
      reserveBalance = accrual - spentSinceStart;
    }
    const category = getFirstNested(b.categories);
    return {
      budgetId: b.id as string, categoryId: cat, category: category?.name ?? "", group: category?.group ?? null,
      kind: b.kind, target, spent, reimbursed, netSpent, effectiveSpend,
      // savings is a contribution goal: filling toward target is success, never a
      // breach — keep status neutral so no surface reads it as "over budget".
      pct: Math.round(pct), remaining: target - effectiveSpend,
      status: b.kind === "savings" ? "ok" : ragStatus(pct),
      projected, priorSpend,
      reserveBalance, avgMonthlySpend,
      // Pending rows are the newest (unsettled), so they lead the preview, then
      // settled rows fill the rest up to LAST_N_PREVIEW.
      recent: [...(pendingPreviewByCat.get(cat) ?? []), ...(lastByCat.get(cat) ?? [])].slice(0, LAST_N_PREVIEW),
      pendingSpent: Math.max(0, pendingByCat.get(cat) ?? 0),
    };
  });

  // Credit behind reserves from the designated buffer account's contributions,
  // largest shortfall first (cascade order). Drawdowns are excluded upstream
  // (loadBufferContext sums inflows only), so the cost-hits-spend path is the
  // single place a reserve is reduced — no double-charge.
  const behind = rows
    .filter((r) => r.kind === "reserve" && r.reserveBalance != null && r.reserveBalance < 0)
    .map((r) => ({ categoryId: r.categoryId, shortfall: -(r.reserveBalance as number) }));
  const bufferAlloc = allocateContributions(behind, buffer.contributions);
  for (const r of rows) {
    const credit = bufferAlloc.credited.get(r.categoryId);
    if (credit) r.reserveBalance = toCents((r.reserveBalance as number) + credit);
  }

  // Flex balance: combined head-room across monthly_cap categories. The spend
  // total below spans the 3 completed cycles (rolling) PLUS the in-progress
  // cycle (current), so the allowance must cover the same span — 3 full cycles
  // plus the elapsed fraction of the current one (matching the reserve accrual
  // model above). A flat target*3 allowance charged current-cycle spend with no
  // allowance to cover it, dragging the balance redder as each cycle progressed.
  const periodFraction = periodLength > 0 ? dayOfPeriod / periodLength : 0;
  let flexAmount = 0, flexCategoriesIncluded = 0;
  for (const b of budgets) {
    if (b.kind !== "monthly_cap") continue;
    const cat = b.category_id as string;
    const spend = toCents((rollingByCat.get(cat) ?? 0) + (currentByCat.get(cat) ?? 0) - (currentReimbByCat.get(cat) ?? 0));
    if (spend <= 0) continue;
    flexAmount += Number(b.monthly_target) * (ROLLING_PERIODS + periodFraction) - spend;
    flexCategoriesIncluded++;
  }

  const categoryKind = new Map<string, { kind: string; group: string | null; name: string }>();
  for (const c of (catsRes.data ?? []) as any[]) {
    categoryKind.set(c.id as string, {
      kind: c.kind as string,
      group: (c.group as string | null) ?? null,
      name: (c.name as string) ?? "",
    });
  }
  const position = computePosition({
    txns: allTxns.map((t: any) => ({
      amount: Number(t.amount), category_id: t.category_id as string, occurred_at: t.occurred_at as string,
    })),
    categoryKind,
    budgets: budgets.map((b: any) => {
      const cat = getFirstNested(b.categories);
      return { kind: b.kind as string, monthly_target: Number(b.monthly_target), name: (cat?.name as string) ?? "", categoryId: b.category_id as string };
    }),
    periodStart: period.start,
    dayOfPeriod,
    periodLength,
    pendingOutflow,
  });

  // computePosition computes this internally for its projection floor; we also
  // surface the raw bills here so the alerts cron can fire budget_coverage_gap
  // for the same set without re-querying. Same inputs → identical result.
  const shadowCommitted = shadowCommittedByCat({
    txns: allTxns.map((t: any) => ({ amount: Number(t.amount), category_id: t.category_id as string, occurred_at: t.occurred_at as string })),
    categoryKind: toShadowCategoryKind(categoryKind),
    budgetedApCatIds: new Set(budgets.filter((b: any) => b.kind === "ap_amortised").map((b: any) => b.category_id as string)),
    rollingPeriods: ROLLING_PERIODS,
  });

  return {
    period: { start: toISODate(period.start), end: toISODate(period.end), dayOfPeriod, periodLength, daysLeft },
    rows,
    flex: { amount: flexAmount, categoriesIncluded: flexCategoriesIncluded },
    inbox: { categorisedInWindow: allTxns.length, inboxInWindow: uncatRes.count ?? 0 },
    position,
    shadowCommitted: Array.from(shadowCommitted.values()),
    unallocatedPending,
    reserveBuffer: {
      accountId: buffer.accountId,
      balance: buffer.bufferBalance,
      contributions: buffer.contributions,
      sweptThisCycle: buffer.sweptThisCycle,
      uncommitted: bufferAlloc.uncommitted,
    },
  };
}
