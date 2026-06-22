import { ROLLING_PERIODS } from "./period";
import { EXCLUDED_KINDS, COMMITTED_EXCLUDED_NAMES, shadowCommittedByCat, toShadowCategoryKind } from "./committed";

/** Round to the nearest cent — matches the numeric(14,2) DB type. */
function toCents(n: number): number {
  return Math.round(n * 100) / 100;
}

export interface PositionArgs {
  /** Categorised transactions across the rolling window (rollingWindowStart → period.end). */
  txns: { amount: number; category_id: string; occurred_at: string }[];
  /** categoryId → { kind, group, name } for the household's categories. */
  categoryKind: Map<string, { kind: string; group: string | null; name: string }>;
  /** Active budgets — used for the plan benchmark + self-heal exclusion. */
  budgets: { kind: string; monthly_target: number; name: string; categoryId?: string }[];
  periodStart: Date;
  dayOfPeriod: number;
  periodLength: number;
  /**
   * Net outflow of *pending* (unsettled) transactions in the current cycle —
   * money already spent at the bank but not yet in the settled `transactions`
   * feed (typically 1–3 days behind). Uncategorised by design (pending rows are
   * ephemeral and carry no category), so it can't be attributed per-budget; it's
   * folded into the position projection as a flat, already-incurred committed
   * amount. Defaults to 0. A txn is either pending or settled (Akahu moves it,
   * never both), so this never double-counts settled spend.
   */
  pendingOutflow?: number;
}

export interface Position {
  income: {
    actual: number;
    expected: number;
    expectedByNow: number;
    planned: number;
    recentRunRate: number;
  };
  expenses: {
    actual: number;
    projected: number;
    budget: number;
    /** Net pending (unsettled) outflow folded into `projected`; 0 if none. */
    pending: number;
  };
  net: {
    actual: number;
    projected: number;
    /**
     * Structural plan-vs-plan surplus/deficit: Σ income budgets − Σ expense
     * budgets. Unlike `actual`/`projected` (which blend in this cycle's real
     * spend & receipts), this answers the design-time question "do the budgets
     * I've SET commit me to spending more than I plan to earn?" — independent of
     * how any one cycle is tracking. Negative ⇒ over-committed budgets.
     */
    planned: number;
  };
}

export function computePosition(args: PositionArgs): Position {
  const { txns, categoryKind, budgets, periodStart, dayOfPeriod, periodLength } = args;
  const pendingOutflow = toCents(args.pendingOutflow ?? 0);

  let incomeActual = 0;     // current-period income-kind inflow (positive amounts)
  let expenseActual = 0;    // current-period expense-kind net outflow (-amount)
  let committedActual = 0;  // current-period ap_amortised (fixed/committed) outflow
  let priorIncome = 0;      // income-kind inflow in the rolling window before this period

  for (const t of txns) {
    const meta = categoryKind.get(t.category_id);
    if (!meta || EXCLUDED_KINDS.has(meta.kind) || COMMITTED_EXCLUDED_NAMES.has(meta.name)) continue;
    const occurred = new Date(t.occurred_at);
    const isIncome = meta.kind === "income";
    if (occurred >= periodStart) {
      if (isIncome) {
        incomeActual += Number(t.amount);
      } else if (meta.kind === "ap_amortised") {
        // Auto-pay / amortised budgets (incl. the mortgage gross repayment) count
        // the gross outflow leg ONLY. The transfer's far leg — e.g. the $1,210
        // repayment crediting the Choices loan — lands as an inflow and must not
        // net the spend to zero. Mirrors compute.ts's ap_amortised handling.
        const outflow = toCents(-Number(t.amount));
        if (outflow > 0) {
          expenseActual += outflow;
          committedActual += outflow; // ap_amortised is committed, not daily-variable
        }
      } else {
        // Other expense kinds use net spend, so a refund offsets the category.
        // Round to cents before accumulating so floating-point residuals can't
        // flip a near-zero sum across the sign boundary.
        const outflow = toCents(-Number(t.amount));
        expenseActual += outflow;
        // Only monthly caps accrue daily; everything else (sinking-fund reserves,
        // business subsidies, …) is lumpy/committed and shouldn't be run-rated.
        if (meta.kind !== "monthly_cap") committedActual += outflow;
      }
    } else if (isIncome) {
      priorIncome += Number(t.amount);
    }
  }

  // recentRunRate = trailing 3-cycle average. It still reflects what's actually
  // been landing — but it bakes in disruption (e.g. receivership arrears lumps)
  // as if it were normal, so it is NOT the pace baseline. It's carried as a
  // secondary signal: the gap (recentRunRate − planned) quantifies the deviation.
  const recentRunRate = priorIncome / ROLLING_PERIODS;
  // planned = the household's income budget for a cycle (Σ active income budgets).
  // monthly_target is treated as per-cycle, consistent with the expense plan
  // benchmark below. This is the honest "what we plan to earn" anchor — measuring
  // reality against the plan surfaces a shortfall instead of normalising it away.
  const planned = budgets
    .filter((b) => b.kind === "income")
    .reduce((sum, b) => sum + Number(b.monthly_target), 0);
  // Anchor to the plan; fall back to the trailing average only when no income
  // budget exists (fresh household, or a member who hasn't set income targets).
  const incomeBaseline = planned > 0 ? planned : recentRunRate;
  const incomeExpected = Math.max(incomeActual, incomeBaseline);
  // Pace line for the income ghost bar: where the PLAN says income should have
  // landed by this day, pro-rated linearly. Income actually arrives in weekly
  // lumps, but a linear pace marker is the honest "should-be-here-by-now" anchor.
  // Uses the baseline, NOT max(actual, baseline): the marker must stay put even
  // once actual overtakes it, so "ahead of pace" reads true.
  const incomeFraction = periodLength > 0 ? Math.min(1, Math.max(0, dayOfPeriod / periodLength)) : 1;
  const incomeExpectedByNow = incomeBaseline * incomeFraction;

  // Projection: only genuinely variable spend (monthly caps — groceries, dining,
  // fuel…) accrues daily, so only IT is run-rated. Committed spend (ap_amortised
  // fixed bills + sinking-fund reserves + subsidies) posts as once-a-cycle lumps;
  // run-rating it wildly over- or under-projects depending on whether it's landed
  // yet (e.g. the mortgage posts on the 21st, day 2 of the cycle). Project
  // committed spend as the greater of what's posted and the committed budget — so
  // an unpaid bill still counts and an already-paid one isn't multiplied up.
  const committedBudget = budgets
    .filter(
      (b) =>
        b.kind !== "income" &&
        b.kind !== "monthly_cap" &&
        !EXCLUDED_KINDS.has(b.kind) &&
        !COMMITTED_EXCLUDED_NAMES.has(b.name),
    )
    .reduce((sum, b) => sum + Number(b.monthly_target), 0);
  // Self-heal: recurring auto-payments with no budget row would otherwise leak
  // from the committed floor. Add their trailing average so the projection
  // reserves them like any budgeted bill. Excluded names (Mortgage Interest)
  // are filtered inside shadowCommittedByCat.
  const budgetedApCatIds = new Set<string>();
  for (const b of budgets) {
    if (b.kind === "ap_amortised" && b.categoryId != null) budgetedApCatIds.add(b.categoryId);
  }
  const shadow = shadowCommittedByCat({
    txns,
    categoryKind: toShadowCategoryKind(categoryKind),
    budgetedApCatIds,
    rollingPeriods: ROLLING_PERIODS,
  });
  let shadowCommittedTotal = 0;
  for (const bill of shadow.values()) shadowCommittedTotal += bill.monthlyAvg;

  const variableActual = expenseActual - committedActual;
  const variableProjected =
    dayOfPeriod > 0 ? (variableActual / dayOfPeriod) * periodLength : variableActual;
  // Pending is already-incurred money awaiting settlement, so it's added flat —
  // NOT run-rated (it already happened) and NOT in `txns` (so no overlap with
  // variable/committed actuals). It lifts the projection out of the multi-day
  // settlement under-report without touching the audited settled figures.
  const expensesProjected =
    variableProjected + Math.max(committedActual, committedBudget + shadowCommittedTotal) + pendingOutflow;
  // Income budgets target planned income, not planned spend — exclude them (and
  // any excluded kinds, plus mortgage interest) from the expense-plan benchmark so
  // it lines up with the actual/projected "Out".
  const budget = budgets
    .filter(
      (b) =>
        b.kind !== "income" &&
        !EXCLUDED_KINDS.has(b.kind) &&
        !COMMITTED_EXCLUDED_NAMES.has(b.name),
    )
    .reduce((sum, b) => sum + Number(b.monthly_target), 0);

  return {
    income: {
      actual: incomeActual,
      expected: incomeExpected,
      expectedByNow: incomeExpectedByNow,
      planned,
      recentRunRate,
    },
    expenses: { actual: expenseActual, projected: expensesProjected, budget, pending: pendingOutflow },
    net: {
      actual: incomeActual - expenseActual,
      projected: incomeExpected - expensesProjected,
      planned: toCents(planned - budget),
    },
  };
}
